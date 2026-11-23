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
from services.test_case_browser import TestCaseBrowser as CaseBrowser, compare_steps, describe_update, parse_steps, search_options, title_rank


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
    assert detail['steps'] == [
        {'number': '1', 'action': '<b>Load</b>', 'expected': 'Loaded'},
        {'number': '2', 'action': 'Shared steps: #123 (open in ADO to view)', 'expected': ''},
    ]
    assert 'Some steps could not be loaded' in detail['stepsWarning']
    assert next(f for f in detail['fields'] if f['referenceName'] == 'Custom.Tool')['name'] == 'Automation Test Tool'
    assert detail['url'] == 'https://dev.azure.com/org/QA%20Project/_workitems/edit/24143'
    assert not detail['warning']


def test_shared_steps_expand_in_order_and_reuse_the_read(browser):
    case = item(12)
    shared = item(123, kind='Shared Steps')
    case['fields']['Microsoft.VSTS.TCM.Steps'] = '''
      <steps><step><parameterizedString>First</parameterizedString></step>
        <compref ref="123"/><step><parameterizedString>Third</parameterizedString></step>
        <compref ref="123"/></steps>
    '''
    shared['fields']['Microsoft.VSTS.TCM.Steps'] = '''
      <steps><step><parameterizedString>Shared action</parameterizedString>
        <parameterizedString>Shared result</parameterizedString></step>
        <step><parameterizedString>Second shared action</parameterizedString></step></steps>
    '''
    browser.client.read_work_items = Mock(return_value=[shared])
    steps, warning = browser._detail_steps(case['fields']['Microsoft.VSTS.TCM.Steps'])
    assert [(row['number'], row['action'], row['expected']) for row in steps] == [
        ('1', 'First', ''), ('2.1', 'Shared action', 'Shared result'), ('2.2', 'Second shared action', ''),
        ('3', 'Third', ''), ('4.1', 'Shared action', 'Shared result'), ('4.2', 'Second shared action', ''),
    ]
    assert not warning
    browser.client.read_work_items.assert_called_once_with([123])


def test_unavailable_and_cyclic_shared_steps_are_reported(browser):
    shared = item(123, kind='Shared Steps')
    shared['fields']['Microsoft.VSTS.TCM.Steps'] = '<steps><compref ref="123"/></steps>'
    other = item(234, kind='Shared Steps', project='Other Project')
    browser.client.read_work_items = Mock(side_effect=[[shared], [other], requests.Timeout()])
    steps, warning = browser._detail_steps('<steps><compref ref="123"/><compref ref="234"/><compref ref="456"/></steps>')
    assert [row['number'] for row in steps] == ['1.1', '2', '3']
    assert all('open in ADO to view' in row['action'] for row in steps)
    assert warning


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


def test_inline_xml_and_shared_step_ids_preserve_action_text_and_numbering():
    read_shared = Mock(return_value='<steps><step><parameterizedString>Linked</parameterizedString></step></steps>')
    incomplete = Mock()
    result = parse_steps("""
      <steps>
        <step><parameterizedString>Open <B>HYSYS</B> now</parameterizedString></step>
        <compref ref="2"><step><parameterizedString isformatted="false">&lt;b&gt; &amp;amp;</parameterizedString></step></compref>
        <compref ref="3"><step id="8" /></compref>
        <step><parameterizedString>Save</parameterizedString></step>
      </steps>
    """, read_shared, incomplete)
    assert [(row['number'], row['action']) for row in result] == [
        ('1', 'Open <B>HYSYS</B> now'), ('2.1', '&lt;b&gt; &amp;amp;'),
        ('3.1', 'Linked'), ('4', 'Save'),
    ]
    read_shared.assert_called_once_with(3)
    incomplete.assert_not_called()
    assert parse_steps('<unrecognized/>', mark_incomplete=incomplete)[0]['action'].startswith('Steps could not be parsed')
    incomplete.assert_called_once()


