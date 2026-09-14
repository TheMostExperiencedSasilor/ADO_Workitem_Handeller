from collections import defaultdict
from typing import Any

from services.ado_client import AdoClient


RESULT_KEYS = {"round1Results", "round2Results", "singleRunResults", "manualRun"}


def _point_status(point: dict[str, Any]) -> str:
    raw = str((point.get("results") or {}).get("outcome") or "").strip()
    normalized = raw.lower().replace("_", "").replace(" ", "")
    if normalized == "passed":
        return "Passed"
    if normalized == "failed":
        return "Failed"
    if normalized in {"", "none", "unspecified", "notexecuted", "notrun", "active"}:
        return "Active"
    return raw or "Unknown"


def _point_id(point: dict[str, Any]) -> int | None:
    try:
        value = int(point.get("id"))
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


def _case_id(point: dict[str, Any]) -> int | None:
    reference = point.get("testCaseReference") or {}
    try:
        value = int(reference.get("id"))
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


def _row_case_id(row: dict[str, Any]) -> int | None:
    try:
        value = int(row.get("testCaseId"))
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


def _row_point_ids(row: dict[str, Any]) -> list[int]:
    values = row.get("testPointIds")
    if not isinstance(values, list):
        return []
    result: list[int] = []
    for raw in values:
        try:
            value = int(raw)
        except (TypeError, ValueError):
            continue
        if value > 0 and value not in result:
            result.append(value)
    return result


class ResultLoggingGuard:
    """Evaluate tracker results against the current ADO Test Point outcomes."""

    def __init__(self, client: AdoClient) -> None:
        self.client = client

    def read_current_points(self, plan_id: int, suite_id: int) -> list[dict[str, Any]]:
        raw_points = self.client._read_test_plan_pages(
            f"Plans/{plan_id}/Suites/{suite_id}/TestPoint"
        )
        points: list[dict[str, Any]] = []
        for point in raw_points:
            point_id = _point_id(point)
            case_id = _case_id(point)
            if point_id is None or case_id is None:
                continue
            points.append({
                "testPointId": point_id,
                "testCaseId": case_id,
                "status": _point_status(point),
            })
        return points

    def evaluate(
        self,
        plan_id: int,
        suite_id: int,
        rows: list[dict[str, Any]],
        result_key: str,
        mode: str,
        allow_duplicate_logging: bool = False,
    ) -> dict[str, Any]:
        if result_key not in RESULT_KEYS:
            raise ValueError("Choose a valid result column.")
        if mode not in {"ado", "ote"}:
            raise ValueError("Duplicate logging check mode must be ADO or OTE.")

        logged_rows = [
            row for row in rows
            if isinstance(row, dict) and str(row.get(result_key) or "").strip()
        ]
        if allow_duplicate_logging:
            case_ids = {_row_case_id(row) for row in logged_rows}
            point_ids = {
                point_id
                for row in logged_rows
                for point_id in _row_point_ids(row)
            }
            return {
                "eligibleCaseIds": sorted(case_id for case_id in case_ids if case_id),
                "eligiblePointIds": sorted(point_ids),
                "skippedCases": 0,
                "skippedPoints": 0,
                "skipped": [],
            }

        current_points = self.read_current_points(plan_id, suite_id)
        by_case: dict[int, list[dict[str, Any]]] = defaultdict(list)
        by_point = {point["testPointId"]: point for point in current_points}
        for point in current_points:
            by_case[point["testCaseId"]].append(point)

        eligible_case_ids: set[int] = set()
        eligible_point_ids: set[int] = set()
        skipped_cases: list[dict[str, Any]] = []
        skipped_point_count = 0

        for row in logged_rows:
            case_id = _row_case_id(row)
            if case_id is None:
                continue
            requested_ids = _row_point_ids(row)
            points = [by_point[point_id] for point_id in requested_ids if point_id in by_point]
            if not requested_ids:
                points = by_case.get(case_id, [])

            if mode == "ado":
                active = [point for point in points if point["status"] == "Active"]
                blocked = [point for point in points if point["status"] != "Active"]
                eligible_point_ids.update(point["testPointId"] for point in active)
                if active:
                    eligible_case_ids.add(case_id)
                skipped_point_count += len(blocked)
                if not points or not active or blocked:
                    statuses = sorted({point["status"] for point in points}) or ["Missing"]
                    skipped_cases.append({
                        "testCaseId": case_id,
                        "status": "/".join(statuses),
                        "reason": (
                            "No current Test Point found"
                            if not points else
                            "No Active Test Point"
                            if not active else
                            f"{len(blocked)} completed Test Point(s) skipped"
                        ),
                    })
                continue

            # OTE writes at TestCaseId block level, so be conservative: every
            # relevant current point must still be Active before the case is written.
            if points and all(point["status"] == "Active" for point in points):
                eligible_case_ids.add(case_id)
                eligible_point_ids.update(point["testPointId"] for point in points)
            else:
                statuses = sorted({point["status"] for point in points}) or ["Missing"]
                skipped_point_count += len([point for point in points if point["status"] != "Active"])
                skipped_cases.append({
                    "testCaseId": case_id,
                    "status": "/".join(statuses),
                    "reason": "Case is not safely Active in ADO",
                })

        return {
            "eligibleCaseIds": sorted(eligible_case_ids),
            "eligiblePointIds": sorted(eligible_point_ids),
            "skippedCases": len(skipped_cases),
            "skippedPoints": skipped_point_count,
            "skipped": skipped_cases,
        }

    def filter_rows_for_ado(
        self,
        plan_id: int,
        suite_id: int,
        rows: list[dict[str, Any]],
        result_key: str,
        allow_duplicate_logging: bool = False,
    ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        report = self.evaluate(
            plan_id, suite_id, rows, result_key, "ado", allow_duplicate_logging
        )
        if allow_duplicate_logging:
            return rows, report

        eligible_points = set(report["eligiblePointIds"])
        filtered: list[dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict) or not str(row.get(result_key) or "").strip():
                filtered.append(row)
                continue
            clone = dict(row)
            clone["testPointIds"] = [
                point_id for point_id in _row_point_ids(row) if point_id in eligible_points
            ]
            if clone["testPointIds"]:
                filtered.append(clone)
        return filtered, report

    def filter_rows_for_ote(
        self,
        plan_id: int,
        suite_id: int,
        rows: list[dict[str, Any]],
        result_key: str,
        allow_duplicate_logging: bool = False,
    ) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        report = self.evaluate(
            plan_id, suite_id, rows, result_key, "ote", allow_duplicate_logging
        )
        if allow_duplicate_logging:
            return rows, report
        eligible_cases = set(report["eligibleCaseIds"])
        filtered = [
            row for row in rows
            if not str(row.get(result_key) or "").strip()
            or _row_case_id(row) in eligible_cases
        ]
        return filtered, report
