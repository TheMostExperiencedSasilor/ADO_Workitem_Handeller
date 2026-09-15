import importlib.util
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("start_app_module", ROOT / "start_app.py")
start_app = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(start_app)


def test_configured_url_defaults_to_localhost(monkeypatch, tmp_path):
    backend = tmp_path / "backend"
    backend.mkdir()
    monkeypatch.setattr(start_app, "BACKEND", backend)
    monkeypatch.delenv("FLASK_HOST", raising=False)
    monkeypatch.delenv("FLASK_PORT", raising=False)

    assert start_app.configured_url() == "http://127.0.0.1:5000"


def test_configured_url_uses_env_file_and_maps_wildcard_host(monkeypatch, tmp_path):
    backend = tmp_path / "backend"
    backend.mkdir()
    (backend / ".env").write_text("FLASK_HOST=0.0.0.0\nFLASK_PORT=5055\n", encoding="utf-8")
    monkeypatch.setattr(start_app, "BACKEND", backend)

    assert start_app.configured_url() == "http://127.0.0.1:5055"


def test_exactly_one_user_launcher_per_platform_and_windows_has_no_console_fallback():
    launcher = ROOT / "launcher"
    assert sorted(path.name for path in launcher.iterdir()) == [
        "Start-Linux.sh",
        "Start-Unix.command",
        "Start-Windows.vbs",
    ]

    vbs = (launcher / "Start-Windows.vbs").read_text(encoding="utf-8")
    bootstrap = (ROOT / "start_app.py").read_text(encoding="utf-8")

    assert "Start-App.bat" not in vbs
    assert "pythonw.exe" in vbs
    assert "pyw.exe" in vbs
    assert 'RunCandidate(shell, "py.exe -3"' not in vbs
    assert 'RunCandidate(shell, "python.exe"' not in vbs
    assert "shell.Run(command, 0, True)" in vbs
    assert "ENV_PYTHONW" in bootstrap
    assert "server_python = ENV_PYTHONW" in bootstrap
    assert "Keep this window open" not in bootstrap
    assert "DETACHED_PROCESS" in bootstrap
    assert "CREATE_NO_WINDOW" in bootstrap


def test_second_start_reuses_running_backend(monkeypatch):
    opened = []
    monkeypatch.setattr(start_app, "configured_url", lambda: "http://127.0.0.1:5000")
    monkeypatch.setattr(start_app, "app_is_ready", lambda url: True)
    monkeypatch.setattr(start_app, "_log_launcher", lambda message: None)
    monkeypatch.setattr(start_app.webbrowser, "open", lambda url: opened.append(url))

    assert start_app.launch_background() == 0
    assert opened == ["http://127.0.0.1:5000"]
