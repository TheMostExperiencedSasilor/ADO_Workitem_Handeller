import sys
from io import BytesIO
from pathlib import Path
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from config import AppConfig
from services.ado_client import AdoClient
from services.test_assignment_workbook import (
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
        {"id": 30, "fields": {"System.Title": "Case Thirty"}},
    ])

    result = service.build_assignment_rows(83602, 141923, "jane@example.test")

    assert result["defineCount"] == 3
    assert result["assignedCount"] == 1
    assert result["matchedTester"] == "Jane QA"
    row = result["rows"][0]
    assert row["testCaseId"] == 10
    assert row["title"] == "Case Ten"
    assert row["productArea"] == "Sample Files_HYSYS"
    assert row["automationScriptName"] == "VSTS10.cs"
    for key in (
        "round1Results", "round2Results", "singleRunResults", "manualRun",
        "comment", "solution", "defects",
    ):
        assert row[key] == ""


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


def test_excel_exports_current_tracking_values():
    rows = [{
        "testCaseId": 10,
        "title": "Case Ten",
        "productArea": "Area",
        "automationScriptName": "VSTS10.cs",
        "round1Results": "Passed",
        "round2Results": "Failed",
        "singleRunResults": "",
        "manualRun": "N/A",
        "comment": "note",
        "solution": "fix",
        "defects": "12345",
    }]

    stream = TestAssignmentWorkbookService.make_workbook(rows)

    from openpyxl import load_workbook
    workbook = load_workbook(stream)
    assert workbook.sheetnames == ["Main"]
    sheet = workbook["Main"]
    assert [cell.value for cell in sheet[1]] == WORKBOOK_HEADERS
    assert [sheet[f"{column}2"].value for column in "ABCDEFGHIJK"] == [
        10, "Case Ten", "Area", "VSTS10.cs", "Passed", "Failed", None,
        "N/A", "note", "fix", "12345",
    ]
    assert sheet.freeze_panes == "A2"


def test_transfer_to_ote_fills_entire_matching_case_block():
    from openpyxl import Workbook, load_workbook

    source = Workbook()
    sheet = source.active
    sheet.title = "83602;V15.2_HYSYS"
    sheet.append(["TestCaseId", "Title", "TestStep", "StepAction", "StepExpected", "TestPointId", "Configuration", "Tester", "Outcome", "Comment"])
    sheet.append([24153, "Case A", "11", "11", "11", "200291:0", "Windows 10", "Tester", "11", "11"])
    sheet.append(["11", "11", "1", "Do A", "Expected A", "11", "11", "11", "11", "11"])
    sheet.append(["11", "11", "2", "Do B", "Expected B", "11", "11", "11", "11", "11"])
    sheet.append([24157, "Case B", "11", "11", "11", "200293:0", "Windows 10", "Tester", "11", "11"])
    sheet.append(["11", "11", "1", "Do C", "Expected C", "11", "11", "11", "11", "11"])
    raw = BytesIO()
    source.save(raw)

    rows = [
        {"testCaseId": 24153, "round1Results": "Passed"},
        {"testCaseId": 24157, "round1Results": "Failed"},
    ]
    output, updated = TestAssignmentWorkbookService.transfer_to_ote(raw.getvalue(), rows, "round1Results")
    result = load_workbook(output)["83602;V15.2_HYSYS"]

    assert updated == 2
    assert [result[f"I{row}"].value for row in range(2, 7)] == [
        "Passed", "Passed", "Passed", "Failed", "Failed"
    ]
