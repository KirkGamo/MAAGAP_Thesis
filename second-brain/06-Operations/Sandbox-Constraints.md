---
tags: [operations, sandbox]
status: active
created: 2026-08-08
updated: 2026-08-08
---

# Sandbox Constraints

Applies when working inside a Cowork/agent sandbox rather than the user's own machine.

- Hard 45-second timeout per shell command, non-configurable.
- Each shell call runs in a **fresh process namespace** — backgrounded processes (`nohup ... &`, `setsid`, `disown`) do NOT survive between tool calls, even though the filesystem does persist. There is no way to background a long-running job across calls in this environment. (Confirmed empirically: a `setsid`-detached `train_lstm.py` process visible via `ps aux` in one call was simply gone — no process, no log output — in the very next call.)
- Practical implication: full LSTM training (60 epochs/batch 8) does not fit a single 45s call. Either reduce epochs/folds to fit one call (fine for a pipeline smoke-test — confirming nothing crashes end-to-end — but NOT fine as final metrics) or have the user run it on their own machine. **Never write sandbox smoke-test numbers into the methodology report as final** — mark them explicitly stale/pending and get a real run.
- pandas must stay below 3.0 — see `ml-service/requirements.txt`'s own comment; `feature_engineering.py`'s dtype handling was only ever validated on pandas 2.x, and pandas 3.0's copy-on-write default broke `compute_proxy_completion_dates()`.

See [[../03-ML-Pipeline/Stage5-Train-LSTM]] for where this constraint actually bit in practice.
