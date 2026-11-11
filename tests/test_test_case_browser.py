import sys
from dataclasses import replace
from pathlib import Path
from unittest.mock import Mock

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'backend'))
from app import create_app
from config import AppConfig
from services.ado_client import AdoClient
from services.ado_session import clear_ado_session
from services.test_case_browser import TestCaseBrowser as CaseBrowser, parse_steps, search_options, title_rank


@pytest.fixture
def browser():
    config = replace(AppConfig.from_env(), ado_organization='org', ado_project='QA Project', ado_pat='secret')
    return CaseBrowser(AdoClient(config))


def item(identifier, title='HYSYS MCP', kind='Test Case', project='QA Project'):
    return {'id': identifier, 'fields': {'System.Title': title, 'System.WorkItemType': kind, 'System.TeamProject': project}}


def response(data):
    return Mock(status_code=200, json=Mock(return_value=data))


@pytest.mark.parametrize('payload', [None, [], {}, {'query': ''}, {'query': 'x', 'field': 'bad'},
    {'query': '12x'}, {'query': '0'}, {'query': '-1'}, {'query': '2147483648'},
    {'query': True}, {'query': 'x' * 301, 'field': 'title'}, {'query': '1', 'field': []}, {'query': '1', 'mode': {}}])
def test_invalid_search_input(payload):
    with pytest.raises(ValueError):
        search_options(payload)


def test_id_spaces_and_numeric_prefix_ranges(browser):
    options = search_options({'field': 'id', 'mode': 'flexible', 'query': ' 12 34 '})
    assert options == ('id', 'flexible', '1234')
    browser._post = Mock(return_value={'workItems': []})
    browser.search(*options)
    query = browser._post.call_args.args[1]['query']
    assert "[System.WorkItemType] = 'Test Case'" in query
    assert '[System.TeamProject] = @project' in query
    assert '[System.Id] >= 1234 AND [System.Id] <= 1234' in query
    assert '[System.Id] >= 12340 AND [System.Id] <= 12349' in query
    assert '[System.Id] >= 1234000000 AND [System.Id] <= 1234999999' in query
    browser.search('id', 'flexible', '2147')
    assert '[System.Id] >= 2147000000 AND [System.Id] <= 2147483647' in browser._post.call_args.args[1]['query']
    browser.search('id', 'exact', '1234')
    assert '[System.Id] = 1234' in browser._post.call_args.args[1]['query']
    assert ' OR ' not in browser._post.call_args.args[1]['query']


@pytest.mark.parametrize('title, rank', [
    ('HYSYS MCP cooler', 1), ('XX HYSYS MCP YYYY', 2), ('XX HYSYS YY MCP ZZ', 3),
    ('HYSYS\t MCP title', 1), ('MCP HYSYS', None), ('HYSYS only', None),
])
def test_title_priority(title, rank):
    assert title_rank(title, 'hysys mcp') == rank


def test_search_filters_types_and_order_and_escapes_query(browser):
    browser._post = Mock(return_value={'workItems': [{'id': i} for i in range(1, 6)]})
    browser.client.read_work_items = Mock(return_value=[
        item(1, 'XX HYSYS YY MCP ZZ'), item(2, 'HYSYS MCP starts'), item(3, 'XX HYSYS MCP middle'),
        item(4, 'MCP before HYSYS'), item(5, 'HYSYS MCP', kind='Bug'),
    ])
    assert [i['id'] for i in browser.search('title', 'flexible', 'HYSYS MCP')] == [2, 3, 1]
    browser.search('title', 'exact', "HYSYS' OR [System.Id] > 0")
    assert "[System.Title] = 'HYSYS'' OR [System.Id] > 0'" in browser._post.call_args.args[1]['query']


