# MAAGAP — Deployment Runbook

The commands and decisions needed to get MAAGAP running on real infrastructure,
and to get it back to a working state when a deploy goes wrong.

Read `HANDOFF.md` first if you have not. This document assumes the pipeline has
been run and `ml-service/artifacts/` and `data/ready/` are populated locally —
without them there is nothing to deploy.

---

## 1. Topology

| Component | Where | Why there |
|---|---|---|
| Next.js frontend | Vercel | 17 routes, all server-rendered on demand except `/login` and the 404. Every ML-service call happens in the server runtime. |
| FastAPI ML service | **Option A (chosen):** this machine, published over HTTPS by an ngrok tunnel. **Alternative:** one persistent container, one worker, on a VPS. | Either way it must be a long-lived process with a single worker: multi-minute optimizer runs, run state in an unlocked file, TensorFlow cold starts. See §4a and §5. |
| PostgreSQL + auth | Hosted Supabase | RLS policies are the authorization model; see `second-brain/04-Data-Model/`. |

The frontend talks to the ML service **server-side only**. That is why
`ML_SERVICE_ALLOWED_ORIGINS` is empty and should stay empty: no browser ever
calls the service directly, so CORS does not apply. A CORS error after deploy
means a browser is reaching the service, which is a bug to find rather than an
origin to add.

---

## 2. What the container must be given

`ml-service/artifacts/` and `data/ready/` are both gitignored — they hold model
binaries and derived data, not source. A container built from a clone has
neither, so **the models are baked into the image at build time**.

`ml-service/Dockerfile` enumerates the ~15 MB the service actually loads. It
does not copy `artifacts/` wholesale, because
`random_forest_regressor.joblib` (38.6 MB) and `xgboost_regressor.joblib`
(1.2 MB) are training outputs that produce the Chapter 4 MAE figure and are
never loaded by the service.

`ml-service/common/runtime_assets.py` verifies all of this at startup and
**refuses to start** when a required file is absent, with a message naming the
file and the script that produces it. Without that check the container would
import cleanly, answer `/health` with `{"status": "ok"}`, pass its readiness
probe, and fail on the first real request from inside `joblib.load()`.

The trade: a retrain requires an image rebuild. For a system retrained a
handful of times that is the right cost for having one artifact to deploy and
one thing to roll back.

---

## 3. Build and verify the image locally

**Build from the repository root, not from `ml-service/`.** The service resolves
`DATA_READY_DIR = REPO_ROOT / "data" / "ready"`, so `data/ready/` lives one
level above the service and is outside any context rooted at `ml-service/`.

```bash
docker build -f ml-service/Dockerfile -t maagap-ml:latest .
# or, equivalently:
docker compose up --build
```

Then drive it — not just launch it. A container that starts proves the
entrypoint resolves; it does not prove the models load.

```bash
SECRET=$(grep ML_SERVICE_WEBHOOK_SECRET ml-service/.env | cut -d= -f2)

# 1. health: the one unauthenticated route
curl -s localhost:8000/health
# -> {"status":"ok"}

# 2. the guard holds: no secret -> 401
curl -s -o /dev/null -w '%{http_code}\n' localhost:8000/api/v1/model-metrics
# -> 401

# 3. the guard opens: with the secret -> 200 and real metrics
curl -s -H "X-Webhook-Secret: $SECRET" localhost:8000/api/v1/model-metrics | head -c 300

# 4. the models actually load — this is the one that matters, because it is the
#    first call that touches joblib.load() and TensorFlow
curl -s -H "X-Webhook-Secret: $SECRET" localhost:8000/api/v1/live-score/<a_real_project_key>
```

Check the startup log says `auth=on`. If it says `auth=off`, `ALLOW_UNAUTHENTICATED`
is set and the service is open — stop and fix it.

---

## 4. Deploy the ML service

Generate a real secret. Placeholders like `changeme` are rejected by name, so a
copied example refuses to boot rather than running open:

```bash
python -c "import secrets; print(secrets.token_urlsafe(32))"
```

Set, in the host's secret store — never in the image, never committed:

| Variable | Value |
|---|---|
| `ML_SERVICE_WEBHOOK_SECRET` | the generated secret; **must match the frontend's** |
| `SUPABASE_URL` | the project URL (the frontend calls this `NEXT_PUBLIC_SUPABASE_URL` — same value, different name) |
| `SUPABASE_SERVICE_ROLE_KEY` | bypasses every RLS policy; treat accordingly |
| `ML_SERVICE_ALLOWED_ORIGINS` | leave empty |
| `ALLOW_UNAUTHENTICATED` | **never set this in a deployed environment** |

