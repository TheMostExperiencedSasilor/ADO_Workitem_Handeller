import sys
from pathlib import Path
from unittest.mock import Mock

import pytest
import requests

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from app import create_app
from config import AppConfig
from routes.test_plan_routes import parse_test_plan_url
from services.ado_client import AdoClient

URL = "https://dev.azure.com/aspentechnology/AspenTech%20SAFe/_testPlans/execute?planId=83602&suiteId=106867"


@pytest.fixture
def config(monkeypatch):
    for name, value in {"ADO_ORGANIZATION": "configured-org", "ADO_PROJECT": "configured project", "ADO_PAT": "unit-test-secret"}.items():
        monkeypatch.setenv(name, value)
    return AppConfig.from_env()


@pytest.mark.parametrize('url', [URL, URL.replace('planId=83602&suiteId=106867', 'suiteId=106867&extra=x&planId=83602')])
def test_valid_url(url):
    assert parse_test_plan_url(url) == (83602, 106867)


@pytest.mark.parametrize('query, message', [
    ('suiteId=2', 'planId is missing'), ('planId=1', 'suiteId is missing'),
    ('planId=&suiteId=2', 'planId is missing'),
    ('planId=abc&suiteId=2', 'planId must'), ('planId=1&suiteId=2.5', 'suiteId must'),
    ('planId=-1&suiteId=2', 'planId must'), ('planId=0&suiteId=2', 'planId must'),
    ('planId=2147483648&suiteId=2', 'planId must'),
    ('planId=1&planId=2&suiteId=3', 'planId must'),
])
def test_invalid_ids(query, message):
    with pytest.raises(ValueError, match=message):
        parse_test_plan_url(URL.split('?')[0] + '?' + query)


@pytest.mark.parametrize('url', [None, '', 'not a URL', 'javascript:alert(1)', 'https://[invalid', 'https://host:bad/_testPlans/execute', 'https://host/other?planId=1&suiteId=2'])
def test_invalid_urls(url):
    with pytest.raises(ValueError, match='Invalid URL'):
        parse_test_plan_url(url)


def test_summary_and_empty_suite(config, monkeypatch):
    client = create_app().test_client()
    for points, summary in [
        ([{'outcome': outcome} for outcome in ['Passed', 'Failed', 'Blocked', 'Not Run', 'Unspecified']],
         {'total': 5, 'passed': 1, 'failed': 1, 'other': 3}),
        ([], {'total': 0, 'passed': 0, 'failed': 0, 'other': 0}),
    ]:
        read = Mock(return_value=points)
        monkeypatch.setattr(AdoClient, 'read_test_points', read)
        response = client.post('/api/test-plans/read-suite', json={'url': URL})
        assert response.status_code == 200
        assert response.json['summary'] == summary
        assert response.json['testPoints'] == points
        assert response.json['planId'] == 83602
        read.assert_called_once_with(83602, 106867)
        if not points:
            assert 'no test points' in response.json['message']


def test_missing_configuration(monkeypatch):
    monkeypatch.setenv('ADO_PAT', '')
    response = create_app().test_client().post('/api/test-plans/read-suite', json={'url': URL})
    assert response.status_code == 400
    assert 'configuration' in response.json['error']


@pytest.mark.parametrize('status, text', [(401, 'authentication'), (403, 'authentication'), (404, 'not found'), (500, 'REST API')])
def test_http_errors_are_redacted(config, monkeypatch, status, text):
    response = requests.Response()
    response.status_code = status
    error = requests.HTTPError('unit-test-secret upstream details', response=response)
    monkeypatch.setattr(AdoClient, 'read_test_points', Mock(side_effect=error))
    result = create_app().test_client().post('/api/test-plans/read-suite', json={'url': URL})
    assert result.status_code == (status if status != 500 else 502)
    assert text in result.json['error']
    assert 'unit-test-secret' not in result.text


@pytest.mark.parametrize('error, status', [(requests.Timeout('unit-test-secret'), 504), (requests.ConnectionError('unit-test-secret'), 502), (ValueError('unit-test-secret'), 502)])
def test_other_errors_are_redacted(config, monkeypatch, error, status):
    monkeypatch.setattr(AdoClient, 'read_test_points', Mock(side_effect=error))
    result = create_app().test_client().post('/api/test-plans/read-suite', json={'url': URL})
    assert result.status_code == status
    assert 'unit-test-secret' not in result.text


def page(items, token=None):
    return Mock(status_code=200, headers={'x-ms-continuationtoken': token} if token else {}, json=Mock(return_value={'value': items}))


def point(case_id, name='', outcome='passed'):
    return {'testCaseReference': {'id': case_id, 'name': name}, 'results': {'outcome': outcome}}


