"""
MAAGAP — start the ML service and its public tunnel (Option A deployment)
================================================================================
Brings up the two processes the deployed system needs on this machine: uvicorn
on :8000, and the ngrok tunnel that makes it reachable from the Vercel frontend.

    python scripts/start_tunnel_session.py
    python scripts/start_tunnel_session.py --stop

Everything checkable is checked before anything starts, because the failures
this prevents are the quiet ones:

  - a service started without a webhook secret (now impossible, but the error
    is clearer here than inside a pydantic validation traceback);
  - a tunnel pointed at a stale uvicorn still holding the port, so the public
    URL serves last week's code while looking perfectly healthy;
  - a guarded endpoint answering without the secret, which must be caught
    BEFORE the port is published to the internet, not after.

WHY PYTHON AND NOT POWERSHELL. This began as a .ps1 and was rewritten after
PowerShell 5.1's tokenizer mis-paired quotes in it three times over — nested
quoting in Write-Host arguments silently shifted the parse so that later string
literals were read as expressions. The repo already depends on Python, scripts/
is already Python, and this version runs on whatever machine the evaluation
happens on.
"""

from __future__ import annotations

import argparse
import os
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
ML_DIR = REPO_ROOT / "ml-service"
ENV_FILE = ML_DIR / ".env"
SECRET_VAR = "ML_SERVICE_WEBHOOK_SECRET"

GREEN, RED, YELLOW, DIM, RESET = "\033[32m", "\033[31m", "\033[33m", "\033[2m", "\033[0m"


def ok(msg: str) -> None:
    print(f"  {GREEN}[ok]{RESET}   {msg}")


def bad(msg: str) -> None:
    print(f"  {RED}[fail]{RESET} {msg}")


def step(msg: str) -> None:
    print(f"  {DIM}{msg}{RESET}")


def venv_python() -> Path:
    """The project interpreter, preferring the venv over whatever is running."""
    for candidate in (
        REPO_ROOT / ".venv" / "Scripts" / "python.exe",
        REPO_ROOT / ".venv" / "bin" / "python",
    ):
        if candidate.exists():
            return candidate
    return Path(sys.executable)


def read_secret() -> str | None:
    """Environment first, then ml-service/.env — the same precedence as
    common/settings.py, where an already-set variable always wins."""
    from_env = (os.environ.get(SECRET_VAR) or "").strip()
    if from_env:
        return from_env
    if not ENV_FILE.exists():
        return None
    prefix = f"{SECRET_VAR}="
    for raw in ENV_FILE.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if line.startswith(prefix):
            return line[len(prefix):].strip().strip('"').strip("'")
    return None


def port_in_use(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.5)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def http_status(url: str, timeout: float = 4.0) -> int | None:
    """Status code, or None if the request did not complete at all."""
    try:
        with urllib.request.urlopen(url, timeout=timeout) as response:
            return response.status
    except urllib.error.HTTPError as exc:
        return exc.code
    except (urllib.error.URLError, TimeoutError, OSError):
        return None


def preflight(port: int) -> str:
    print(f"\n{YELLOW}MAAGAP — ML service + public tunnel{RESET}\n")

    python = venv_python()
    if not (REPO_ROOT / ".venv").exists():
        step(f"no .venv found; using {python}")
    else:
        ok(f"interpreter {python.relative_to(REPO_ROOT)}")

    if shutil.which("ngrok") is None:
        bad("ngrok is not on PATH")
        step("install from https://ngrok.com/download, then:")
        step("  copy deploy/ngrok/ngrok.yml.example into ngrok's config location")
        step("  fill in your authtoken and your account's free static domain")
        sys.exit(1)
    ok("ngrok on PATH")

    secret = read_secret()
    if not secret:
        bad(f"{SECRET_VAR} is not set (checked the environment and ml-service/.env)")
        step('generate one:  python -c "import secrets; print(secrets.token_urlsafe(32))"')
        sys.exit(1)
    if len(secret) < 24:
        bad(f"{SECRET_VAR} is only {len(secret)} characters")
        step("this endpoint is about to be reachable from the internet; use a 32-byte token")
        sys.exit(1)
    ok(f"webhook secret present ({len(secret)} chars)")

    # The nastiest of these. A stale listener means the tunnel comes up healthy
    # and publishes a process that is not the one you just changed.
    if port_in_use(port):
        bad(f"port {port} is already in use")
        step("that process is what the tunnel would expose, not a fresh service")
        step("stop it first:  python scripts/start_tunnel_session.py --stop")
        sys.exit(1)
    ok(f"port {port} is free")

    return secret