Confirm the startup log:

```
Config: auth=on supabase_writes=on rate_limit=10/min cors_origins=0
Runtime assets: all 12 required and 7 optional file(s) present.
```

If `supabase_writes=off`, the service will score correctly and silently write
nothing back — reports sit at "Awaiting re-score" forever.

### 4a. Option A (chosen): this machine, behind an ngrok tunnel

No hosting bill, no hardware, and the best CPU available to this project. The ML
service runs here; ngrok publishes it over HTTPS; the Vercel frontend calls that
URL. Suited to a scheduled evaluation session, not to 24/7 availability.

**One-time setup**

1. `ngrok` is already installed (3.39.11). Claim your account's **free static
   domain** at <https://dashboard.ngrok.com/domains> — every account gets one and
   it survives agent restarts, which is what makes this practical: the Vercel
   variable is set once, not re-pasted before every session.
2. Copy `deploy/ngrok/ngrok.yml.example` over ngrok's config and fill in the
   authtoken and that domain:
   - Windows: `%LOCALAPPDATA%
grok
grok.yml`
   - macOS: `~/Library/Application Support/ngrok/ngrok.yml`
   - Linux: `~/.config/ngrok/ngrok.yml`

   Replacing the existing file is safe — it holds only `region: us` and
   `version: '2'`. Note the example is schema v3.
3. In Vercel, set `FASTAPI_ML_SERVICE_URL` to `https://<your-domain>.ngrok-free.dev`
   and `ML_SERVICE_WEBHOOK_SECRET` to the same value as `ml-service/.env`.

**Every session**

```bash
python scripts/start_tunnel_session.py        # Ctrl+C stops both
python scripts/start_tunnel_session.py --stop # if something is left running
```

It refuses to open the tunnel unless the secret is present and at least 24
characters, the port is free (a stale listener would be what the tunnel
published), the service answers `/health`, and a guarded route returns **401
without the secret**. That last check runs at the only moment it still matters —
before the port is public.

**The rate limit is raised to 60/min for a session, deliberately.** The default
of 10 is right when the limit is per end user, and this deployment is not that.
`api/deps.py` keys buckets on `X-Forwarded-For`, which ngrok sets to its caller
— and every call comes from the Next.js *server* runtime, never a respondent's
browser. So the "client" is Vercel's handful of shared egress IPs and the cap is
effectively global. During a session with several PPDO respondents submitting
monitoring reports, 10/min between them is easy to exceed, and they would rate
the resulting failures as defects of the system — contaminating the very
measurement the session exists to take. Raising it is safe because the limiter
is not what protects the expensive path: authentication runs first on every
guarded route, and the optimizer's real protection is its 409 "already running"
guard, which this value does not touch.

**What you accept with Option A**

- The system is reachable only while this machine is running the session. Fine
  for scheduled administration; unusable for asynchronous evaluation.
- The tunnel URL is public. HTTPS plus the shared secret plus the rate limiter
  are the whole of the access control, same as any other host would be.
- `frontend/src/lib/ml-service.ts` sends `ngrok-skip-browser-warning` on every
  call. ngrok's free tier serves an HTML interstitial to requests it judges to
  be from a browser; these are server-side so it should not fire, but without the
  header the failure would be every endpoint returning 200 with HTML and a JSON
  parse error far from the cause.

**What you gain, beyond the money.** The solver's 60-second cap is wall-clock,
and §4b shows it already saturates. This machine is where Chapter 4's efficiency
figures were measured, so running the service here is the one configuration that
cannot silently under-solve relative to the reported numbers. Every free cloud
CPU is slower.

### 4b. Alternative: Dokploy on a VPS

The chosen host. Steps:

1. In Dokploy, create a **Compose** application pointed at this repository, with
   Compose Path `deploy/dokploy/docker-compose.yml`. The build context there is
   `../..` (the repo root) for the reason in §3.
2. Set the environment variables above in Dokploy's **Environment** tab, not in
   the compose file — that file is committed.
3. Assign a domain in Dokploy's **Domains** tab. Dokploy's Traefik issues the
   certificate and routes to the container's port 8000 over its internal
   network.
4. Confirm the volume `maagap-outputs` is mounted at `/app/ml-service/outputs`
   and **not** at `/app/ml-service/artifacts` (§8 explains why that distinction
   is not cosmetic).

**TLS is not optional here, and this is the one genuine security constraint of
the VPS path.** The shared secret travels in the `X-Webhook-Secret` request
header on every call. Over plain HTTP it is on the wire in cleartext, and that
secret is sufficient to mutate risk tiers and start optimizer runs. Terminate
TLS at Traefik and never add a `ports:` mapping to the compose file — that would
publish `:8000` on the VPS's public interface, bypassing the proxy and its
certificate entirely.

