import sys
from pathlib import Path
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from config import AppConfig
from services.ado_client import AdoClient
from services.test_assignment_workbook import (
    RESULT_COLUMN_KEYS,
    WORKBOOK_HEADERS,
    TestAssignmentWorkbookService,
)


def config(monkeypatch):
    monkeypatch.setenv("ADO_ORGANIZATION", "configured-org")
    monkeypatch.setenv("ADO_PROJECT", "configured project")
    monkeypatch.setenv("ADO_PAT", "unit-test-secret")
    return AppConfig.from_env()


def test_define_metadata_and_assigned_tester_join(monkeypatch):
    client = AdoClient(config(monkeypatch))
    service = TestAssignmentWorkbookService(client)

    client._read_test_plan_pages = Mock(side_effect=[
        [
            {"workItem": {"id": 10}, "order": 2},
            {"workItem": {"id": 20}, "order": 1},
            {"workItem": {"id": 30}, "order": 3},
        ],
        [
            {
                "testCaseReference": {"id": 10},
                "tester": {"displayName": "Jane QA", "uniqueName": "jane@example.test"},
                "results": {"outcome": "passed"},
            },
            {
                "testCaseReference": {"id": 10},
                "tester": {"displayName": "Jane QA", "uniqueName": "jane@example.test"},
                "results": {"outcome": "failed"},
            },
            {
                "testCaseReference": {"id": 20},
                "tester": {"displayName": "Someone Else", "uniqueName": "other@example.test"},
                "results": {"outcome": "passed"},
            },
        ],
    ])
    client.read_work_items = Mock(return_value=[
        {
            "id": 10,
            "fields": {
                "System.Title": "Case Ten",
                "Custom.ProductArea": "Sample Files_HYSYS",
                "Custom.AutomationScriptName": "VSTS10.cs",
            },
        },
        {
            "id": 20,
            "fields": {
                "System.Title": "Case Twenty",
                "Custom.ProductArea": "Dynamics",
                "Custom.AutomationScriptName": "VSTS20.cs",
            },
        },
        {
            "id": 30,
            "fields": {"System.Title": "Case Thirty"},
        },
    ])

    result = service.build_assignment_rows(83602, 141923, "jane@example.test")

    assert result["defineCount"] == 3
    assert result["assignedCount"] == 1
    assert result["matchedTester"] == "Jane QA"
    assert result["rows"] == [{
        "testCaseId": 10,
        "title": "Case Ten",
        "productArea": "Sample Files_HYSYS",
        "automationScriptName": "VSTS10.cs",
        "order": 2,
        "tester": "Jane QA",
        "outcome": "Passed / Failed",
    }]


def test_ambiguous_partial_tester_is_rejected(monkeypatch):
    client = AdoClient(config(monkeypatch))
    service = TestAssignmentWorkbookService(client)
    client._read_test_plan_pages = Mock(side_effect=[
        [{"workItem": {"id": 1}, "order": 1}],
        [
            {"testCaseReference": {"id": 1}, "tester": {"displayName": "Jane One"}, "results": {"outcome": "passed"}},
            {"testCaseReference": {"id": 1}, "tester": {"displayName": "Jane Two"}, "results": {"outcome": "passed"}},
        ],
    ])
    client.read_work_items = Mock(return_value=[{"id": 1, "fields": {"System.Title": "Case"}}])

    try:
        service.build_assignment_rows(1, 2, "Jane")
        assert False, "Expected ambiguous tester search to fail"
    except ValueError as error:
        assert "multiple people" in str(error)


def test_excel_has_one_main_sheet_and_exact_columns(monkeypatch):
    rows = [{
        "testCaseId": 10,
        "title": "Case Ten",
        "productArea": "Area",
        "automationScriptName": "VSTS10.cs",
        "outcome": "Passed",
    }]

    stream = TestAssignmentWorkbookService.make_workbook(rows, "round2")

    from openpyxl import load_workbook
    workbook = load_workbook(stream)
    assert workbook.sheetnames == ["Main"]
    sheet = workbook["Main"]
    assert [cell.value for cell in sheet[1]] == WORKBOOK_HEADERS
    assert sheet["A2"].value == 10
    assert sheet["B2"].value == "Case Ten"
    assert sheet["F2"].value == "Passed"
    assert sheet["E2"].value is None
    assert sheet.freeze_panes == "A2"
    assert set(RESULT_COLUMN_KEYS) == {"round1", "round2", "single", "manual"}
