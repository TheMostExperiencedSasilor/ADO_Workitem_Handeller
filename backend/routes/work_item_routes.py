from flask import Blueprint, jsonify, request

from config import AppConfig
from services.ado_client import AdoClient
from services.ai_client import AiClient
from services.work_item_builder import WorkItemBuilder

work_items_bp = Blueprint("work_items", __name__, url_prefix="/api/work-items")


@work_items_bp.post("/read")
def read_work_items():
    payload = request.get_json(silent=True) or {}
    ids = [int(item_id) for item_id in payload.get("ids", []) if str(item_id).strip()]
    client = AdoClient(AppConfig.from_env())
    return jsonify({"workItems": client.read_work_items(ids)})


@work_items_bp.post("/analyze")
def analyze_work_items():
    payload = request.get_json(silent=True) or {}
    ids = [int(item_id) for item_id in payload.get("ids", []) if str(item_id).strip()]
    config = AppConfig.from_env()
    work_items = payload.get("workItems") or []
    if ids:
        work_items = AdoClient(config).read_work_items(ids)
    analysis = AiClient(config).analyze_work_items(
        work_items,
        instruction=payload.get("instruction", ""),
    )
    return jsonify({"workItems": work_items, **analysis})


@work_items_bp.post("/draft")
def draft_work_items():
    payload = request.get_json(silent=True) or {}
    ids = [int(item_id) for item_id in payload.get("ids", []) if str(item_id).strip()]
    config = AppConfig.from_env()
    source_work_items = AdoClient(config).read_work_items(ids) if ids else []
    draft = AiClient(config).draft_work_items(
        request_text=payload.get("request", ""),
        source_work_items=source_work_items,
        rules=payload.get("rules", []),
    )
    return jsonify({"draft": draft, "sourceWorkItems": source_work_items})


@work_items_bp.post("/create")
def create_work_item():
    payload = request.get_json(silent=True) or {}
    builder = WorkItemBuilder()
    prepared = builder.prepare_write_payload(payload)
    client = AdoClient(AppConfig.from_env())
    created = client.create_work_item(
        work_item_type=prepared["type"],
        title=prepared["title"],
        description=prepared["description"],
        assigned_to=prepared.get("assignedTo"),
        parent_id=prepared.get("parentId"),
        additional_fields=prepared.get("additionalFields"),
    )
    return jsonify({"created": created, "ruleResult": prepared["ruleResult"]}), 201


@work_items_bp.patch("/<int:work_item_id>")
def update_work_item(work_item_id: int):
    payload = request.get_json(silent=True) or {}
    fields = WorkItemBuilder().fields_for_update(payload)
    updated = AdoClient(AppConfig.from_env()).update_work_item(work_item_id, fields)
    return jsonify({"updated": updated})
