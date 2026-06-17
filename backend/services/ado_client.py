import base64
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