def test_pagination_order_titles_and_config(config, monkeypatch):
    get = Mock(side_effect=[
        page([point(1), point(2, 'Two', 'failed')], 'points-next'),
        page([point(1), point(3, 'Three', 'notExecuted')]),
        page([{'workItem': {'id': 1}, 'order': 23}], 'cases-next'),
        page([{'workItem': {'id': 2}, 'order': 21}, {'workItem': {'id': 3}}]),
    ])
    monkeypatch.setattr('services.ado_client.requests.get', get)
    client = AdoClient(config)
    client.read_work_items = Mock(return_value=[{'id': 1, 'fields': {'System.Title': 'One | Full title'}}])
    rows = client.read_test_points(83602, 106867)
    assert [row['testCaseId'] for row in rows] == [2, 1, 1, 3]
    assert [row['order'] for row in rows] == [21, 23, 23, None]
    assert rows[1]['title'] == 'One | Full title'
    assert rows[0]['outcome'] == 'Failed'
    assert rows[-1]['outcome'] == 'Not Run'
    client.read_work_items.assert_called_once_with([1])
    calls = get.call_args_list
    assert calls[1].kwargs['params']['continuationToken'] == 'points-next'
    assert calls[3].kwargs['params']['continuationToken'] == 'cases-next'
    assert 'continuationToken' not in calls[0].kwargs['params']
    assert 'configured-org/configured%20project/' in calls[0].args[0]
    assert all(call.kwargs['headers'] == client.headers for call in calls)
    assert set(rows[0]) == {'testCaseId', 'title', 'outcome', 'order'}


def test_missing_orders_preserve_api_order(config, monkeypatch):
    client = AdoClient(config)
    monkeypatch.setattr(client, '_read_test_plan_pages', Mock(side_effect=[
        [point(9, 'Nine'), point(2, 'Two')], []]))
    rows = client.read_test_points(1, 2)
    assert [row['testCaseId'] for row in rows] == [9, 2]
    assert all(row['order'] is None for row in rows)


def test_title_batches_and_empty_points(config, monkeypatch):
    client = AdoClient(config)
    monkeypatch.setattr(client, '_read_test_plan_pages', Mock(side_effect=[
        [point(i) for i in range(1, 202)], []]))
    client.read_work_items = Mock(return_value=[])
    assert len(client.read_test_points(1, 2)) == 201
    assert [len(call.args[0]) for call in client.read_work_items.call_args_list] == [200, 1]
    pages = Mock(return_value=[])
    monkeypatch.setattr(client, '_read_test_plan_pages', pages)
    assert client.read_test_points(1, 2) == []
    pages.assert_called_once()


def test_repeated_continuation_rejected(config, monkeypatch):
    monkeypatch.setattr('services.ado_client.requests.get', Mock(return_value=page([], 'same')))
    with pytest.raises(ValueError, match='Repeated'):
        AdoClient(config).read_test_points(1, 2)


def test_existing_work_item_reader(config, monkeypatch):
    get = Mock(return_value=page([{'id': 123, 'fields': {'System.Title': 'Existing work item'}}]))
    monkeypatch.setattr('services.ado_client.requests.get', get)
    response = create_app().test_client().post('/api/work-items/read', json={'ids': [123]})
    assert response.status_code == 200
    assert response.json['workItems'][0]['id'] == 123
    assert get.call_args.args[0].endswith('/_apis/wit/workitems')
    assert get.call_args.kwargs['params']['ids'] == '123'


def test_summary_section_is_served_and_endpoint_registered():
    app = create_app()
    client = app.test_client()
    response = client.get("/")
    assert response.status_code == 200
    html = response.get_data(as_text=True)
    assert '<h2 id="testPlanHeading">Test Result Summary</h2>' in html
    assert html.index('id="saveSetupButton"') < html.index('id="testPlanHeading"') < html.index('class="panel work-type-panel"')
    for element_id in ("testPlanUrl", "loadTestSuiteButton", "testSuiteSummary", "testSuiteRows",
                       "copyTestSuiteButton", "copyFailedTestsButton"):
        assert f'id="{element_id}"' in html
    assert any(rule.rule == "/api/test-plans/read-suite" and "POST" in rule.methods
               for rule in app.url_map.iter_rules())


@pytest.mark.parametrize('project, encoded', [
    ('AspenTech SAFe', 'AspenTech%20SAFe'),
    ('AspenTech%20SAFe', 'AspenTech%20SAFe'),
    ('Project + QA', 'Project%20%2B%20QA'),
    ('Project%20%2B%20QA', 'Project%20%2B%20QA'),
    ('Project  QA', 'Project%20%20QA'),
    ('测试 项目', '%E6%B5%8B%E8%AF%95%20%E9%A1%B9%E7%9B%AE'),
    ('100% Ready', '100%25%20Ready'),
])
def test_project_path_encoded_once_for_all_readers(config, monkeypatch, project, encoded):
    from dataclasses import replace
    client = AdoClient(replace(config, ado_project=project))
    get = Mock(return_value=page([]))
    monkeypatch.setattr('services.ado_client.requests.get', get)
    client.test_connection()
    client.read_work_items([123])
    client.read_test_points(83602, 106867)
    urls = [call.args[0] for call in get.call_args_list]
    assert urls == [
        f'https://dev.azure.com/configured-org/_apis/projects/{encoded}',
        f'https://dev.azure.com/configured-org/{encoded}/_apis/wit/workitems',
        f'https://dev.azure.com/configured-org/{encoded}/_apis/testplan/Plans/83602/Suites/106867/TestPoint',
    ]
