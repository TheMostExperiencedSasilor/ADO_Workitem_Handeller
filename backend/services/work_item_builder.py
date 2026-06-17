from typing import Any

from rules.writing_rules import apply_rules


class WorkItemBuilder:
    def prepare_write_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        title = payload.get("title", "").strip()
        work_item_type = payload.get("type", "Task").strip()
        if not title:
            raise ValueError("title is required")
        if work_item_type not in {"Task", "User Story", "Feature"}:
            raise ValueError("type must be Task, User Story, or Feature")

        rule_result = apply_rules(payload)
        return {
            "type": work_item_type,
            "title": title,
            "description": payload.get("description", ""),
            "assignedTo": payload.get("assignedTo"),
            "parentId": payload.get("parentId"),
            "additionalFields": payload.get("additionalFields", {}),
            "ruleResult": rule_result,
        }

    def fields_for_update(self, payload: dict[str, Any]) -> dict[str, Any]:
        fields: dict[str, Any] = {}
        if payload.get("title"):
            fields["System.Title"] = payload["title"]
        if payload.get("description"):
            fields["System.Description"] = payload["description"]
        if payload.get("assignedTo"):
            fields["System.AssignedTo"] = payload["assignedTo"]
        fields.update(payload.get("additionalFields", {}))
        if not fields:
            raise ValueError("No fields provided for update")
        return fields
