import base64
import re
from typing import Any
from urllib.parse import quote

import requests

from config import AppConfig


class AdoClient:
    def __init__(self, config: AppConfig) -> None:
        self.config = config
        self.config.require_ado()
        token = f":{self.config.ado_pat}".encode("utf-8")
        encoded_token = base64.b64encode(token).decode("utf-8")
        self.headers = {
            "Authorization": f"Basic {encoded_token}",
            "Accept": "application/json",
        }
        self.patch_headers = {
            **self.headers,
            "Content-Type": "application/json-patch+json",
        }
        self.base_url = (
            f"https://dev.azure.com/{self.config.ado_organization}/"
            f"{quote(self.config.ado_project)}"
        )

    def test_connection(self) -> dict[str, Any]:
        url = (
            f"https://dev.azure.com/{self.config.ado_organization}/"
            f"_apis/projects/{quote(self.config.ado_project, safe='')}"
        )
        response = requests.get(
            url,
            headers=self.headers,
            params={"api-version": self.config.ado_api_version},
            timeout=15,
        )
        response.raise_for_status()
        data = response.json()
        return {
            "id": data.get("id"),
            "name": data.get("name"),
            "state": data.get("state"),
        }

    def read_work_items(self, ids: list[int]) -> list[dict[str, Any]]:
        if not ids:
            return []

        id_text = ",".join(str(item_id) for item_id in ids)
        url = f"{self.base_url}/_apis/wit/workitems"
        response = requests.get(
            url,
            headers=self.headers,
            params={
                "ids": id_text,
                "$expand": "all",
                "api-version": self.config.ado_api_version,
            },
            timeout=30,
        )
        response.raise_for_status()
        return response.json().get("value", [])

    def _read_test_plan_pages(self, path: str) -> list[dict[str, Any]]:
        """Follow ADO continuation headers without following payload URLs."""
        params = {"api-version": self.config.ado_api_version, "isRecursive": "false"}
        items = []
        seen_tokens = set()
        while True:
            response = requests.get(
                f"{self.base_url}/_apis/testplan/{path}",
                headers=self.headers, params=dict(params), timeout=30,
                allow_redirects=False,
            )
            response.raise_for_status()
            if response.status_code != 200:
                raise ValueError("Unexpected Azure DevOps response.")
            data = response.json()
            if not isinstance(data, dict) or not isinstance(data.get("value"), list):
                raise ValueError("Invalid Azure DevOps response.")
            items.extend(data["value"])
            token = response.headers.get("x-ms-continuationtoken")
            if not token:
                return items
            if token in seen_tokens:
                raise ValueError("Repeated Azure DevOps continuation token.")
            seen_tokens.add(token)
            params["continuationToken"] = token

    def read_test_points(self, plan_id: int, suite_id: int) -> list[dict[str, Any]]:
        """Return one row per point (including multiple configurations per case)."""
        path = f"Plans/{plan_id}/Suites/{suite_id}"
        points = self._read_test_plan_pages(f"{path}/TestPoint")
        if not points:
            return []

        # Order belongs to suite membership, not the point ID or work item ID.
        cases = self._read_test_plan_pages(f"{path}/TestCase")
        orders = {}
        for case in cases:
            case_id = int(case["workItem"]["id"])
            order = case.get("order")
            if isinstance(order, int) and not isinstance(order, bool):
                orders[case_id] = order

        rows = []
        for point in points:
            reference = point["testCaseReference"]
            case_id = int(reference["id"])
            raw_outcome = (point.get("results") or {}).get("outcome") or "unspecified"
            outcome = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", raw_outcome).replace("_", " ").title()
            if outcome in {"None", "Not Executed", "Not Run"}:
                outcome = "Not Run"
            rows.append({
                "testCaseId": case_id,
                "title": reference.get("name") or "",
                "outcome": outcome,
                "order": orders.get(case_id),
            })

        missing_ids = list(dict.fromkeys(row["testCaseId"] for row in rows if not row["title"]))
        titles = {}
        # The work-item list API accepts at most 200 IDs per request.
        for start in range(0, len(missing_ids), 200):
            for item in self.read_work_items(missing_ids[start:start + 200]):
                titles[int(item["id"])] = item.get("fields", {}).get("System.Title", "")
        for row in rows:
            if not row["title"]:
                row["title"] = titles.get(row["testCaseId"]) or "Title unavailable"

        # Sort known orders in place; rows without Order retain their API positions.
        ordered = iter(sorted(
            (row for row in rows if row["order"] is not None),
            key=lambda row: row["order"],
        ))
        return [next(ordered) if row["order"] is not None else row for row in rows]

    def create_work_item(
        self,
        work_item_type: str,
        title: str,
        description: str = "",
        assigned_to: str | None = None,
        parent_id: int | None = None,
        additional_fields: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        allowed_types = {"Task", "User Story", "Feature"}
        if work_item_type not in allowed_types:
            raise ValueError(f"Unsupported create type: {work_item_type}")

        operations: list[dict[str, Any]] = [
            {"op": "add", "path": "/fields/System.Title", "value": title},
        ]
        if description:
            operations.append(
                {"op": "add", "path": "/fields/System.Description", "value": description}
            )
        if assigned_to:
            operations.append(
                {"op": "add", "path": "/fields/System.AssignedTo", "value": assigned_to}
            )
        for field_name, value in (additional_fields or {}).items():
            operations.append({"op": "add", "path": f"/fields/{field_name}", "value": value})
        if parent_id:
            operations.append(
                {
                    "op": "add",
                    "path": "/relations/-",
                    "value": {
                        "rel": "System.LinkTypes.Hierarchy-Reverse",
                        "url": self._work_item_url(parent_id),
                        "attributes": {"comment": "Linked by ADO Work Item AI Assistant"},
                    },
                }
            )

        url = f"{self.base_url}/_apis/wit/workitems/${quote(work_item_type)}"
        response = requests.post(
            url,
            headers=self.patch_headers,
            params={"api-version": self.config.ado_api_version},
            json=operations,
            timeout=30,
        )
        response.raise_for_status()
        return response.json()

    def update_work_item(
        self,
        work_item_id: int,
        fields: dict[str, Any],
    ) -> dict[str, Any]:
        operations = [
            {"op": "add", "path": f"/fields/{field_name}", "value": value}
            for field_name, value in fields.items()
        ]
        url = f"{self.base_url}/_apis/wit/workitems/{work_item_id}"
        response = requests.patch(
            url,
            headers=self.patch_headers,
            params={"api-version": self.config.ado_api_version},
            json=operations,
            timeout=30,
        )
        response.raise_for_status()
        return response.json()

    def _work_item_url(self, work_item_id: int) -> str:
        return (
            f"https://dev.azure.com/{self.config.ado_organization}/"
            f"_apis/wit/workItems/{work_item_id}"
        )
