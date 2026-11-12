"""Set up and launch the local Flask application like a small 'Go Live' server."""
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import urllib.error
import urllib.request
import uuid
import venv
import webbrowser

from backend.services.backend_revision import backend_revision

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
ENV = BACKEND / ".venv"
ENV_PYTHON = ENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")
ENV_PYTHONW = ENV / "Scripts/pythonw.exe" if os.name == "nt" else ENV_PYTHON
RUNTIME = ROOT / ".runtime"
PID_FILE = RUNTIME / "backend.json"
LOG_DIR = ROOT / "logs"
BACKEND_LOG = LOG_DIR / "backend.log"
LAUNCHER_LOG = LOG_DIR / "launcher.log"
START_TIMEOUT_SECONDS = 30


def _log_launcher(message: str) -> None:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = time.strftime("%Y-%m-%d %H:%M:%S")
    with LAUNCHER_LOG.open("a", encoding="utf-8") as stream:
        stream.write(f"[{timestamp}] {message}\n")


def _read_env_file() -> dict[str, str]:
    values: dict[str, str] = {}
    path = BACKEND / ".env"
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {'"', "'"}:
            value = value[1:-1]
        values[key.strip()] = value
    return values


def configured_url() -> str:
    values = _read_env_file()
    host = values.get("FLASK_HOST") or os.getenv("FLASK_HOST", "127.0.0.1")
    try:
        port = int(values.get("FLASK_PORT") or os.getenv("FLASK_PORT", "5000"))
    except ValueError as error:
        raise RuntimeError("FLASK_PORT must be a valid integer.") from error
    browser_host = "127.0.0.1" if host == "0.0.0.0" else "::1" if host == "::" else host
    if ":" in browser_host and not browser_host.startswith("["):
        browser_host = f"[{browser_host}]"
    return f"http://{browser_host}:{port}"


def read_health(url: str) -> dict | None:
    try:
        with urllib.request.urlopen(f"{url}/api/health", timeout=0.75) as response:
            if response.status != 200:
                return None
            payload = json.loads(response.read().decode("utf-8"))
            return payload if isinstance(payload, dict) and payload.get("status") == "ok" else None
    except (OSError, ValueError, urllib.error.URLError):
        return None


def app_is_ready(url: str) -> bool:
    return read_health(url) is not None


def setup_environment() -> None:
    if sys.version_info < (3, 11):
        raise RuntimeError("Python 3.11 or newer is required.")
    if not ENV_PYTHON.exists():
        _log_launcher("Creating the app's Python environment.")
        venv.EnvBuilder(with_pip=True).create(ENV)
    requirements = BACKEND / "requirements.txt"
    digest = hashlib.sha256(requirements.read_bytes()).hexdigest()
    stamp = ENV / ".requirements.sha256"
    if not stamp.exists() or stamp.read_text().strip() != digest:
        _log_launcher("Installing dependencies because requirements changed or this is the first run.")
        pip_kwargs = {
            "cwd": BACKEND,
            "check": True,
            "stdout": subprocess.DEVNULL,
            "stderr": subprocess.STDOUT,
        }
        if os.name == "nt":
            pip_kwargs["creationflags"] = getattr(subprocess, "CREATE_NO_WINDOW", 0)
        subprocess.run(
            [str(ENV_PYTHON), "-m", "pip", "install", "-r", str(requirements)],
            **pip_kwargs,
        )
        stamp.write_text(digest)


def _write_runtime(pid: int, url: str, instance_id: str = "") -> None:
    RUNTIME.mkdir(parents=True, exist_ok=True)
    PID_FILE.write_text(json.dumps({"pid": pid, "url": url, "instanceId": instance_id}), encoding="utf-8")


def _owns_backend(health: dict, url: str) -> bool:
    """Only automatically stop the exact instance recorded by this launcher."""
    try:
        runtime = json.loads(PID_FILE.read_text(encoding="utf-8"))
        return (bool(health.get("instanceId")) and runtime.get("instanceId") == health["instanceId"]
                and runtime.get("pid") == health.get("pid") and runtime.get("url") == url)
    except (OSError, ValueError, TypeError, AttributeError):
        return False


def _serving_pid(health: dict | None, revision: str, instance_id: str) -> int | None:
    """A Windows venv redirector can have a different PID from its interpreter."""
    if not health or health.get("backendRevision") != revision or health.get("instanceId") != instance_id:
        return None
    pid = health.get("pid")
    return pid if isinstance(pid, int) and not isinstance(pid, bool) and pid > 0 else None


def _read_runtime() -> tuple[int | None, str]:
    url = configured_url()
    if not PID_FILE.exists():
        return None, url
    try:
        data = json.loads(PID_FILE.read_text(encoding="utf-8"))
        pid = int(data.get("pid"))
        runtime_url = str(data.get("url") or url)
        return pid if pid > 0 else None, runtime_url
    except (OSError, TypeError, ValueError, json.JSONDecodeError):
        return None, url


def _clear_runtime_for_pid(pid: int | None = None) -> None:
    if not PID_FILE.exists():
        return
    if pid is not None:
        current_pid, _ = _read_runtime()
        if current_pid != pid:
            return
    try:
        PID_FILE.unlink()
    except OSError:
        pass