def test_search_keyset_pages_and_200_item_batches(browser):
    browser._post = Mock(side_effect=[{'workItems': [{'id': i} for i in range(1, 1001)]}, {'workItems': [{'id': 1001}]}])
    browser.client.read_work_items = Mock(side_effect=lambda ids: [item(i) for i in ids])
    assert len(browser.search('title', 'flexible', 'HYSYS')) == 1001
    assert [len(call.args[0]) for call in browser.client.read_work_items.call_args_list] == [200] * 5 + [1]
    assert '[System.Id] > 1000' in browser._post.call_args_list[1].args[1]['query']


def test_detail_uses_ado_field_names_and_steps(browser, monkeypatch):
    raw = item(24143)
    raw['fields'].update({'Custom.PreReq': '<p>Open sample</p>', 'Custom.Tool': 'Silk4Net',
                          'Microsoft.VSTS.TCM.Steps': '<steps><step><parameterizedString>&lt;b&gt;Load&lt;/b&gt;</parameterizedString><parameterizedString>Loaded</parameterizedString></step><compref ref="123" /></steps>'})
    browser.client.read_work_items = Mock(return_value=[raw])
    monkeypatch.setattr('services.test_case_browser.requests.get', Mock(return_value=response({'value': [
        {'referenceName': 'Custom.PreReq', 'name': 'Pre Conditions'}, {'referenceName': 'Custom.Tool', 'name': 'Automation Test Tool'}]})))
    detail = browser.detail(24143)
    assert detail['steps'] == [{'action': '<b>Load</b>', 'expected': 'Loaded'}, {'action': 'Shared steps: #123 (open in ADO to view)', 'expected': ''}]
    assert next(f for f in detail['fields'] if f['referenceName'] == 'Custom.Tool')['name'] == 'Automation Test Tool'
    assert detail['url'] == 'https://dev.azure.com/org/QA%20Project/_workitems/edit/24143'
    assert not detail['warning']


@pytest.mark.parametrize('raw', [item(1, kind='Bug'), item(1, project='Other Project')])
def test_detail_rejects_other_type_or_project(browser, raw):
    browser.client.read_work_items = Mock(return_value=[raw])
    with pytest.raises(LookupError):
        browser.detail(1)


def test_metadata_unavailable_does_not_hide_case(browser, monkeypatch):
    browser.client.read_work_items = Mock(return_value=[item(1)])
    monkeypatch.setattr('services.test_case_browser.requests.get', Mock(side_effect=requests.Timeout))
    assert browser.detail(1)['warning']
    assert parse_steps('<invalid>')[0]['action'].startswith('Steps could not be parsed')


def test_history_paging_uses_actual_executor_and_does_not_invent_memberships(browser, monkeypatch):
    result = {'id': 10, 'testCase': {'id': '24143'}, 'testRun': {'id': '99'}, 'outcome': 'Passed',
              'testSuite': {'id': '7', 'name': 'Suite'}, 'testPlan': {'id': '8', 'name': 'Plan'},
              'completedDate': '2026-01-01T12:00:00Z', 'lastUpdatedDate': '2026-01-02T12:00:00Z',
              'runBy': {'displayName': 'Actual tester'}, 'owner': {'displayName': 'Assigned owner'}}
    missing = {'id': 11, 'testCase': {'id': '24143'}, 'testRun': {'id': '99'}, 'outcome': 'Failed', 'lastUpdatedDate': '2025-01-01T12:00:00Z'}
    post = Mock(side_effect=[response({'value': [result, missing, result]}), response([missing])])
    monkeypatch.setattr('services.test_case_browser.requests.post', post)
    first = browser.history(24143, page_size=2)
    assert first['nextSkip'] == 2
    assert first['history'][0] == {'resultId': 10, 'runId': '99', 'testSuite': 'Suite (7)', 'testPlan': 'Plan (8)',
        'result': 'Passed', 'loggedDate': '2026-01-01T12:00:00Z', 'tester': 'Actual tester'}
    assert first['history'][1]['testSuite'] == 'Not recorded'
    assert first['history'][1]['tester'] == ''
    assert first['history'][1]['loggedDate'] == '2025-01-01T12:00:00Z'
    last = browser.history(24143, skip=2, page_size=2)
    assert last['nextSkip'] is None
    call = post.call_args_list[0]
    assert call.args[0] == 'https://vstmr.dev.azure.com/org/QA%20Project/_apis/testresults/results/query'
    assert call.kwargs['params']['api-version'] == '7.1-preview.2'
    assert call.kwargs['params']['$top'] == 3
    assert 'WHERE TestCaseId = 24143' in call.kwargs['json']['query']
    assert 'trendDays' not in call.kwargs['json']
    assert post.call_args.kwargs['params']['$skip'] == 2