def test_modification_history_pages_updates_and_preserves_shared_revision_ids(browser, monkeypatch):
    browser.client.read_work_items = Mock(return_value=[item(24143)])
    # A relation-only update can share a work item revision with a field update.
    create = {'id': 1, 'workItemId': 24143, 'rev': 1, 'revisedDate': '2026-03-24T00:00:00Z',
              'revisedBy': {'id': 'creator', 'displayName': 'Creator'}, 'fields': {
                  'System.CreatedDate': {'newValue': '2026-03-23T10:00:00Z'},
                  'System.ChangedDate': {'newValue': '2026-03-23T10:00:00Z'},
                  'System.State': {'newValue': 'Design'},
              }}
    more = [{'id': i, 'workItemId': 24143, 'rev': i, 'revisedDate': '2026-03-24T00:00:00Z'} for i in range(2, 100)]
    field_update = {'id': 100, 'workItemId': 24143, 'rev': 100, 'revisedDate': '9999-01-01T00:00:00Z',
                    'revisedBy': {'displayName': 'Service Account'}, 'fields': {
                        'System.ChangedBy': {'newValue': {'id': 'joy', 'displayName': 'Joy Cheng'}},
                        'System.ChangedDate': {'newValue': '2026-03-23T22:59:39.49Z'},
                        'System.AreaPath': {'oldValue': 'QA Project\\Legacy', 'newValue': 'QA Project\\HYSYS'},
                        'System.IterationPath': {'newValue': 'QA Project\\Sprint 1'},
                        'System.AssignedTo': {'oldValue': {'displayName': 'Previous tester'}},
                    }}
    relation_update = {'id': 101, 'workItemId': 24143, 'rev': 100, 'revisedDate': '2026-03-25T08:00:00Z',
                       'revisedBy': {'id': 'joy', 'displayName': 'Joy Cheng'}, 'relations': {
                           'added': [{'rel': 'AttachedFile', 'url': 'https://ado.test/attachment', 'attributes': {'name': 'Plot.png'}}],
                           'removed': [{'rel': 'System.LinkTypes.Related', 'url': 'https://ado.test/workitems/27'}],
                           'updated': [{'rel': 'Hyperlink', 'url': 'https://example.test/', 'attributes': {'comment': 'Updated'}}],
                       }}
    get = Mock(side_effect=[response({'value': [create, *more, field_update]}), response({'value': [relation_update]})])
    monkeypatch.setattr('services.test_case_browser.requests.get', get)
    updates = browser.modification_history(24143)['updates']
    assert len(updates) == 101
    assert updates[0]['created'] and updates[0]['changedAt'] == '2026-03-23T10:00:00Z'
    assert updates[0]['author'] == 'Creator'
    field, relation = updates[-2:]
    assert (field['id'], relation['id'], field['revision'], relation['revision']) == (100, 101, 100, 100)
    assert field['changedAt'] == '2026-03-23T22:59:39.49Z'
    assert field['author'] == 'Joy Cheng' and field['authorId'] == 'joy'
    assert [(f['label'], f['before'], f['after']) for f in field['fields']] == [
        ('Area Path', 'QA Project\\Legacy', 'QA Project\\HYSYS'),
        ('Iteration Path', None, 'QA Project\\Sprint 1'),
        ('Assigned To', {'displayName': 'Previous tester'}, None),
    ]
    assert relation['changedAt'] == '2026-03-25T08:00:00Z'
    assert [(r['operation'], r['type'], r['name']) for r in relation['relations']] == [
        ('added', 'AttachedFile', 'Plot.png'), ('removed', 'System.LinkTypes.Related', None),
        ('updated', 'Hyperlink', None),
    ]
    browser.client.read_work_items.assert_called_once_with([24143])
    assert [call.kwargs['params']['$skip'] for call in get.call_args_list] == [0, 100]
    assert all(call.args[0].endswith('/_apis/wit/workItems/24143/updates') for call in get.call_args_list)
    assert all(call.kwargs['allow_redirects'] is False and call.kwargs['headers'] == browser.client.headers
               for call in get.call_args_list)


