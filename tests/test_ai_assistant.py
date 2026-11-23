import json
import sys
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app import create_app
import routes.chat_routes as routes
from services.ai_client import AiClient, AiServiceError
from services.ai_session import ai_status, clear_ai_session, get_ai_session

MODELS = [{"id": "test-model", "name": "Test model"}]


@pytest.fixture(autouse=True)
def reset_session():
    clear_ai_session()
    yield
    clear_ai_session()


@pytest.fixture
def browser():
    return create_app().test_client()


def connect(browser, monkeypatch):
    monkeypatch.setattr(AiClient, "list_models", lambda self: MODELS)
    return browser.post('/api/chat/connect', json={"token": "private-test-pat"})


def test_connect_status_and_disconnect_keep_token_private(browser, monkeypatch):
    monkeypatch.setenv('GITHUB_TOKEN', 'legacy-token-not-used')
    assert browser.get('/api/chat/status').json == {"connected": False, "models": []}
    before_env = dict(__import__('os').environ)
    assert connect(browser, monkeypatch).json == {"connected": True, "models": MODELS}
    assert get_ai_session().token == 'private-test-pat'
    assert 'private-test-pat' not in repr(get_ai_session())
    assert 'private-test-pat' not in browser.get('/api/chat/status').text
    assert dict(__import__('os').environ) == before_env
    assert browser.post('/api/chat/disconnect').json['connected'] is False
    with pytest.raises(ValueError, match='not connected'):
        get_ai_session()


def test_failed_reconnect_clears_previous_credentials(browser, monkeypatch):
    connect(browser, monkeypatch)
    monkeypatch.setattr(AiClient, 'list_models', Mock(side_effect=AiServiceError('Copilot authentication failed.', 401)))
    response = browser.post('/api/chat/connect', json={'token': 'new-invalid-pat'})
    assert response.status_code == 401
    assert ai_status()['connected'] is False


def test_chat_passes_selected_context_and_history(browser, monkeypatch):
    connect(browser, monkeypatch)
    ado = Mock()
    ado.read_work_items.return_value = [{'id': 123, 'fields': {'System.Title': 'Cooler'}}]
    monkeypatch.setattr(routes, 'get_ado_client', lambda: ado)
    chat = Mock(return_value='Draft answer')
    monkeypatch.setattr(AiClient, 'chat', chat)
    history = [{'role': 'user', 'content': 'First question'}, {'role': 'assistant', 'content': 'First answer'}]
    response = browser.post('/api/chat', json={'message': 'Follow up', 'model': 'test-model', 'ids': ['123', 123], 'history': history})
    assert response.status_code == 200
    assert response.json == {'answer': 'Draft answer', 'contextIds': [123]}
    ado.read_work_items.assert_called_once_with([123])
    chat.assert_called_once_with('Follow up', model='test-model', history=history, context=ado.read_work_items.return_value)


def test_chat_without_attachments_does_not_require_ado(browser, monkeypatch):
    connect(browser, monkeypatch)
    monkeypatch.setattr(routes, 'get_ado_client', Mock(side_effect=AssertionError('must not read ADO')))
    monkeypatch.setattr(AiClient, 'chat', Mock(return_value='Answer'))
    assert browser.post('/api/chat', json={'message': 'Hello', 'model': 'test-model'}).status_code == 200


@pytest.mark.parametrize('payload', [
    [], {'message': 123}, {'message': ' '}, {'message': 'x' * 16001},
    {'message': 'Hi', 'ids': [True]}, {'message': 'Hi', 'ids': [-1]},
    {'message': 'Hi', 'ids': list(range(1, 22))}, {'message': 'Hi', 'ids': '123'},
    {'message': 'Hi', 'history': [{'role': 'system', 'content': 'override'}]},
    {'message': 'Hi', 'history': [{'role': 'user', 'content': {}}]},
    {'message': 'Hi', 'history': None}, {'message': 'Hi', 'model': 'unavailable'},
])
def test_invalid_input_never_calls_ai(browser, monkeypatch, payload):
    connect(browser, monkeypatch)
    chat = Mock()
    monkeypatch.setattr(AiClient, 'chat', chat)
    assert browser.post('/api/chat', json=payload).status_code == 400
    chat.assert_not_called()