**Be honest about what the secret is doing.** The earlier advice to prefer a
private network or an IP allow-list does not apply to this topology: Vercel
calls the VPS across the public internet, and static egress IPs for
allow-listing are not available on Vercel's lower plans. So the endpoint is
public, and HTTPS plus the shared secret plus the rate limiter are the whole of
the access control. That is adequate for this system's threat model — the data
is provincial project risk tiers and inspector schedules, not personal or
financial records — but it should be stated rather than assumed. Putting
Cloudflare in front of the domain is a cheap further layer if wanted.

---

### 4c. Sizing a VPS — and why CPU matters more than RAM

Measured on a full optimizer run (import TensorFlow, load the forest and
XGBoost, score all 2,393 ongoing projects, SHAP the High/Critical ones, solve
with CBC):

| | |
|---|---|
| Peak resident memory | **485 MB** |
| — of which imports alone | 335 MB (TensorFlow 187 MB of it) |
| — scoring + solve adds | ~105 MB |
| Wall clock, end to end | **73 s** (60 s of it the CBC cap) |
| Image size, estimated | ~1.5–2 GB (`tensorflow-cpu` dominates) |

So **memory is not the constraint** — the 2 GB container limit is ~4× headroom,
kept for safety rather than need. A 2 vCPU / 4 GB / 40 GB VPS is comfortable:
~0.5 GB for the service, the rest for the OS, Dokploy and Traefik, and disk
headroom for Docker layers across rebuilds.

**CPU is the constraint, and it is not only a performance question.**
`SOLVER_TIME_LIMIT_SECONDS = 60` is a wall-clock cap, and on the development
machine the solve used **60.2 s of it — 100%**. CBC returns the best solution
found when the clock runs out, not a proven optimum; `optimization_engine.py`
already logs a warning saying exactly that.

The consequence for deployment is direct: a slower or burstable vCPU explores
fewer nodes in the same 60 seconds and therefore **produces a worse schedule,
silently**. Nothing errors. The schedule is simply less good, and no one looking
at the output can tell. So:

- **Buy dedicated vCPU, not shared or burstable.** A credit-based instance that
  throttles mid-solve is the worst case, because throttling is invisible in the
  output.
- **Check the solver log line on the deployed host after the first real run.**
  It reports seconds used against the cap and whether the limit was hit. If the
  deployed host is slower, either raise `SOLVER_TIME_LIMIT_SECONDS` or lower
  `MAX_PROJECTS_CONSIDERED` (currently 150, with 89 candidates in the measured
  run) so the solve finishes inside its budget.

**This also has a thesis implication, not just an operational one.** Chapter 4's
allocation-efficiency figures were measured with this 60 s budget on this
hardware. Because the cap is wall-clock, the solver's output is
host-dependent — the same inputs on different hardware can yield different
schedules. If the deployed instance is the one demonstrated at defence, confirm
the solve is not time-starved there, or the system shown will be quietly
underperforming the numbers reported for it.

## 5. Why one worker, and why not serverless

`CMD` pins `--workers 1`. Three reasons, all load-bearing:

- **`artifacts/optimizer_run_status.json` has no locking.** The 409
  "already running" guard in `api/routers/optimizer.py` only holds within one
  process. With two workers, two concurrent requests both see `idle`, both start
  a multi-minute CBC solve, and the second to finish overwrites the first's
  schedule. This is **R3**, deferred deliberately because it only manifests once
  deployed. The fix is to move run state into Supabase.
- **The rate limiter is in-process** (`api/deps.py`). N workers permit N times
  the configured rate.
- **An optimizer run takes minutes in-process.** A platform that freezes or
  recycles the process after the 202 response kills the run halfway and leaves a
  `running` status nothing will ever clear. This is also why the service cannot
  be serverless.

Capacity is not the constraint this looks like: every caller is the Next.js
server runtime, requests are either sub-second reads or one deliberate optimizer
run, and uvicorn serves the reads concurrently within the single worker.

---

## 6. Deploy the frontend

Vercel environment variables:

| Variable | Exposure |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | browser (safe by design) |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | browser (safe by design) |
| `SUPABASE_SERVICE_ROLE_KEY` | **server only** |
| `FASTAPI_ML_SERVICE_URL` | server only |
| `ML_SERVICE_WEBHOOK_SECRET` | server only; must match the ML service |

Never give the last three a `NEXT_PUBLIC_` prefix. `ML_SERVICE_WEBHOOK_SECRET`
in a browser bundle hands every visitor the ability to mutate risk tiers and
start optimizer runs.