def test_modification_history_route_and_bad_pages(browser, monkeypatch):
    app = create_app()
    api = app.test_client()
    browser.client.read_work_items = Mock(return_value=[item(24143, project='Different project')])
    browser._get = Mock()
    monkeypatch.setattr('routes.work_item_routes.get_ado_client', lambda: browser.client)
    monkeypatch.setattr(CaseBrowser, '_get', browser._get)
    path = '/api/work-items/test-cases/24143/modification-history'
    assert api.get(path).status_code == 404
    browser._get.assert_not_called()
    browser.client.read_work_items.return_value = [item(24143)]
    browser._get.return_value = {'value': [{'id': 1, 'workItemId': 100}]}
    assert api.get(path).status_code == 400
    browser._get.return_value = {'value': [{'id': 11, 'workItemId': 24143}] * 100}
    assert api.get(path).get_json()['error'] == 'Azure DevOps work item updates did not advance.'
    browser._get.return_value = {'value': [{'id': 1, 'workItemId': 24143, 'rev': 1, 'revisedDate': '9999-01-01T00:00:00Z'}]}
    response = api.get(path)
    assert response.status_code == 200
    assert response.get_json()['updates'][0]['created']
    assert response.get_json()['updates'][0]['changedAt'] is None
    assert describe_update({'id': 10, 'revisedDate': '9999-01-01T00:00:00Z', 'fields': {
        'System.AuthorizedDate': {'newValue': '2026-03-23T09:00:00Z'},
    }})['changedAt'] == '2026-03-23T09:00:00Z'


def test_step_comparison_distinguishes_edits_insertions_removals_and_reordering():
    before = '''<steps>
      <step id="2"><parameterizedString isformatted="false">Load &lt;Old Plant.hsc&gt; &amp; inspect "Flow"</parameterizedString><parameterizedString>Ready</parameterizedString></step>
      <step id="3"><parameterizedString>Open plot</parameterizedString><parameterizedString>Originally visible</parameterizedString></step>
      <step id="4"><parameterizedString>Close window</parameterizedString></step>
      <step id="5"><parameterizedString>Last</parameterizedString></step></steps>'''
    after = '''<steps>
      <step id="3"><parameterizedString>Open plot</parameterizedString><parameterizedString>Visible</parameterizedString></step>
      <step id="2"><parameterizedString>&lt;div&gt;Load &amp;lt;LNG Plant Simulation.hsc&amp;gt; &amp;amp; inspect "Flow"&lt;/div&gt;</parameterizedString><parameterizedString>Ready</parameterizedString></step>
      <step id="6"><parameterizedString>Save window</parameterizedString></step>
      <step id="5"><parameterizedString>Last</parameterizedString></step></steps>'''
    cases = compare_steps(before, after)['changes']
    assert len(cases) == 4
    expected_change, action_change, added, removed = cases
    assert expected_change['moved'] and expected_change['before']['number'] == '2' and expected_change['after']['number'] == '1'
    assert expected_change['before']['expected'] == 'Originally visible'
    assert expected_change['after']['expected'] == 'Visible'
    assert action_change['moved'] and action_change['before']['number'] == '1' and action_change['after']['number'] == '2'
    assert action_change['before']['action'] == 'Load &lt;Old Plant.hsc&gt; &amp; inspect "Flow"'
    assert action_change['after']['action'] == '<div>Load &lt;LNG Plant Simulation.hsc&gt; &amp; inspect "Flow"</div>'
    assert added['before'] is None and added['after']['action'] == 'Save window'
    assert removed['after'] is None and removed['before']['action'] == 'Close window'

    inserted = before.replace('<steps>', '<steps><step id="7"><parameterizedString>Prep</parameterizedString></step>')
    changes = compare_steps(before, inserted)['changes']
    assert len(changes) == 1 and changes[0]['before'] is None and changes[0]['after']['number'] == '1'


def test_step_comparison_handles_empty_unreadable_missing_identity_and_shared_steps():
    valid = '<steps><step id="2"><parameterizedString>Set variables</parameterizedString></step></steps>'
    assert compare_steps(None, '')['changes'] == []
    assert compare_steps(valid, None)['changes'][0]['after'] is None
    for malformed in ['<steps><step>', '<unrecognized />', 42, '<!DOCTYPE steps [<!ENTITY sample "x">]><steps/>']:
        comparison = compare_steps(malformed, valid)
        assert comparison['warning'] and comparison['before'] is None and comparison['after'][0]['action'] == 'Set variables'
    for unstable in [valid.replace(' id="2"', ''), valid.replace('</steps>', '<step id="2"/></steps>')]:
        comparison = compare_steps(unstable, valid)
        assert comparison['warning'] and comparison['before'][0]['action'] == 'Set variables'
    old_shared = '<steps><compref id="11" ref="100"/></steps>'
    new_shared = '<steps><compref id="11" ref="200"/></steps>'
    comparison = compare_steps(old_shared, new_shared)
    assert comparison['note']
    assert any(row['after'] and '#200' in row['after']['action'] for row in comparison['changes'])
    assert any(row['before'] and '#100' in row['before']['action'] for row in comparison['changes'])