def wait_for_health(proc: subprocess.Popen, port: int, timeout: float = 150.0) -> None:
    """Poll until the service answers, rather than assuming it will. It imports
    TensorFlow and loads a 4 MB forest, so this is tens of seconds."""
    step("waiting for /health ...")
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if proc.poll() is not None:
            bad(f"uvicorn exited during startup (code {proc.returncode})")
            step("run it directly to see why:")
            step(f"  cd ml-service && {venv_python()} -m uvicorn main:app --port {port}")
            sys.exit(1)
        if http_status(f"http://127.0.0.1:{port}/health") == 200:
            ok("service healthy")
            return
        time.sleep(2)
    bad(f"/health did not respond within {timeout:.0f}s")
    proc.terminate()
    sys.exit(1)


def verify_guard_is_on(proc: subprocess.Popen, port: int) -> None:
    """Confirm guarded routes reject unauthenticated callers BEFORE publishing
    the port. S1 was an unset secret silently disabling authentication; this is
    the check that would have caught it at the only moment it still matters."""
    status = http_status(f"http://127.0.0.1:{port}/api/v1/model-metrics")
    if status == 401:
        ok("guarded endpoints reject unauthenticated callers (401)")
        return
    if status is None:
        step("could not probe the guard; continuing")
        return
    bad(f"a guarded endpoint returned {status} WITHOUT the secret — refusing to open the tunnel")
    step("check that ALLOW_UNAUTHENTICATED is not set in ml-service/.env")
    proc.terminate()
    sys.exit(1)


def stop_session(port: int) -> int:
    """Stop ngrok and anything listening on the service port."""
    print("\nStopping MAAGAP session processes\n")
    killed = 0

    if sys.platform == "win32":
        subprocess.run(["taskkill", "/F", "/IM", "ngrok.exe"],
                       capture_output=True, check=False)
        found = subprocess.run(["netstat", "-ano", "-p", "TCP"],
                               capture_output=True, text=True, check=False)
        pids = {
            parts[-1]
            for line in found.stdout.splitlines()
            if f":{port}" in line and "LISTENING" in line
            for parts in [line.split()]
            if parts[-1].isdigit()
        }
        for pid in pids:
            subprocess.run(["taskkill", "/F", "/PID", pid], capture_output=True, check=False)
            killed += 1
    else:
        subprocess.run(["pkill", "-f", "ngrok"], capture_output=True, check=False)
        found = subprocess.run(["lsof", "-ti", f"tcp:{port}"],
                               capture_output=True, text=True, check=False)
        for pid in found.stdout.split():
            subprocess.run(["kill", "-9", pid], capture_output=True, check=False)
            killed += 1

    ok(f"stopped ngrok and {killed} process(es) on port {port}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--stop", action="store_true", help="stop a running session")
    parser.add_argument("--tunnel", default="maagap-ml",
                        help="tunnel name in ngrok.yml")
    parser.add_argument(
        "--rate-limit", type=int, default=60,
        help=(
            "ML_SERVICE_RATE_LIMIT_PER_MINUTE for this session. The default of "
            "10 is right when the limit is per end user and wrong here: every "
            "call arrives from the Next.js server runtime, so the limiter's "
            "per-IP buckets collapse to Vercel's few egress IPs and the cap "
            "becomes effectively global. See docs/DEPLOYMENT.md, Option A."
        ),
    )
    args = parser.parse_args()

    if args.stop:
        return stop_session(args.port)

    preflight(args.port)

    print("\nStarting\n")
    env = dict(os.environ)
    env["ML_SERVICE_RATE_LIMIT_PER_MINUTE"] = str(args.rate_limit)

    # --workers 1 is not an unexamined default: optimizer run state is an
    # unlocked file, so the 409 "already running" guard holds only within one
    # process (R3). See ml-service/common/paths.py.
    proc = subprocess.Popen(
        [str(venv_python()), "-m", "uvicorn", "main:app",
         "--host", "127.0.0.1", "--port", str(args.port), "--workers", "1"],
        cwd=str(ML_DIR),
        env=env,
    )
    ok(f"uvicorn started (pid {proc.pid}), rate limit {args.rate_limit}/min")

    try:
        wait_for_health(proc, args.port)
        verify_guard_is_on(proc, args.port)

        print(f"\n{YELLOW}Opening the tunnel. Ctrl+C stops both.{RESET}\n")
        step("ngrok inspector: http://127.0.0.1:4040")
        step("Vercel needs FASTAPI_ML_SERVICE_URL set to your static domain,")
        step("and the SAME ML_SERVICE_WEBHOOK_SECRET as this service.")
        print()
        subprocess.run(["ngrok", "start", args.tunnel], check=False)
    except KeyboardInterrupt:
        print()
    finally:
        if proc.poll() is None:
            proc.terminate()
            try:
                proc.wait(timeout=10)
            except subprocess.TimeoutExpired:
                proc.kill()
            print(f"  stopped uvicorn (pid {proc.pid})")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