def test_history_wrong_case_is_rejected(browser):
    browser._post = Mock(return_value={'value': [{'testCase': {'id': '2'}}]})
    with pytest.raises(ValueError, match='Unexpected test case'):
        browser.history(1)


def test_routes_validation_disconnect_and_upstream_errors(monkeypatch, browser):
    client = create_app().test_client()
    clear_ado_session()
    assert client.post('/api/work-items/test-cases/search', json={'query': '1234'}).status_code == 400
    assert 'not connected' in client.get('/api/work-items/test-cases/1').json['error']
    assert client.get('/api/work-items/test-cases/1/history?skip=-1').status_code == 400
    monkeypatch.setattr('routes.work_item_routes.get_ado_client', lambda: browser.client)
    monkeypatch.setattr(CaseBrowser, 'search', Mock(return_value=[{'id': 1234}]))
    assert client.post('/api/work-items/test-cases/search', json={'query': '1234'}).json['testCases'] == [{'id': 1234}]
    for status in [401, 403, 404, 500]:
        error = requests.HTTPError('DO NOT EXPOSE secret upstream URL', response=Mock(status_code=status))
        monkeypatch.setattr(CaseBrowser, 'history', Mock(side_effect=error))
        result = client.get('/api/work-items/test-cases/1234/history')
        assert result.status_code == (status if status != 500 else 502)
        assert 'secret' not in result.text
    monkeypatch.setattr(CaseBrowser, 'history', Mock(side_effect=requests.Timeout('secret')))
    assert client.get('/api/work-items/test-cases/1234/history').status_code == 504


def test_history_resolves_plan_and_suite_names_from_exact_execution_point(browser, monkeypatch):
    raw = {'id': 1, 'testCase': {'id': '24092'}, 'testRun': {'id': '9'},
           'testPlan': {'id': '83602'}, 'testPoint': {'id': '77'}, 'outcome': 'Failed'}
    browser._post = Mock(side_effect=[{'value': [raw, {**raw, 'id': 2}]}, {'points': [
        {'id': 77, 'testCase': {'id': '24092'}, 'testPlan': {'id': '83602'}, 'suite': {'id': '125583'}},
        {'id': 78, 'testCase': {'id': '24092'}, 'testPlan': {'id': '83602'}, 'suite': {'id': '999'}}]}])
    get = Mock(side_effect=[response({'id': 83602, 'name': 'V15.2_HYSYS'}),
                            response({'id': 125583, 'name': 'V15.2_PI3_UFT'})])
    monkeypatch.setattr('services.test_case_browser.requests.get', get)
    data = browser.history(24092)
    assert all(row['testPlan'] == 'V15.2_HYSYS (83602)' for row in data['history'])
    assert all(row['testSuite'] == 'V15.2_PI3_UFT (125583)' for row in data['history'])
    assert get.call_count == 2  # Repeated names are looked up only once per page.
    assert not data['warnings']
    assert get.call_args_list[0].args[0] == f'{browser.client.base_url}/_apis/testplan/plans/83602'
    assert get.call_args_list[1].args[0] == f'{browser.client.base_url}/_apis/testplan/Plans/83602/suites/125583'
    assert browser._post.call_args.args[1] == {'pointsFilter': {'testcaseIds': [24092]}}