def test_post_development_bug_routes_search_details_history_and_links(browser, monkeypatch):
    from services.post_development_bug_browser import PostDevelopmentBugBrowser

    app = create_app()
    api = app.test_client()
    bug = item(42, 'Flowsheet issue', kind='Post Development Bug')
    bug['relations'] = [
        {'rel': 'System.LinkTypes.Related', 'url': 'https://dev.azure.com/org/_apis/wit/workItems/43',
         'attributes': {'comment': 'Verified'}},
        {'rel': 'System.LinkTypes.Hierarchy-Reverse', 'url': 'https://org.visualstudio.com/QA/_apis/wit/workItems/44'},
        {'rel': 'Hyperlink', 'url': 'https://example.test/doc'},
        {'rel': 'Hyperlink', 'url': 'javascript:alert(1)'},
        {'rel': 'AttachedFile', 'url': 'https://dev.azure.com/org/_apis/wit/attachments/asset'},
    ]
    def work_items(ids):
        return [entry for entry in [bug, item(45, kind='Bug')] if entry['id'] in ids]
    browser.client.read_work_items = Mock(side_effect=work_items)
    monkeypatch.setattr('routes.work_item_routes.get_ado_client', lambda: browser.client)
    post = Mock(return_value={'workItems': [{'id': 42}, {'id': 45}]})
    monkeypatch.setattr(PostDevelopmentBugBrowser, '_post', post)
    get = Mock(side_effect=[
        {'value': [{'id': 1, 'workItemId': 42, 'rev': 1}]},
        {'value': [{'id': 43, 'fields': {'System.Title': 'Linked bug', 'System.State': 'Closed',
                    'System.TeamProject': 'Other Project', 'System.ChangedDate': '2026-03-23T22:59:39Z'}}]},
    ])
    monkeypatch.setattr(PostDevelopmentBugBrowser, '_get', get)
    monkeypatch.setattr('services.test_case_browser.requests.get', Mock(return_value=response({'value': []})))

    root = '/api/work-items/post-development-bugs'
    search = api.post(root + '/search', json={'field': 'title', 'mode': 'flexible', 'query': 'flowsheet'})
    assert [result['id'] for result in search.json['bugs']] == [42]
    assert "[System.WorkItemType] = 'Post Development Bug'" in post.call_args.args[1]['query']
    post.return_value = {'workItems': [{'id': 42}]}
    lookup = api.post(root + '/search', json={'query': '42'})
    assert [result['id'] for result in lookup.json['bugs']] == [42]
    assert '[System.Id] = 42' in post.call_args.args[1]['query']
    assert api.get(root + '/45').status_code == 404
    detail = api.get(root + '/42').json
    assert detail['title'] == 'Flowsheet issue' and detail['linkCount'] == 4
    history = api.get(root + '/42/modification-history')
    assert history.json['updates'][0]['created']
    links = api.get(root + '/42/links').json['links']
    assert links[0]['title'] == 'Linked bug'
    assert links[0]['state'] == 'Closed' and links[0]['comment'] == 'Verified'
    assert links[0]['url'] == 'https://dev.azure.com/org/Other%20Project/_workitems/edit/43'
    assert links[1]['id'] == 44 and links[1]['title'] is None
    assert links[1]['url'] == 'https://dev.azure.com/org/_workitems/edit/44'
    assert links[2]['url'] == 'https://example.test/doc' and links[3]['url'] is None
    assert get.call_args.args[0] == 'wit/workitems'
    assert get.call_args.args[1]['ids'] == '43,44'
    assert get.call_args.args[1]['errorPolicy'] == 'Omit'


def test_bug_links_only_resolve_connected_organization():
    from services.post_development_bug_browser import work_item_target

    assert work_item_target('https://dev.azure.com/ORG/QA%20Project/_workitems/edit/123', 'org') == 123
    assert work_item_target('https://org.visualstudio.com/_apis/wit/workItems/123', 'org') == 123
    for url in ['https://dev.azure.com/other/_apis/wit/workItems/123',
                'https://org.visualstudio.com.example.test/_apis/wit/workItems/123',
                'https://user@dev.azure.com/org/_apis/wit/workItems/123',
                'https://dev.azure.com/org/_apis/wit/workItems/0']:
        assert work_item_target(url, 'org') is None
