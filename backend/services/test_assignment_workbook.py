import re
from io import BytesIO
from typing import Any

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.worksheet.table import Table, TableStyleInfo

from services.ado_client import AdoClient


WORKBOOK_HEADERS = [
    "ID",
    "Title",
    "Product Area",
    "Automation Script Name",
    "Round 1 results",
    "Round 2 results",
    "Single run results",
    "Manual run",
    "Comment",
    "Solution",
    "Defects",
]

RESULT_COLUMN_KEYS = {
    "round1": "Round 1 results",
    "round2": "Round 2 results",
    "single": "Single run results",
    "manual": "Manual run",
}


def _normalize(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.lower())


def _field_value(fields: dict[str, Any], aliases: set[str]) -> str:
    normalized_aliases = {_normalize(alias) for alias in aliases}
    for reference_name, value in fields.items():
        tail = reference_name.rsplit(".", 1)[-1]
        normalized_tail = _normalize(tail)
        normalized_full = _normalize(reference_name)
        if normalized_tail in normalized_aliases or any(alias in normalized_full for alias in normalized_aliases):
            if value is None:
                return ""
            if isinstance(value, dict):
                return str(value.get("displayName") or value.get("name") or value.get("value") or "")
            return str(value)
    return ""


def _normalize_outcome(value: Any) -> str:
    raw = str(value or "unspecified")
    outcome = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", raw).replace("_", " ").title()
    if outcome in {"None", "Not Executed", "Not Run"}:
        return "Not Run"
    return outcome