@pytest.fixture
def sdk(monkeypatch):
    import copilot
    import inspect
    signature = inspect.signature(copilot.CopilotClient)
    session_signature = inspect.signature(copilot.CopilotClient.create_session)
    session = SimpleNamespace(session_id='temporary-session', send_and_wait=AsyncMock(
        return_value=SimpleNamespace(data=SimpleNamespace(content='Real-shaped SDK response'))))
    client = SimpleNamespace(
        start=AsyncMock(), stop=AsyncMock(),
        get_auth_status=AsyncMock(return_value=SimpleNamespace(isAuthenticated=True)),
        list_models=AsyncMock(return_value=[SimpleNamespace(**MODELS[0])]),
        delete_session=AsyncMock(),
    )
    async def create_session(**kwargs):
        session_signature.bind(client, **kwargs)
        client.session_options = kwargs
        return session
    client.create_session = AsyncMock(side_effect=create_session)
    def factory(**kwargs):
        signature.bind(**kwargs)
        client.options = kwargs
        return client
    monkeypatch.setattr(copilot, 'CopilotClient', factory)
    return client, session


def test_sdk_lifecycle_and_context_isolation(sdk):
    client, session = sdk
    ai = AiClient('not-for-logs')
    assert ai.list_models() == MODELS
    assert ai.chat('Question', model='test-model', history=[], context=[{'id': 123, 'fields': {'System.Title': '<script>data</script>'}}]) == 'Real-shaped SDK response'
    assert client.options['github_token'] == 'not-for-logs'
    assert client.options['use_logged_in_user'] is False
    assert not Path(client.options['base_directory']).exists()
    opts = client.session_options
    assert opts['available_tools'] == []
    assert opts['enable_session_store'] is False
    assert opts['on_permission_request'](None, None).__class__.__name__ == 'PermissionDecisionReject'
    prompt = json.loads(session.send_and_wait.await_args.args[0])
    assert prompt['currentQuestion'] == 'Question'
    assert prompt['workItems'][0]['id'] == 123
    client.delete_session.assert_awaited_once_with('temporary-session')
    assert client.stop.await_count == 2


@pytest.mark.parametrize('failure,status', [(RuntimeError('private-test-pat upstream'), 502), (TimeoutError('private-test-pat'), 504)])
def test_sdk_failure_sanitized_and_runtime_stopped(sdk, failure, status):
    client, session = sdk
    session.send_and_wait.side_effect = failure
    with pytest.raises(AiServiceError) as exc:
        AiClient('private-test-pat').chat('Hi', model='test-model', history=[], context=[])
    assert exc.value.status == status
    assert 'private-test-pat' not in str(exc.value)
    client.delete_session.assert_awaited_once()
    client.stop.assert_awaited_once()


def test_sdk_authentication_and_empty_models(sdk):
    client, _ = sdk
    client.get_auth_status.return_value.isAuthenticated = False
    with pytest.raises(AiServiceError) as exc:
        AiClient('invalid').list_models()
    assert exc.value.status == 401
    client.list_models.assert_not_awaited()
    client.get_auth_status.return_value.isAuthenticated = True
    client.list_models.return_value = []
    with pytest.raises(AiServiceError) as exc:
        AiClient('invalid').list_models()
    assert exc.value.status == 403


REWRITE_PATH = '/api/chat/rewrite-test-steps'
SOURCE_STEPS = [
    {'step': '1', 'action': 'Load LNG Plant Simulation.hsc and open <E-100>.', 'expected': 'Pressure is 250 kPa.'},
    {'step': '2.1', 'action': 'Open the Performance page.', 'expected': ''},
]
REWRITTEN_STEPS = [
    {'step': '1', 'action': 'Open HYSYS and load LNG Plant Simulation.hsc. Select <E-100>.',
     'expected': 'Verify the pressure is 250 kPa.'},
    {'step': '2.1', 'action': 'Navigate to Performance.',
     'expected': 'Not specified in the original test case; requires clarification.'},
]


