import re
from io import BytesIO
from typing import Any

from openpyxl import Workbook, load_workbook
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

RESULT_KEYS = {
    "round1Results": "Round 1 results",
    "round2Results": "Round 2 results",
    "singleRunResults": "Single run results",
    "manualRun": "Manual run",
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

        assigned_case_ids = {point["testCaseId"] for point in candidates}
        assigned_rows: list[dict[str, Any]] = []
        for case in define_cases:
            if case["testCaseId"] not in assigned_case_ids:
                continue
            assigned_rows.append({
                **case,
                "tester": matched_names[0] if matched_names else query,
                "round1Results": "",
                "round2Results": "",
                "singleRunResults": "",
                "manualRun": "",
                "comment": "",
                "solution": "",
                "defects": "",
            })

        return {
            "defineCount": len(define_cases),
            "assignedCount": len(assigned_rows),
            "matchedTester": matched_names[0] if len(matched_names) == 1 else (query if assigned_rows else ""),
            "rows": assigned_rows,
        }

    @staticmethod
    def make_workbook(rows: list[dict[str, Any]]) -> BytesIO:
        workbook = Workbook()
        sheet = workbook.active
        sheet.title = "Main"
        sheet.append(WORKBOOK_HEADERS)

        for row in rows:
            values: list[Any] = [
                row.get("testCaseId"),
                row.get("title", ""),
                row.get("productArea", ""),
                row.get("automationScriptName", ""),
                row.get("round1Results", ""),
                row.get("round2Results", ""),
                row.get("singleRunResults", ""),
                row.get("manualRun", ""),
                row.get("comment", ""),
                row.get("solution", ""),
                row.get("defects", ""),
            ]
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

    @staticmethod
    def transfer_to_ote(ote_bytes: bytes, rows: list[dict[str, Any]], result_key: str) -> tuple[BytesIO, int]:
        if result_key not in RESULT_KEYS:
            raise ValueError("Choose a valid result column to transfer to OTE.")

        outcome_by_case = {
            int(row["testCaseId"]): str(row.get(result_key, "")).strip()
            for row in rows
            if row.get("testCaseId") and str(row.get(result_key, "")).strip()
        }
        if not outcome_by_case:
            raise ValueError("The selected result column has no outcomes to transfer.")

        workbook = load_workbook(BytesIO(ote_bytes))
        updated_cases: set[int] = set()

        for sheet in workbook.worksheets:
            headers = {
                str(cell.value).strip(): cell.column
                for cell in sheet[1]
                if cell.value is not None
            }
            case_col = headers.get("TestCaseId")
            title_col = headers.get("Title")
            outcome_col = headers.get("Outcome")
            if not case_col or not outcome_col:
                continue

            current_case_id: int | None = None
            current_outcome = ""
            for row_index in range(2, sheet.max_row + 1):
                raw_case = sheet.cell(row=row_index, column=case_col).value
                raw_title = sheet.cell(row=row_index, column=title_col).value if title_col else None
                try:
                    candidate_id = int(raw_case)
                except (TypeError, ValueError):
                    candidate_id = None

                # OTE exports use placeholder values on step rows. A genuine case row has
                # a real TestCaseId plus a real title; subsequent step rows belong to it.
                is_case_header = candidate_id is not None and (
                    title_col is None or str(raw_title or "").strip() not in {"", "11"}
                )
                if is_case_header:
                    current_case_id = candidate_id
                    current_outcome = outcome_by_case.get(candidate_id, "")
                    if current_outcome:
                        updated_cases.add(candidate_id)

                if current_case_id is not None and current_outcome:
                    sheet.cell(row=row_index, column=outcome_col).value = current_outcome

        if not updated_cases:
            raise ValueError("No matching TestCaseId values were found in the selected OTE workbook.")

        output = BytesIO()
        workbook.save(output)
        output.seek(0)
        return output, len(updated_cases)