def test_point_url_only_extracts_ids_and_never_receives_credentials(browser, monkeypatch):
    browser._post = Mock(side_effect=[{'value': [{'id': 1, 'testCase': {'id': '1'}, 'testPlan': {'id': '8'}, 'testPoint': {'id': '77'}}]},
        {'points': [{'id': 77, 'testCase': {'id': '1'}, 'url': 'https://untrusted.example/_apis/test/Plans/8/Suites/7/Points/77'}]}])
    get = Mock(side_effect=[response({'name': 'Plan'}), response({'name': 'Suite'})])
    monkeypatch.setattr('services.test_case_browser.requests.get', get)
    row = browser.history(1)['history'][0]
    assert row['testSuite'] == 'Suite (7)'
    assert all(call.args[0].startswith(browser.client.base_url) for call in get.call_args_list)


def test_history_retains_rows_when_name_access_fails(browser, monkeypatch):
    browser._post = Mock(return_value={'value': [{'id': 1, 'testCase': {'id': '1'}, 'testPlan': {'id': '8'}, 'testSuite': {'id': '7'}, 'outcome': 'Failed'}]})
    get = Mock(side_effect=requests.Timeout('must not leak upstream URL/token'))
    monkeypatch.setattr('services.test_case_browser.requests.get', get)
    data = browser.history(1)
    assert data['history'][0]['result'] == 'Failed'
    assert data['history'][0]['testPlan'] == 'Name unavailable (8)'
    assert data['history'][0]['testSuite'] == 'Name unavailable (7)'
    assert data['warnings']
    assert 'token' not in str(data['warnings'])


def test_deleted_or_conflicting_points_do_not_guess_a_suite(browser):
    browser._post = Mock(side_effect=[{'value': [{'id': 1, 'testCase': {'id': '1'}, 'testPlan': {'id': '8', 'name': 'Plan'}, 'testPoint': {'id': '77'}}]},
        {'points': [{'id': 77, 'testCase': {'id': '1'}, 'testPlan': {'id': '9'}, 'suite': {'id': '7', 'name': 'Wrong Plan Suite'}},
                    {'id': 78, 'testCase': {'id': '1'}, 'testPlan': {'id': '8'}, 'suite': {'id': '7', 'name': 'Other Membership'}}]}])
    assert browser.history(1)['history'][0]['testSuite'] == 'Not recorded'


def test_missing_point_can_be_recovered_from_full_result(browser):
    browser._post = Mock(side_effect=[{'value': [{'id': 10, 'testRun': {'id': '9'}, 'testCase': {'id': '1'}, 'testPlan': {'id': '8', 'name': 'Plan'}}]},
        {'points': [{'id': 77, 'testCase': {'id': '1'}, 'testPlan': {'id': '8'}, 'suite': {'id': '7', 'name': 'Recovered Suite'}}]}])
    browser._get = Mock(return_value={'testCase': {'id': '1'}, 'testPoint': {'id': '77'}})
    assert browser.history(1)['history'][0]['testSuite'] == 'Recovered Suite (7)'
    browser._get.assert_called_once_with('test/Runs/9/results/10')


def test_recorded_suite_name_is_preserved(browser):
    browser._post = Mock(return_value={'value': [{'id': 10, 'testCase': {'id': '1'}, 'testPlan': {'id': '8', 'name': 'Plan'}, 'testSuite': {'name': 'Original name'}, 'testPoint': {'id': '77'}}]})
    assert browser.history(1)['history'][0]['testSuite'] == 'Original name'
    browser._post.assert_called_once()


def test_exact_point_supplies_missing_plan_with_recorded_suite_id(browser):
    browser._post = Mock(side_effect=[{'value': [{'id': 10, 'testCase': {'id': '1'}, 'testSuite': {'id': '7'}, 'testPoint': {'id': '77'}}]},
        {'points': [{'id': 77, 'testCase': {'id': '1'}, 'testPlan': {'id': '8', 'name': 'Recovered Plan'}, 'suite': {'id': '7', 'name': 'Recorded Suite'}}]}])
    browser._get = Mock()
    row = browser.history(1)['history'][0]
    assert row['testPlan'] == 'Recovered Plan (8)'
    assert row['testSuite'] == 'Recorded Suite (7)'
    browser._get.assert_not_called()