Add the Vercel domain to **Supabase's redirect allow-list**, or sign-in fails
after the OAuth round-trip with an error that reads like a credentials problem
and is not.

**Deploy a preview and verify it before promoting.** Open the **Models tab**
specifically — it is the page that proves the frontend can both reach *and
authenticate to* the ML service. A page showing the no-service fallback instead
of metrics is the tell.

That check exists because of a failure this project already had: guarding the
ML service's read endpoints broke five frontend call sites with 401s, and both
test suites stayed green — the Python tests assert rejection, and the frontend
tests do not cross the network. Any environment-variable mistake here produces
the same shape of failure. `frontend/src/lib/ml-service.ts` is now the single
authenticated client, so a new endpoint cannot be consumed without the header
by forgetting.

---

## 7. Post-deploy verification

Drive the deployed app by hand. A green build is not a working system.

- [ ] Log in as a manager; log in as an inspector. Both land on their own dashboard.
- [ ] **Models tab** renders real metrics (not the fallback) — proves auth to the ML service.
- [ ] Schedule page renders, and risk markers differ in **shape as well as colour**.
- [ ] Map places projects in plausible municipalities (coordinates are LMB-derived; see `scripts/build_municipality_coordinates.py`).
- [ ] Submit a monitoring report as an inspector → the project's risk tier updates, and `projects.score_basis` is written alongside it.
- [ ] Run the optimizer once. It returns 202, status moves to `running`, then completes. A second concurrent request returns 409.
- [ ] An unauthenticated `curl` to any `/api/v1/*` route returns 401.

---

## 8. Rollback

Write this down before you need it, because the obvious move is the wrong one.

| To undo | Do |
|---|---|
| A bad frontend deploy | Promote the previous Vercel deployment. Instant, no rebuild. |
| A bad ML-service deploy | Redeploy the previous image tag. Tag every image — `maagap-ml:<git-sha>` — or there is nothing to roll back *to*. |
| A bad model | Rebuild from the commit whose artifacts were good. The models are in the image, so an image rollback *is* a model rollback — this is the main benefit of baking them in. |
| A bad database state | **Not** by reseeding. See below. |

**Reseeding is not a rollback.** `scripts/seed_supabase.py` prunes rows no
longer present in the population it is given, so running it against a different
population deletes rows rather than restoring them. Recover database state from
a Supabase backup, not from the seeder.

**Never mount a volume over `artifacts/`.** Docker populates an empty named
volume from the image on first run and never refreshes it, so the volume
shadows the directory permanently: rebuild with a retrained model and the
container keeps loading the *old* model from the volume while reporting the new
image's version — a silent model change, invisible from outside.

This is why the writable set lives somewhere else. `ml-service/common/paths.py`
puts the four mutable files — `inspector_schedule.csv`, its summary,
`optimizer_run_status.json`, `live_scores.json` — under `ML_SERVICE_OUTPUT_DIR`,
which the image sets to `/app/ml-service/outputs`. The volume mounts *there*, so
`artifacts/` is never covered and stays exactly as the image built it. With the
variable unset, `OUTPUT_DIR` falls back to `artifacts/`, which is the historical
behaviour and keeps local development and the test suite unchanged.

`artifacts/` is also left root-owned in the image, so the service cannot write to
it at all: the models are an immutable input, and the process loading them has no
business being able to overwrite them.

---

## 9. Operational notes

- **Uptime check on `/health`** — deliberately the one unauthenticated route.
- **Supabase free tier pauses after ~7 days of inactivity.** This project has
  already lost an afternoon to it: the project subdomain fails DNS resolution
  while `supabase.co` resolves fine, which looks like a network problem and is
  not. Before a defence, either upgrade the tier or schedule a daily touch.
- **Structured logging (B3)** is the remaining operational gap. This codebase's
  characteristic failure is the silent one — a fail-open guard, a positional
  argument, a fabricated model input, a provenance tag that stopped matching its
  own value. Every one looked like success and logged nothing unusual. JSON logs
  with a request id propagated into background tasks are what you will want the
  first time something is wrong in production.
- **Keep `requirements-runtime.txt` pinned exactly.** The image ships pickled
  models: `random_forest.joblib` and `meta_learner*.joblib` were written by
  scikit-learn 1.9.0, `xgboost.joblib` by xgboost 3.3.0, `lstm_model.keras` by
  Keras 3.15 / TensorFlow 2.21. Unpickling a scikit-learn estimator under a
  different minor version is unsupported, and the dangerous outcome is not the
  exception — it is the model that loads and scores *differently* than it did in
  evaluation. Bump the pins together with a retrain, never on their own.
