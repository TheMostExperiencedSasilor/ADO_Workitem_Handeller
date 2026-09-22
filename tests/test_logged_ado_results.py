from unittest.mock import Mock

import pytest

from app import create_app
from services.ado_client import AdoClient
from services.ado_session import clear_ado_session, set_ado_session


URL = "https://dev.azure.com/aspentechnology/AspenTech%20SAFe/_testPlans/execute?planId=83602&suiteId=141923"


@pytest.fixture(autouse=True)
def configured_env(monkeypatch):
    monkeypatch.setenv("ADO_ORGANIZATION", "configured-org")
    monkeypatch.setenv("ADO_PROJECT", "configured project")
    monkeypatch.setenv("ADO_PAT", "unit-test-secret")
    set_ado_session("configured-org", "configured project", "unit-test-secret", "7.1")
    yield
    clear_ado_session()


def point(point_id, case_id, tester, outcome):
    return {
        "id": point_id,
        "testCaseReference": {"id": case_id},
        "tester": {"displayName": tester, "uniqueName": f"{tester.lower().replace(' ', '.')}@example.test"},
        "results": {"outcome": outcome},
    }


def test_logged_results_returns_completed_outcomes_and_skips_active(monkeypatch):
    read = Mock(return_value=[
        point(1, 1001, "Jane QA", "passed"),
        point(2, 1002, "Jane QA", "failed"),
        point(3, 1003, "Jane QA", "notExecuted"),
        point(4, 1004, "Jane QA", "blocked"),
        point(5, 1005, "Jane QA", "notApplicable"),
    ])
    monkeypatch.setattr(AdoClient, "_read_test_plan_pages", read)

    response = create_app().test_client().post("/api/test-plans/logged-results", json={
        "url": URL,
        "tester": "Jane",
        "testCaseIds": [1001, 1002, 1003, 1004, 1005],
    })

    assert response.status_code == 200
    by_id = {row["testCaseId"]: row for row in response.json["results"]}
    assert by_id[1001]["result"] == "Passed"
    assert by_id[1002]["result"] == "Failed"
    assert by_id[1003]["result"] == ""
    assert by_id[1004]["result"] == "Blocked"
    assert by_id[1005]["result"] == "N/A"
    read.assert_called_once_with("Plans/83602/Suites/141923/TestPoint")


def test_logged_results_marks_conflicting_test_points_ambiguous(monkeypatch):
    monkeypatch.setattr(AdoClient, "_read_test_plan_pages", Mock(return_value=[
        point(1, 2001, "Jane QA", "passed"),
        point(2, 2001, "Jane QA", "failed"),
    ]))

    response = create_app().test_client().post("/api/test-plans/logged-results", json={
        "url": URL,
        "tester": "Jane QA",
        "testCaseIds": [2001],
    })

    assert response.status_code == 200
    item = response.json["results"][0]
    assert item["result"] == ""
    assert item["ambiguous"] is True
    assert item["loggedResults"] == ["Passed", "Failed"]


def test_logged_results_rejects_ambiguous_partial_tester(monkeypatch):
    monkeypatch.setattr(AdoClient, "_read_test_plan_pages", Mock(return_value=[
        point(1, 3001, "Jane One", "passed"),
        point(2, 3001, "Jane Two", "passed"),
    ]))

    response = create_app().test_client().post("/api/test-plans/logged-results", json={
        "url": URL,
        "tester": "Jane",
        "testCaseIds": [3001],
    })

    assert response.status_code == 400
    assert "multiple people" in response.json["error"]
