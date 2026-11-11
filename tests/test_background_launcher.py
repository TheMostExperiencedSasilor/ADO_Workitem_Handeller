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


def test_new_server_with_another_launch_identity_is_rejected(launch_env, monkeypatch):
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


def test_windows_redirector_accepts_different_serving_pid_and_records_it(launch_env, monkeypatch):
    process, spawn = launch_env
    monkeypatch.setattr(start_app.uuid, 'uuid4', lambda: Mock(hex='new-instance'))
    health = {'status': 'ok', 'backendRevision': 'current', 'pid': 789, 'instanceId': 'new-instance'}
    monkeypatch.setattr(start_app, 'read_health', Mock(side_effect=[None, health]))
    assert process.pid != health['pid']  # venv pythonw.exe wrapper versus serving interpreter
    assert start_app.launch_background() == 0
    runtime = json.loads(start_app.PID_FILE.read_text())
    assert runtime == {'pid': 789, 'url': start_app.configured_url(), 'instanceId': 'new-instance'}
    assert start_app._owns_backend(health, start_app.configured_url())
    start_app.webbrowser.open.assert_called_once_with(start_app.configured_url())
    process.terminate.assert_not_called()
    assert any('server PID 789, launcher child PID 456' in call.args[0]
               for call in start_app._log_launcher.call_args_list)


@pytest.mark.parametrize('revision, instance_id, pid', [
    ('old', 'new-instance', 789), ('current', 'other-instance', 789),
    ('current', 'new-instance', 0), ('current', 'new-instance', -1),
    ('current', 'new-instance', True), ('current', 'new-instance', '789'),
    ('current', 'new-instance', None),
])
def test_new_backend_requires_matching_identity_revision_and_valid_pid(revision, instance_id, pid):
    assert start_app._serving_pid({'backendRevision': revision, 'instanceId': instance_id, 'pid': pid},
                                 'current', 'new-instance') is None


def test_windows_stop_targets_recorded_serving_pid_not_redirector(launch_env, monkeypatch):
    from types import SimpleNamespace
    url = start_app.configured_url()
    start_app._write_runtime(789, url, 'new-instance')
    health = {'status': 'ok', 'backendRevision': 'current', 'pid': 789, 'instanceId': 'new-instance'}
    monkeypatch.setattr(start_app, 'read_health', Mock(side_effect=[health, health, None]))
    monkeypatch.setattr(start_app, 'os', SimpleNamespace(name='nt'))
    terminate = Mock()
    monkeypatch.setattr(start_app.subprocess, 'run', terminate)
    assert start_app.stop_background(expected_instance='new-instance') == 0
    assert terminate.call_args.args[0] == ['taskkill', '/PID', '789', '/T', '/F']
    assert not start_app.PID_FILE.exists()


def test_timeout_explains_healthy_server_identity_mismatch(launch_env, monkeypatch):
    process, spawn = launch_env
    monkeypatch.setattr(start_app.uuid, 'uuid4', lambda: Mock(hex='new-instance'))
    health = {'status': 'ok', 'backendRevision': 'other-code', 'pid': 789, 'instanceId': 'new-instance'}
    monkeypatch.setattr(start_app, 'read_health', Mock(side_effect=[None, health, health]))
    monkeypatch.setattr(start_app.time, 'monotonic', Mock(side_effect=[0, 0, 1, 31]))
    monkeypatch.setattr(start_app.time, 'sleep', Mock())
    with pytest.raises(RuntimeError, match='server answered health checks'):
        start_app.launch_background()
    messages = [call.args[0] for call in start_app._log_launcher.call_args_list]
    identity_messages = [message for message in messages if message.startswith('Waiting for matching backend:')]
    assert len(identity_messages) == 1
    assert 'server PID 789, launcher child PID 456' in identity_messages[0]
    assert 'revision matches=False, instance matches=True' in identity_messages[0]
    process.terminate.assert_called_once()
    start_app.webbrowser.open.assert_not_called()


@pytest.mark.skipif(__import__('os').name == 'nt', reason='POSIX wrapper emulates Windows venv parent/child behavior')
def test_real_redirector_process_launches_backend_and_stops_actual_server(monkeypatch, tmp_path):
    """Exercise HTTP health and two real PIDs, not mocked process responses."""
    import os
    import shutil
    import signal
    import socket
    import subprocess
    import sys
    import urllib.request

    root = tmp_path / 'app'
    root.mkdir()
    shutil.copy(ROOT / 'start_app.py', root / 'start_app.py')
    shutil.copytree(ROOT / 'backend', root / 'backend',
                    ignore=shutil.ignore_patterns('.*', '__pycache__'))
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        port = listener.getsockname()[1]
    monkeypatch.setenv('FLASK_HOST', '127.0.0.1')
    monkeypatch.setenv('FLASK_PORT', str(port))
    wrapper = tmp_path / 'python-redirector'
    wrapper.write_text(f'#!{sys.executable}\nimport subprocess, sys\n'
                       'child = subprocess.Popen([sys.executable, *sys.argv[1:]])\n'
                       'sys.exit(child.wait())\n')
    wrapper.chmod(0o755)
    for name, value in {
        'ROOT': root, 'BACKEND': root / 'backend', '__file__': str(root / 'start_app.py'),
        'ENV_PYTHON': wrapper, 'RUNTIME': root / '.runtime', 'PID_FILE': root / '.runtime' / 'backend.json',
        'LOG_DIR': root / 'logs', 'BACKEND_LOG': root / 'logs' / 'backend.log',
        'LAUNCHER_LOG': root / 'logs' / 'launcher.log', 'START_TIMEOUT_SECONDS': 5,
    }.items():
        monkeypatch.setattr(start_app, name, value)
    opened = Mock()
    monkeypatch.setattr(start_app.webbrowser, 'open', opened)
    monkeypatch.setattr(start_app.urllib.request, 'urlopen', urllib.request.build_opener(urllib.request.ProxyHandler({})).open)
    real_popen = subprocess.Popen
    children = []
    def spawn(*args, **kwargs):
        process = real_popen(*args, **kwargs)
        children.append(process)
        return process
    monkeypatch.setattr(start_app.subprocess, 'Popen', spawn)
    try:
        assert start_app.launch_background() == 0
        health = start_app.read_health(start_app.configured_url())
        assert health['pid'] != children[0].pid
        runtime = json.loads(start_app.PID_FILE.read_text())
        assert runtime['pid'] == health['pid']
        assert runtime['instanceId'] == health['instanceId']
        opened.assert_called_once_with(start_app.configured_url())
        assert start_app.stop_background(expected_instance=health['instanceId']) == 0
        children[0].wait(timeout=5)
        assert not start_app.app_is_ready(start_app.configured_url())
        assert not start_app.PID_FILE.exists()
    finally:
        # Only this test's detached process group; also clean up on regression.
        for process in children:
            try:
                os.killpg(process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
            process.wait(timeout=5)
