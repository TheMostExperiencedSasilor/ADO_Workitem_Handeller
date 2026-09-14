import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from services.result_logging_guard import ResultLoggingGuard


class FakeClient:
    def __init__(self, points):
        self.points = points

    def _read_test_plan_pages(self, path):
        assert path.endswith("/TestPoint")
        return self.points


def point(point_id, case_id, outcome):
    return {
        "id": point_id,
        "testCaseReference": {"id": case_id},
        "results": {"outcome": outcome},
    }


def test_ado_guard_keeps_only_active_points():
    guard = ResultLoggingGuard(FakeClient([
        point(101, 1001, "unspecified"),
        point(102, 1001, "passed"),
        point(103, 1002, "failed"),
    ]))
    rows = [
        {"testCaseId": 1001, "testPointIds": [101, 102], "round1Results": "Passed"},
        {"testCaseId": 1002, "testPointIds": [103], "round1Results": "Failed"},
    ]

    filtered, report = guard.filter_rows_for_ado(1, 2, rows, "round1Results")

    logged = [row for row in filtered if row.get("round1Results")]
    assert len(logged) == 1
    assert logged[0]["testCaseId"] == 1001
    assert logged[0]["testPointIds"] == [101]
    assert report["eligiblePointIds"] == [101]
    assert report["skippedPoints"] == 2
    assert report["skippedCases"] == 2


def test_ote_guard_skips_case_when_any_relevant_point_is_completed():
    guard = ResultLoggingGuard(FakeClient([
        point(201, 2001, "unspecified"),
        point(202, 2001, "passed"),
        point(203, 2002, "notExecuted"),
    ]))
    rows = [
        {"testCaseId": 2001, "round1Results": "Passed"},
        {"testCaseId": 2002, "round1Results": "Failed"},
    ]

    filtered, report = guard.filter_rows_for_ote(1, 2, rows, "round1Results")

    assert [row["testCaseId"] for row in filtered] == [2002]
    assert report["eligibleCaseIds"] == [2002]
    assert report["skippedCases"] == 1


def test_completed_non_pass_fail_outcome_is_not_treated_as_active():
    guard = ResultLoggingGuard(FakeClient([
        point(251, 2501, "blocked"),
        point(252, 2502, "notApplicable"),
    ]))
    rows = [
        {"testCaseId": 2501, "testPointIds": [251], "round1Results": "Passed"},
        {"testCaseId": 2502, "testPointIds": [252], "round1Results": "Passed"},
    ]

    filtered, report = guard.filter_rows_for_ado(1, 2, rows, "round1Results")

    assert not [row for row in filtered if row.get("round1Results")]
    assert report["eligiblePointIds"] == []
    assert report["skippedPoints"] == 2


def test_allow_duplicate_logging_bypasses_status_filter():
    guard = ResultLoggingGuard(FakeClient([point(301, 3001, "passed")]))
    rows = [{"testCaseId": 3001, "testPointIds": [301], "round1Results": "Passed"}]

    filtered, report = guard.filter_rows_for_ado(
        1, 2, rows, "round1Results", allow_duplicate_logging=True
    )

    assert filtered == rows
    assert report["eligibleCaseIds"] == [3001]
    assert report["eligiblePointIds"] == [301]
    assert report["skippedCases"] == 0
