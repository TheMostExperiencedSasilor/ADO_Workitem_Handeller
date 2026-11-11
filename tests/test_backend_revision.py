import os
import sys
from pathlib import Path
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from app import create_app
from services.backend_revision import backend_revision


def test_revision_tracks_python_requirements_and_launcher_but_not_frontend_or_environment(tmp_path):
    (tmp_path / 'backend').mkdir()
    paths = ['start_app.py', 'backend/requirements.txt', 'backend/app.py']
    for name in paths:
        (tmp_path / name).write_text('initial')
    initial = backend_revision(tmp_path)
    for name in ['backend/.env', 'backend/.venv/secret.py', 'backend/__pycache__/ignore.py', 'frontend/app.js']:
        path = tmp_path / name
        path.parent.mkdir(exist_ok=True, parents=True)
        path.write_text('ignored')
    assert backend_revision(tmp_path) == initial
    for name in paths:
        path = tmp_path / name
        path.write_text('changed')
        assert backend_revision(tmp_path) != initial
        path.write_text('initial')
    assert backend_revision(tmp_path) == initial
    (tmp_path / 'backend' / 'new_route.py').write_text('new')
    assert backend_revision(tmp_path) != initial


def test_health_captures_loaded_version_and_instance_at_startup(monkeypatch):
    revision = Mock(return_value='loaded-code')
    monkeypatch.setattr('app.backend_revision', revision)
    monkeypatch.setenv('ADO_BACKEND_INSTANCE_ID', 'server-instance')
    client = create_app().test_client()
    revision.return_value = 'updated-code-on-disk'
    monkeypatch.setenv('ADO_BACKEND_INSTANCE_ID', 'changed-later')
    response = client.get('/api/health')
    assert response.json == {'status': 'ok', 'backendRevision': 'loaded-code', 'instanceId': 'server-instance', 'pid': os.getpid()}
    revision.assert_called_once()
    assert response.headers['Cache-Control'] == 'no-store'


def test_http_errors_keep_status_codes_and_post_search_routes_to_handler(monkeypatch):
    client = create_app().test_client()
    assert client.get('/api/work-items/test-cases/search').status_code == 404
    assert client.post('/index.html').status_code == 405
    assert client.get('/missing-file.js').status_code == 404
    search = Mock(return_value=[{'id': 25955, 'title': 'Case'}])
    monkeypatch.setattr('routes.work_item_routes.get_ado_client', Mock())
    monkeypatch.setattr('routes.work_item_routes.TestCaseBrowser.search', search)
    response = client.post('/api/work-items/test-cases/search', json={'field': 'id', 'mode': 'exact', 'query': '25955'})
    assert response.status_code == 200
    assert response.json['testCases'][0]['id'] == 25955
    search.assert_called_once_with('id', 'exact', '25955')
    assert response.headers['Cache-Control'] == 'no-store'
