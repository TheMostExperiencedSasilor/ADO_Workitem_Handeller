"""Set up the local environment and launch the existing Flask application."""
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import threading
import venv
import webbrowser

ROOT = Path(__file__).resolve().parent
BACKEND = ROOT / "backend"
ENV = BACKEND / ".venv"
ENV_PYTHON = ENV / ("Scripts/python.exe" if os.name == "nt" else "bin/python")


def setup_environment():
    if sys.version_info < (3, 10):
        raise RuntimeError("Python 3.10 or newer is required.")
    if not ENV_PYTHON.exists():
        print("Creating the app's Python environment...", flush=True)
        venv.EnvBuilder(with_pip=True).create(ENV)
    requirements = BACKEND / "requirements.txt"
    digest = hashlib.sha256(requirements.read_bytes()).hexdigest()
    stamp = ENV / ".requirements.sha256"
    if not stamp.exists() or stamp.read_text().strip() != digest:
        print("Installing dependencies (first run or requirements changed)...", flush=True)
        subprocess.run(
            [str(ENV_PYTHON), "-m", "pip", "install", "-r", str(requirements)],
            cwd=BACKEND, check=True,
        )
        stamp.write_text(digest)


def serve():
    os.chdir(BACKEND)
    sys.path.insert(0, str(BACKEND))
    from app import create_app
    from config import AppConfig
    from werkzeug.serving import make_server

    config = AppConfig.from_env()
    host = config.flask_host
    browser_host = "127.0.0.1" if host == "0.0.0.0" else "::1" if host == "::" else host
    if ":" in browser_host:
        browser_host = f"[{browser_host}]"
    # Bind first: if the port is occupied, do not open an unrelated server.
    server = make_server(host, config.flask_port, create_app(), threaded=True)
    url = f"http://{browser_host}:{server.server_port}"
    print(f"\nApp ready: {url}\nKeep this window open. Press Ctrl+C to stop.\n", flush=True)

    def open_browser():
        try:
            webbrowser.open(url)
        except Exception:
            print(f"Open {url} in your browser.", flush=True)

    threading.Thread(target=open_browser, daemon=True).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


def main():
    if sys.argv[1:] == ["--serve"]:
        return serve()
    setup_environment()
    try:
        return subprocess.call([str(ENV_PYTHON), str(Path(__file__).resolve()), "--serve"], cwd=BACKEND)
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"Setup/startup failed: {error}", file=sys.stderr)
        sys.exit(1)
