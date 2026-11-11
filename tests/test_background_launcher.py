import importlib.util
import json
from unittest.mock import Mock

import pytest
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


def test_windows_launcher_uses_ps2exe_and_a_windowless_python_bootstrap():
    launcher = ROOT / "launcher"
    assert sorted(path.name for path in launcher.iterdir()) == [
        "ADOWorkItemLauncher.exe",
        "Start-Linux.sh",
        "Start-Unix.command",
        "Start-Windows.ps1",
        "build_launcher.ps1",
    ]

    windows = (launcher / "Start-Windows.ps1").read_text(encoding="utf-8")
    build = (launcher / "build_launcher.ps1").read_text(encoding="utf-8")
    bootstrap = (ROOT / "start_app.py").read_text(encoding="utf-8")

    assert "pythonw.exe" in windows
    assert "pyw.exe" in windows
    assert "-WindowStyle Hidden -PassThru" in windows
    assert "$process.WaitForExit()" in windows
    assert "-noConsole" in build
    assert "ENV_PYTHONW" in bootstrap
    assert "server_python = ENV_PYTHONW" in bootstrap
    assert "Keep this window open" not in bootstrap
    assert "DETACHED_PROCESS" in bootstrap
    assert "CREATE_NO_WINDOW" in bootstrap


def test_second_start_reuses_running_backend(monkeypatch):
    opened = []
    monkeypatch.setattr(start_app, "configured_url", lambda: "http://127.0.0.1:5000")
    monkeypatch.setattr(start_app, "read_health", lambda url: {"status": "ok", "backendRevision": "current"})
    monkeypatch.setattr(start_app, "backend_revision", lambda root: "current")
    monkeypatch.setattr(start_app, "_log_launcher", lambda message: None)
    monkeypatch.setattr(start_app.webbrowser, "open", lambda url: opened.append(url))

    assert start_app.launch_background() == 0
    assert opened == ["http://127.0.0.1:5000"]


@pytest.fixture
def launch_env(monkeypatch, tmp_path):
    monkeypatch.setattr(start_app, "LOG_DIR", tmp_path / "logs")
    monkeypatch.setattr(start_app, "BACKEND_LOG", tmp_path / "logs" / "backend.log")
    monkeypatch.setattr(start_app, "RUNTIME", tmp_path / "runtime")
    monkeypatch.setattr(start_app, "PID_FILE", tmp_path / "runtime" / "backend.json")
    monkeypatch.setattr(start_app, "configured_url", lambda: "http://127.0.0.1:5000")
    monkeypatch.setattr(start_app, "backend_revision", lambda root: "current")
    monkeypatch.setattr(start_app, "_log_launcher", Mock())
    monkeypatch.setattr(start_app.webbrowser, "open", Mock())
    process = Mock(pid=456)
    process.poll.return_value = None
    spawn = Mock(return_value=process)
    monkeypatch.setattr(start_app.subprocess, "Popen", spawn)
    return process, spawn


@pytest.mark.parametrize("health", [
    {"status": "ok"},
    {"status": "ok", "backendRevision": "old", "pid": 123, "instanceId": "different"},
])
def test_legacy_or_unowned_server_requires_one_time_restart(launch_env, monkeypatch, health):
    process, spawn = launch_env
    monkeypatch.setattr(start_app, "read_health", lambda url: health)
    stop = Mock()
    monkeypatch.setattr(start_app, "stop_background", stop)
    with pytest.raises(RuntimeError, match="start_app.py --stop"):
        start_app.launch_background()
    stop.assert_not_called()
    spawn.assert_not_called()
    start_app.webbrowser.open.assert_not_called()


def test_outdated_owned_backend_restarts_and_opens_only_matching_new_instance(launch_env, monkeypatch):
    process, spawn = launch_env
    url = start_app.configured_url()
    old = {"status": "ok", "backendRevision": "old", "pid": 123, "instanceId": "old-instance"}
    start_app._write_runtime(123, url, "old-instance")
    monkeypatch.setattr(start_app.uuid, "uuid4", lambda: Mock(hex="new-instance"))
    health = Mock(side_effect=[old, None, {"status": "ok", "backendRevision": "current", "pid": 456, "instanceId": "new-instance"}])
    monkeypatch.setattr(start_app, "read_health", health)
    stop = Mock(return_value=0)
    monkeypatch.setattr(start_app, "stop_background", stop)
    assert start_app.launch_background() == 0
    stop.assert_called_once_with(expected_instance="old-instance")
    assert spawn.call_args.kwargs["env"]["ADO_BACKEND_INSTANCE_ID"] == "new-instance"
    assert json.loads(start_app.PID_FILE.read_text())["instanceId"] == "new-instance"
    start_app.webbrowser.open.assert_called_once_with(url)


def test_stop_failure_does_not_spawn_a_duplicate_backend(launch_env, monkeypatch):
    process, spawn = launch_env
    url = start_app.configured_url()
    old = {"status": "ok", "backendRevision": "old", "pid": 123, "instanceId": "old-instance"}
    start_app._write_runtime(123, url, "old-instance")
    monkeypatch.setattr(start_app, "read_health", lambda url: old)
    monkeypatch.setattr(start_app, "stop_background", Mock(return_value=0))
    with pytest.raises(RuntimeError, match="did not stop"):
        start_app.launch_background()
    spawn.assert_not_called()
    start_app.webbrowser.open.assert_not_called()


def test_restart_rechecks_instance_before_stopping_process(launch_env, monkeypatch):
    start_app._write_runtime(123, start_app.configured_url(), "old-instance")
    monkeypatch.setattr(start_app, "read_health", lambda url: {"status": "ok", "pid": 123, "instanceId": "replacement"})
    kill = Mock()
    monkeypatch.setattr(start_app.os, "kill", kill)
    with pytest.raises(RuntimeError, match="changed before restart"):
        start_app.stop_background(expected_instance="old-instance")
    kill.assert_not_called()


def test_new_server_must_match_version_pid_and_instance_before_opening(launch_env, monkeypatch):
    process, spawn = launch_env
    monkeypatch.setattr(start_app.uuid, "uuid4", lambda: Mock(hex="new-instance"))
    process.poll.return_value = 1
    monkeypatch.setattr(start_app, "read_health", Mock(side_effect=[None,
        {"status": "ok", "backendRevision": "current", "pid": 999, "instanceId": "different"}]))
    with pytest.raises(RuntimeError, match="exited during startup"):
        start_app.launch_background()
    start_app.webbrowser.open.assert_not_called()


@pytest.mark.parametrize("body, expected", [
    (b'{"status":"ok"}', {"status": "ok"}), (b'{"status":"stopped"}', None),
    (b'[]', None), (b'not-json', None),
])
def test_health_reader_handles_legacy_and_invalid_payloads(monkeypatch, body, expected):
    response = Mock(status=200)
    response.read.return_value = body
    context = Mock()
    context.__enter__ = Mock(return_value=response)
    context.__exit__ = Mock(return_value=None)
    monkeypatch.setattr(start_app.urllib.request, "urlopen", Mock(return_value=context))
    assert start_app.read_health("http://localhost:5000") == expected