def _excel_safe(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    if value.startswith(("=", "+", "-", "@")):
        return "'" + value
    return value


class TestAssignmentWorkbookService:
    def __init__(self, client: AdoClient) -> None:
        self.client = client

    def read_define_cases(self, plan_id: int, suite_id: int) -> list[dict[str, Any]]:
        path = f"Plans/{plan_id}/Suites/{suite_id}/TestCase"
        memberships = self.client._read_test_plan_pages(path)
        if not memberships:
            return []

        case_ids: list[int] = []
        order_by_id: dict[int, int | None] = {}
        for membership in memberships:
            work_item = membership.get("workItem") or {}
            if not work_item.get("id"):
                continue
            case_id = int(work_item["id"])
            if case_id not in order_by_id:
                case_ids.append(case_id)
            order = membership.get("order")
            order_by_id[case_id] = order if isinstance(order, int) and not isinstance(order, bool) else None

        work_items: dict[int, dict[str, Any]] = {}
        for start in range(0, len(case_ids), 200):
            for item in self.client.read_work_items(case_ids[start:start + 200]):
                work_items[int(item["id"])] = item

        rows: list[dict[str, Any]] = []
        for case_id in case_ids:
            fields = work_items.get(case_id, {}).get("fields", {})
            rows.append({
                "testCaseId": case_id,
                "title": str(fields.get("System.Title") or "Title unavailable"),
                "productArea": _field_value(fields, {"ProductArea", "Product Area"}),
                "automationScriptName": _field_value(fields, {
                    "AutomationScriptName",
                    "Automation Script Name",
                    "AutomationScript",
                    "AutomatedTestName",
                }),
                "order": order_by_id.get(case_id),
            })

        known_order = sorted((row for row in rows if row["order"] is not None), key=lambda row: row["order"])
        ordered_iter = iter(known_order)
        return [next(ordered_iter) if row["order"] is not None else row for row in rows]

    def _read_execute_points(self, plan_id: int, suite_id: int) -> list[dict[str, Any]]:
        path = f"Plans/{plan_id}/Suites/{suite_id}/TestPoint"
        points = self.client._read_test_plan_pages(path)
        rows: list[dict[str, Any]] = []
        for point in points:
            reference = point.get("testCaseReference") or {}
            if not reference.get("id"):
                continue
            tester = point.get("tester") or {}
            if isinstance(tester, dict):
                display_name = str(tester.get("displayName") or "").strip()
                unique_name = str(tester.get("uniqueName") or "").strip()
            else:
                display_name = str(tester).strip()
                unique_name = display_name
            rows.append({
                "testCaseId": int(reference["id"]),
                "tester": display_name or unique_name,
                "testerAliases": [name for name in (display_name, unique_name) if name],
                "outcome": _normalize_outcome((point.get("results") or {}).get("outcome")),
            })
        return rows

    def build_assignment_rows(self, plan_id: int, suite_id: int, tester_query: str) -> dict[str, Any]:
        query = tester_query.strip()
        if not query:
            raise ValueError("Assigned tester is required.")

        define_cases = self.read_define_cases(plan_id, suite_id)
        execute_points = self._read_execute_points(plan_id, suite_id)
        query_folded = query.casefold()

        exact_points = [
            point for point in execute_points
            if any(alias.casefold() == query_folded for alias in point["testerAliases"])
        ]
        candidates = exact_points or [
            point for point in execute_points
            if any(query_folded in alias.casefold() for alias in point["testerAliases"])
        ]

        matched_names = list(dict.fromkeys(point["tester"] for point in candidates if point["tester"]))
        if not exact_points and len({name.casefold() for name in matched_names}) > 1:
            raise ValueError(
                "Tester search matches multiple people: " + ", ".join(matched_names[:8])
                + ". Enter the exact display name or email."
            )

        outcomes_by_case: dict[int, list[str]] = {}
        for point in candidates:
            outcomes = outcomes_by_case.setdefault(point["testCaseId"], [])
            if point["outcome"] not in outcomes:
                outcomes.append(point["outcome"])

        assigned_rows: list[dict[str, Any]] = []
        for case in define_cases:
            outcomes = outcomes_by_case.get(case["testCaseId"])
            if not outcomes:
                continue
            assigned_rows.append({
                **case,
                "tester": matched_names[0] if matched_names else query,
                "outcome": " / ".join(outcomes),
            })

        return {
            "defineCount": len(define_cases),
            "assignedCount": len(assigned_rows),
            "matchedTester": matched_names[0] if len(matched_names) == 1 else (query if assigned_rows else ""),
            "rows": assigned_rows,
        }

    @staticmethod
    def make_workbook(rows: list[dict[str, Any]], result_column_key: str) -> BytesIO:
        result_header = RESULT_COLUMN_KEYS.get(result_column_key)
        if not result_header:
            raise ValueError("Invalid result destination.")

        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "Main"
        sheet.append(WORKBOOK_HEADERS)

        result_index = WORKBOOK_HEADERS.index(result_header)
        for row in rows:
            values: list[Any] = [
                row.get("testCaseId"),
                row.get("title", ""),
                row.get("productArea", ""),
                row.get("automationScriptName", ""),
                "", "", "", "", "", "", "",
            ]
            values[result_index] = row.get("outcome", "")
            sheet.append([_excel_safe(value) for value in values])

        header_fill = PatternFill("solid", fgColor="1F4E78")
        for cell in sheet[1]:
            cell.fill = header_fill
            cell.font = Font(color="FFFFFF", bold=True)
            cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)

        for row in sheet.iter_rows(min_row=2):
            for cell in row:
                cell.alignment = Alignment(vertical="top", wrap_text=True)

        sheet.freeze_panes = "A2"
        sheet.auto_filter.ref = sheet.dimensions
        sheet.row_dimensions[1].height = 32

        widths = [12, 56, 24, 32, 18, 18, 20, 16, 30, 30, 22]
        for index, width in enumerate(widths, start=1):
            sheet.column_dimensions[chr(64 + index)].width = width

        if rows:
            table = Table(displayName="MainTable", ref=f"A1:K{len(rows) + 1}")
            table.tableStyleInfo = TableStyleInfo(
                name="TableStyleMedium2",
                showFirstColumn=False,
                showLastColumn=False,
                showRowStripes=True,
                showColumnStripes=False,
            )
            sheet.add_table(table)

        output = BytesIO()
        workbook.save(output)
        output.seek(0)
        return output