def serve() -> int:
    os.chdir(BACKEND)
    sys.path.insert(0, str(BACKEND))
    from app import create_app
    from config import AppConfig
    from werkzeug.serving import make_server

    config = AppConfig.from_env()
    host = config.flask_host
    browser_host = "127.0.0.1" if host == "0.0.0.0" else "::1" if host == "::" else host
    if ":" in browser_host and not browser_host.startswith("["):
        browser_host = f"[{browser_host}]"

    server = make_server(host, config.flask_port, create_app(), threaded=True)
    url = f"http://{browser_host}:{server.server_port}"
    _write_runtime(os.getpid(), url, os.getenv("ADO_BACKEND_INSTANCE_ID", ""))
    print(f"Backend ready: {url} (server PID {os.getpid()})", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        _clear_runtime_for_pid(os.getpid())
    return 0


def launch_background() -> int:
    url = configured_url()
    revision = backend_revision(ROOT)
    health = read_health(url)
    if health:
        if health.get("backendRevision") == revision:
            _log_launcher(f"App already running with current code at {url}; opening browser.")
            webbrowser.open(url)
            return 0
        if not _owns_backend(health, url):
            raise RuntimeError(
                "An older or different backend is still running. In the app folder, run "
                "backend\\.venv\\Scripts\\python.exe start_app.py --stop on Windows "
                "(backend/.venv/bin/python start_app.py --stop on macOS/Linux), then launch again "
                "and reconnect to ADO. Do not just refresh the browser."
            )
        _log_launcher("Backend code changed; restarting the recorded app instance.")
        stop_background(expected_instance=health["instanceId"])
        if app_is_ready(url):
            raise RuntimeError("The previous backend did not stop. Close it before launching again.")

    LOG_DIR.mkdir(parents=True, exist_ok=True)
    RUNTIME.mkdir(parents=True, exist_ok=True)
    env = os.environ.copy()
    env["PYTHONUNBUFFERED"] = "1"
    instance_id = uuid.uuid4().hex
    env["ADO_BACKEND_INSTANCE_ID"] = instance_id

    popen_kwargs: dict = {
        "cwd": ROOT,
        "stdin": subprocess.DEVNULL,
        "env": env,
        "close_fds": True,
    }
    if os.name == "nt":
        popen_kwargs["creationflags"] = (
            getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0)
            | getattr(subprocess, "DETACHED_PROCESS", 0)
            | getattr(subprocess, "CREATE_NO_WINDOW", 0)
        )
    else:
        popen_kwargs["start_new_session"] = True

    server_python = ENV_PYTHONW if os.name == "nt" and ENV_PYTHONW.exists() else ENV_PYTHON
    with BACKEND_LOG.open("a", encoding="utf-8") as log:
        process = subprocess.Popen(
            [str(server_python), str(Path(__file__).resolve()), "--serve"],
            stdout=log,
            stderr=subprocess.STDOUT,
            **popen_kwargs,
        )
    _write_runtime(process.pid, url, instance_id)
    _log_launcher(f"Started background backend PID {process.pid}; waiting for {url}.")

    deadline = time.monotonic() + START_TIMEOUT_SECONDS
    last_identity = None
    while time.monotonic() < deadline:
        health = read_health(url)
        serving_pid = _serving_pid(health, revision, instance_id)
        if serving_pid is not None:
            # Track the server itself, not the Windows python[w].exe redirector.
            # The fresh per-launch marker proves it belongs to this startup.
            _write_runtime(serving_pid, url, instance_id)
            _log_launcher(f"App ready at {url}; server PID {serving_pid}, launcher child PID {process.pid}; opening browser.")
            webbrowser.open(url)
            return 0
        if health:
            identity = (health.get("pid"), health.get("backendRevision"), health.get("instanceId"))
            if identity != last_identity:
                _log_launcher(
                    f"Waiting for matching backend: server PID {health.get('pid')}, launcher child PID {process.pid}; "
                    f"revision matches={health.get('backendRevision') == revision}, "
                    f"instance matches={health.get('instanceId') == instance_id}."
                )
                last_identity = identity
        if process.poll() is not None:
            _clear_runtime_for_pid(process.pid)
            raise RuntimeError(
                f"The backend exited during startup. Review {BACKEND_LOG}."
            )
        time.sleep(0.2)

    try:
        process.terminate()
    except OSError:
        pass
    _clear_runtime_for_pid(process.pid)
    reason = ""
    if last_identity is not None:
        reason = " A server answered health checks, but its revision or launch identity did not match; see launcher.log."
    raise RuntimeError(
        f"The backend did not become ready within {START_TIMEOUT_SECONDS} seconds.{reason} Review {BACKEND_LOG}."
    )


def stop_background(expected_instance: str | None = None) -> int:
    pid, url = _read_runtime()
    if expected_instance is not None:
        health = read_health(url)
        if not health or health.get("instanceId") != expected_instance or not _owns_backend(health, url):
            raise RuntimeError("The running app changed before restart. Launch again to recheck it.")
    if not app_is_ready(url):
        _clear_runtime_for_pid(pid)
        _log_launcher("Stop requested, but no running app was detected.")
        return 0
    if not pid:
        raise RuntimeError(
            "The app is running, but its process ID is unavailable. Restart Windows or stop the Python process manually."
        )

    _log_launcher(f"Stopping background backend PID {pid}.")
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(pid), "/T", "/F"],
            check=False,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    else:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass

    deadline = time.monotonic() + 5
    while time.monotonic() < deadline and app_is_ready(url):
        time.sleep(0.15)
    _clear_runtime_for_pid(pid)
    return 0


def main() -> int:
    args = sys.argv[1:]
    if args == ["--serve"]:
        return serve()
    if args == ["--stop"]:
        return stop_background()
    if args:
        raise RuntimeError(f"Unknown argument: {' '.join(args)}")
    setup_environment()
    return launch_background()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        message = f"Setup/startup failed: {error}"
        try:
            _log_launcher(message)
        except OSError:
            pass
        print(message, file=sys.stderr)
        sys.exit(1)
