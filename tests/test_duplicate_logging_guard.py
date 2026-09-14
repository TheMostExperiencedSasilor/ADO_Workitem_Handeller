import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from services.protected_test_run_publisher import ProtectedTestRunPublisher
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


class PublishingClient(FakeClient):
    def __init__(self, points):
        super().__init__(points)
        self.created_point_ids = None
        self.updated_results = None

    def read_test_point_mappings(self, plan_id, suite_id):
        return [
            {"testPointId": int(raw["id"]), "testCaseId": int(raw["testCaseReference"]["id"])}
            for raw in self.points
        ]

    def create_test_run(self, plan_id, name, point_ids, automated=True):
        self.created_point_ids = list(point_ids)
        return {"id": 77, "name": name}

    def list_test_results(self, run_id):
        return [
            {"id": 9000 + point_id, "testPoint": {"id": str(point_id)}}
            for point_id in self.created_point_ids or []
        ]

    def update_test_results(self, run_id, updates):
        self.updated_results = updates
        return updates

    def update_test_run(self, run_id, fields):
        return {"id": run_id, "name": "Guarded run", "state": fields.get("state", "Completed")}


def test_protected_publisher_creates_run_with_active_points_only():
    client = PublishingClient([
        point(401, 4001, "unspecified"),
        point(402, 4001, "passed"),
    ])
    publisher = ProtectedTestRunPublisher(client)

    result = publisher.publish(
        plan_id=1,
        suite_id=2,
        rows=[{
            "testCaseId": 4001,
            "testPointIds": [401, 402],
            "round1Results": "Passed",
            "comment": "guarded",
        }],
        result_key="round1Results",
        run_name="Guarded run",
    )

    assert client.created_point_ids == [401]
    assert [update["id"] for update in client.updated_results] == [9401]
    assert result["publishedPoints"] == 1
    assert result["skippedPoints"] == 1
    assert result["skippedCases"] == 1
