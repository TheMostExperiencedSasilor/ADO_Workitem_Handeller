import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from app import create_app
from routes.repo_history_routes import _parse_url, disconnect


@pytest.fixture
def client():
    app = create_app()
    app.config['TESTING'] = True
    with app.test_request_context():
        disconnect()
    return app.test_client()


def test_url_validation():
    assert _parse_url('https://aspentech-alm.visualstudio.com/AspenTech/_git/HYSYS_COM_API') == 'https://aspentech-alm.visualstudio.com/AspenTech/_apis/git/repositories/HYSYS_COM_API'
    for url in ['http://evil.visualstudio.com/p/_git/r', 'https://evil.com/p/_git/r', 'https://a.visualstudio.com.evil.com/p/_git/r', 'https://a.visualstudio.com/p/_git/r%2Fx']:
        with pytest.raises(ValueError):
            _parse_url(url)


class Response:
    status_code = 200
    headers = {}
    def __init__(self, payload): self.payload = payload
    def json(self): return self.payload


def test_session_and_history(client):
    def get(url, **kwargs):
        assert kwargs['auth'] == ('', 'secret')
        if url.endswith('/refs'): return Response({'value': [{'name': 'refs/heads/main'}]})
        if url.endswith('/changes'): return Response({'changes': [{'item': {'path': '/VSTS12.cs', 'gitObjectType': 'blob'}, 'changeType': 'add'}], 'hasMoreChanges': False})
        if url.endswith('/commits'): return Response({'value': [{'commitId': 'a' * 40, 'author': {'name': 'Johnie'}}]})
        return Response({'name': 'HYSYS_COM_API', 'defaultBranch': 'refs/heads/main'})
    with patch('routes.repo_history_routes.requests.get', side_effect=get):
        result = client.post('/api/repo-history/connect', json={'url': 'https://aspentech-alm.visualstudio.com/AspenTech/_git/HYSYS_COM_API', 'pat': 'secret'})
        assert result.status_code == 200
        assert 'secret' not in result.get_data(as_text=True)
        assert result.json['branches'] == ['main']
        assert client.get('/api/repo-history/commits?branch=main').json['commits'][0]['commitId'] == 'a' * 40
        assert client.get('/api/repo-history/changes/' + 'a' * 40).json['changes'][0]['item']['path'] == '/VSTS12.cs'
        client.post('/api/repo-history/disconnect')
        assert client.get('/api/repo-history/commits?branch=main').status_code == 400