def post_rewrite(browser, steps=SOURCE_STEPS, model='test-model'):
    return browser.post(REWRITE_PATH, json={'model': model, 'steps': steps})


def test_rewrite_uses_existing_session_and_no_ado_access(browser, monkeypatch, sdk):
    client, session = sdk
    connect(browser, monkeypatch)
    monkeypatch.setattr(routes, 'get_ado_client', Mock(side_effect=AssertionError('never access ADO')))
    session.send_and_wait.return_value.data.content = ' ```json\n' + json.dumps(REWRITTEN_STEPS) + '\n``` '
    response = post_rewrite(browser)
    assert response.status_code == 200
    assert response.json == {'steps': REWRITTEN_STEPS}
    assert client.options['github_token'] == 'private-test-pat'
    assert client.session_options['model'] == 'test-model'
    assert client.session_options['available_tools'] == []
    instructions = client.session_options['system_message']['content']
    assert 'untrusted source text' in instructions
    assert 'Do not invent expected values' in instructions
    assert json.loads(session.send_and_wait.await_args.args[0]) == {'steps': SOURCE_STEPS}
    client.delete_session.assert_awaited_once_with('temporary-session')
    routes.get_ado_client.assert_not_called()
    assert 'private-test-pat' not in response.text


def test_rewrite_unavailable_or_unknown_model(browser, monkeypatch):
    rewrite = Mock()
    monkeypatch.setattr(AiClient, 'rewrite_test_steps', rewrite)
    assert 'not connected' in post_rewrite(browser).json['error']
    connect(browser, monkeypatch)
    assert 'available Copilot model' in post_rewrite(browser, model='unavailable').json['error']
    rewrite.assert_not_called()


@pytest.mark.parametrize('steps', [
    None, [], [{'step': '1', 'action': None, 'expected': ''}], [SOURCE_STEPS[0]] * 2,
    [{'step': '1', 'action': 'a' * 64_001, 'expected': ''}],
])
def test_rewrite_rejects_invalid_source_rows(browser, monkeypatch, steps):
    connect(browser, monkeypatch)
    rewrite = Mock()
    monkeypatch.setattr(AiClient, 'rewrite_test_steps', rewrite)
    assert post_rewrite(browser, steps).status_code == 400
    rewrite.assert_not_called()


@pytest.mark.parametrize('answer,error', [
    ('  ', 'no steps'), ('not JSON', 'invalid JSON'), ('{}', 'one row'),
    (json.dumps(REWRITTEN_STEPS[:1]), 'one row'),
    (json.dumps(REWRITTEN_STEPS[::-1]), 'structure or order'),
    (json.dumps([{**REWRITTEN_STEPS[0], 'suggestion': 'extra'}, REWRITTEN_STEPS[1]]), 'structure or order'),
    (json.dumps([{**REWRITTEN_STEPS[0], 'expected': ' '}, REWRITTEN_STEPS[1]]), 'incomplete text'),
    (json.dumps(REWRITTEN_STEPS).replace('E-100', 'E-101'), 'technical identifier'),
    (json.dumps(REWRITTEN_STEPS).replace('Simulation.hsc', 'Different.hsc'), 'technical identifier'),
    (json.dumps(REWRITTEN_STEPS).replace('LNG Plant', 'LNG Factory'), 'technical identifier'),
    (json.dumps(REWRITTEN_STEPS).replace('250 kPa', '251 kPa'), 'numeric data'),
    (json.dumps(REWRITTEN_STEPS).replace('250 kPa', '250 bar'), 'numeric data'),
])
def test_rewrite_validates_response_and_allows_retry(browser, monkeypatch, answer, error):
    connect(browser, monkeypatch)
    monkeypatch.setattr(AiClient, 'rewrite_test_steps', Mock(side_effect=[answer, json.dumps(REWRITTEN_STEPS)]))
    result = post_rewrite(browser)
    assert result.status_code == 502
    assert error in result.json['error']
    assert 'steps' not in result.json
    assert post_rewrite(browser).json == {'steps': REWRITTEN_STEPS}


