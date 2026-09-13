import time
from collections import Counter
from typing import Any

from services.ado_client import AdoClient


RESULT_COLUMNS = {
    "round1Results": "Round 1",
    "round2Results": "Round 2",
    "singleRunResults": "Single Run",
    "manualRun": "Manual Run",
}

OUTCOME_MAP = {
    "Passed": "Passed",
    "Failed": "Failed",
    "Blocked": "Blocked",
    "Not Run": "NotExecuted",
    "N/A": "NotApplicable",
}


class TestRunPublisher:
    def __init__(self, client: AdoClient) -> None:
        self.client = client

    @staticmethod
    def _comment_for_row(row: dict[str, Any]) -> str:
        parts: list[str] = []
        comment = str(row.get("comment") or "").strip()
        solution = str(row.get("solution") or "").strip()
        defects = str(row.get("defects") or "").strip()
        if comment:
            parts.append(comment)
        if solution:
            parts.append(f"Solution: {solution}")
        if defects:
            parts.append(f"Defects: {defects}")
        return "\n".join(parts)[:1000]

    @staticmethod
    def _normalize_point_ids(value: Any) -> list[int]:
        if not isinstance(value, list):
            return []
        point_ids: list[int] = []
        for raw in value:
            try:
                point_id = int(raw)
            except (TypeError, ValueError):
                continue
            if point_id > 0 and point_id not in point_ids:
                point_ids.append(point_id)
        return point_ids

    def publish(
        self,
        plan_id: int,
        suite_id: int,
        rows: list[dict[str, Any]],
        result_key: str,
        run_name: str,
    ) -> dict[str, Any]:
        if result_key not in RESULT_COLUMNS:
            raise ValueError("Choose a valid result column to publish.")
        if not isinstance(rows, list) or not rows:
            raise ValueError("Tracked rows are required.")

        run_name = str(run_name or "").strip()
        if not run_name:
            run_name = f"Suite {suite_id} - {RESULT_COLUMNS[result_key]}"
        if len(run_name) > 256:
            raise ValueError("Test run name must be 256 characters or fewer.")

        requested_by_point: dict[int, dict[str, Any]] = {}
        missing_mapping = 0
        for row in rows:
            if not isinstance(row, dict):
                continue
            source_outcome = str(row.get(result_key) or "").strip()
            if not source_outcome:
                continue
            ado_outcome = OUTCOME_MAP.get(source_outcome)
            if not ado_outcome:
                raise ValueError(f"Unsupported result value: {source_outcome}.")
            point_ids = self._normalize_point_ids(row.get("testPointIds"))
            if not point_ids:
                missing_mapping += 1
                continue
            try:
                case_id = int(row.get("testCaseId"))
            except (TypeError, ValueError):
                raise ValueError("A tracked row has an invalid Test Case ID.") from None
            for point_id in point_ids:
                existing = requested_by_point.get(point_id)
                if existing and existing["outcome"] != ado_outcome:
                    raise ValueError(f"Test point {point_id} has conflicting outcomes in the tracker.")
                requested_by_point[point_id] = {
                    "pointId": point_id,
                    "testCaseId": case_id,
                    "outcome": ado_outcome,
                    "sourceOutcome": source_outcome,
                    "comment": self._comment_for_row(row),
                }

        if missing_mapping:
            raise ValueError(
                f"{missing_mapping} result row(s) do not contain Azure DevOps test-point IDs. "
                "Reload the assignment from ADO before publishing."
            )
        if not requested_by_point:
            raise ValueError(f"{RESULT_COLUMNS[result_key]} has no results to publish.")

        # Re-read the suite before writing so stale or manipulated point IDs cannot
        # publish outside the currently selected test plan/suite.
        current_points = self.client.read_test_points(plan_id, suite_id)
        current_by_id = {
            int(point["testPointId"]): point
            for point in current_points
            if point.get("testPointId") is not None
        }
        for point_id, requested in requested_by_point.items():
            current = current_by_id.get(point_id)
            if current is None:
                raise ValueError(
                    f"Test point {point_id} is no longer part of Test Plan {plan_id}, Suite {suite_id}. Reload the tracker."
                )
            if int(current.get("testCaseId") or 0) != requested["testCaseId"]:
                raise ValueError(f"Test point {point_id} no longer matches its tracked Test Case. Reload the tracker.")

        point_ids = list(requested_by_point)
        automated = result_key != "manualRun"
        run = self.client.create_test_run(plan_id, run_name, point_ids, automated=automated)
        run_id = int(run.get("id") or 0)
        if not run_id:
            raise ValueError("Azure DevOps created a test run without returning a run ID.")

        try:
            result_by_point: dict[int, dict[str, Any]] = {}
            for attempt in range(8):
                run_results = self.client.list_test_results(run_id)
                result_by_point = {}
                for result in run_results:
                    test_point = result.get("testPoint") or {}
                    try:
                        point_id = int(test_point.get("id")) if isinstance(test_point, dict) else 0
                    except (TypeError, ValueError):
                        point_id = 0
                    if point_id:
                        result_by_point[point_id] = result
                if all(point_id in result_by_point for point_id in point_ids):
                    break
                if attempt < 7:
                    time.sleep(0.4)

            missing_points = [point_id for point_id in point_ids if point_id not in result_by_point]
            if missing_points:
                raise ValueError(
                    "Azure DevOps created the run but did not expose result records for "
                    f"{len(missing_points)} test point(s). The run was aborted."
                )

            updates: list[dict[str, Any]] = []
            for point_id in point_ids:
                result = result_by_point[point_id]
                result_id = int(result.get("id") or 0)
                if not result_id:
                    raise ValueError(f"Azure DevOps returned an invalid result ID for test point {point_id}.")
                requested = requested_by_point[point_id]
                update: dict[str, Any] = {
                    "id": result_id,
                    "outcome": requested["outcome"],
                    "state": "Completed",
                }
                if requested["comment"]:
                    update["comment"] = requested["comment"]
                updates.append(update)

            self.client.update_test_results(run_id, updates)
            completed_run = self.client.update_test_run(run_id, {"state": "Completed"})
        except Exception:
            try:
                self.client.update_test_run(
                    run_id,
                    {
                        "state": "Aborted",
                        "errorMessage": "Publishing from ADO Work Item AI Assistant did not complete.",
                    },
                )
            except Exception:
                pass
            raise

        source_counts = Counter(item["sourceOutcome"] for item in requested_by_point.values())
        final_run = completed_run if isinstance(completed_run, dict) else run
        return {
            "runId": run_id,
            "runName": final_run.get("name") or run_name,
            "state": final_run.get("state") or "Completed",
            "webAccessUrl": final_run.get("webAccessUrl") or run.get("webAccessUrl") or "",
            "apiUrl": final_run.get("url") or run.get("url") or "",
            "publishedPoints": len(point_ids),
            "publishedCases": len({item["testCaseId"] for item in requested_by_point.values()}),
            "resultSource": result_key,
            "resultLabel": RESULT_COLUMNS[result_key],
            "outcomes": dict(source_counts),
        }
