import re
from threading import RLock
from urllib.parse import quote, unquote, urlsplit

import requests
from flask import Blueprint, jsonify, request

repo_history_bp = Blueprint('repo_history', __name__, url_prefix='/api/repo-history')
_lock = RLock()
_session = None


def _parse_url(value):
    url = urlsplit(value.strip())
    host = (url.hostname or '').lower()
    if url.scheme != 'https' or url.username or url.password or url.port or not re.fullmatch(r'[a-z0-9-]+\.visualstudio\.com', host):
        raise ValueError('Enter a valid HTTPS visualstudio.com repository URL.')
    parts = [unquote(x) for x in url.path.split('/') if x]
    if len(parts) != 3 or parts[1] != '_git' or any('/' in x or x in ('.', '..') for x in parts):
        raise ValueError('Expected a URL ending in /project/_git/repository.')
    return f'https://{host}/{quote(parts[0], safe="")}/_apis/git/repositories/{quote(parts[2], safe="")}'


def _get(base, pat, suffix='', params=None):
    response = requests.get(base + suffix, params={'api-version': '7.1', **(params or {})}, auth=('', pat), timeout=30, allow_redirects=False)
    if response.status_code in (401, 403):
        raise ValueError('Authentication or repository access failed. Check the PAT and Code read permission.')
    if response.status_code != 200:
        raise ValueError(f'Azure DevOps request failed (HTTP {response.status_code}).')
    return response.json()


def _current():
    with _lock:
        if _session is None:
            raise ValueError('Connect to the repository first.')
        return _session


@repo_history_bp.post('/connect')
def connect():
    global _session
    data = request.get_json(silent=True) or {}
    base = _parse_url(str(data.get('url', '')))
    pat = str(data.get('pat', '')).strip()
    if not pat:
        raise ValueError('Enter a PAT.')
    with _lock:
        _session = None
    repo = _get(base, pat)
    branches = []
    continuation = None
    while True:
        params = {'filter': 'heads/', '$top': 1000}
        if continuation:
            params['continuationToken'] = continuation
        # Azure DevOps returns continuation in the response header; request directly.
        response = requests.get(base + '/refs', params={'api-version': '7.1', **params}, auth=('', pat), timeout=30, allow_redirects=False)
        if response.status_code != 200:
            raise ValueError(f'Could not load branches (HTTP {response.status_code}).')
        branches.extend(item['name'].removeprefix('refs/heads/') for item in response.json().get('value', []))
        continuation = response.headers.get('x-ms-continuationtoken')
        if not continuation:
            break
    with _lock:
        _session = (base, pat)
    return jsonify(name=repo.get('name'), defaultBranch=repo.get('defaultBranch', '').removeprefix('refs/heads/'), branches=branches)


@repo_history_bp.post('/disconnect')
def disconnect():
    global _session
    with _lock:
        _session = None
    return jsonify(connected=False)


@repo_history_bp.get('/commits')
def commits():
    base, pat = _current()
    branch = request.args.get('branch', '')
    if not branch:
        raise ValueError('Select a branch.')
    skip = max(0, int(request.args.get('skip', '0')))
    data = _get(base, pat, '/commits', {'searchCriteria.itemVersion.version': branch, 'searchCriteria.itemVersion.versionType': 'branch', 'searchCriteria.$skip': skip, 'searchCriteria.$top': 50})
    return jsonify(commits=data.get('value', []))


@repo_history_bp.get('/changes/<commit_id>')
def changes(commit_id):
    base, pat = _current()
    if not re.fullmatch(r'[0-9a-fA-F]{40}', commit_id):
        raise ValueError('Invalid commit ID.')
    skip = max(0, int(request.args.get('skip', '0')))
    data = _get(base, pat, f'/commits/{commit_id}/changes', {'$skip': skip, '$top': 1000})
    return jsonify(changes=data.get('changes', []), hasMore=data.get('hasMoreChanges', False))