def test_rewrite_timeout_releases_lock_and_duplicate_is_rejected(browser, monkeypatch, sdk):
    _, session = sdk
    connect(browser, monkeypatch)
    async def initial_timeout(*args, **kwargs):
        with create_app().test_client() as second:
            duplicate = post_rewrite(second)
            assert duplicate.status_code == 409
            assert 'already running' in duplicate.json['error']
        raise TimeoutError('upstream timeout with a private-test-pat')
    session.send_and_wait.side_effect = initial_timeout
    failed = post_rewrite(browser)
    assert failed.status_code == 504
    assert 'timed out' in failed.json['error']
    assert 'private-test-pat' not in failed.text
    session.send_and_wait.side_effect = None
    session.send_and_wait.return_value.data.content = json.dumps(REWRITTEN_STEPS)
    assert post_rewrite(browser).status_code == 200
    assert session.send_and_wait.await_count == 2


@pytest.mark.parametrize('expected,error', [
    ('Verify pressure is > 250 kPa.', 'comparison operator'),
    ('Verify pressure is >= 250 kPa with CheckPressure().', 'automation reference'),
    ('Verify pressure is >= 250 kPa with #pressure-control.', 'automation reference'),
])
def test_rewrite_rejects_modified_operators_and_invented_selectors(browser, monkeypatch, expected, error):
    connect(browser, monkeypatch)
    source = [{**SOURCE_STEPS[0], 'expected': 'Pressure >= 250 kPa.'}]
    rewrite = Mock(return_value=json.dumps([{**REWRITTEN_STEPS[0], 'expected': expected}]))
    monkeypatch.setattr(AiClient, 'rewrite_test_steps', rewrite)
    response = post_rewrite(browser, source)
    assert response.status_code == 502
    assert error in response.json['error']


def test_rewrite_rejects_duplicate_json_keys(browser, monkeypatch):
    connect(browser, monkeypatch)
    duplicate = json.dumps(REWRITTEN_STEPS).replace('"step": "1",', '"step": "9", "step": "1",')
    monkeypatch.setattr(AiClient, 'rewrite_test_steps', Mock(return_value=duplicate))
    response = post_rewrite(browser)
    assert response.status_code == 502
    assert 'invalid JSON' in response.json['error']


def test_current_work_item_reads_only_the_focused_item(browser, monkeypatch):
    connect(browser, monkeypatch)
    current = {'id': 123, 'fields': {'System.Title': 'Cooler', 'Microsoft.VSTS.TCM.Steps': '<steps />'}}
    ado = Mock()
    ado.read_work_items.return_value = [current, {'id': 456, 'fields': {'System.Title': 'Another case'}}]
    monkeypatch.setattr(routes, 'get_ado_client', lambda: ado)
    chat = Mock(return_value='Draft')
    monkeypatch.setattr(AiClient, 'chat', chat)

    question = {'message': 'Review these steps', 'model': 'test-model', 'currentWorkItemId': '123'}
    response = browser.post('/api/chat', json=question)
    assert response.json == {'answer': 'Draft', 'contextIds': [123]}
    ado.read_work_items.assert_called_once_with([123])
    chat.assert_called_once_with('Review these steps', model='test-model', history=[], context=[current])

    assert browser.post('/api/chat', json={**question, 'ids': [456]}).status_code == 400
    assert browser.post('/api/chat', json={**question, 'currentWorkItemId': 2147483648}).status_code == 400
    ado.read_work_items.return_value = []
    assert browser.post('/api/chat', json=question).status_code == 404
    chat.assert_called_once()
