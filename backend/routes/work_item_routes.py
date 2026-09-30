from flask import Blueprint, jsonify, request

from services.ado_session import get_ado_client

work_items_bp = Blueprint("work_items", __name__, url_prefix="/api/work-items")


@work_items_bp.post("/read")
def read_work_items():
    payload = request.get_json(silent=True) or {}
    ids = [int(item_id) for item_id in payload.get("ids", []) if str(item_id).strip()]
    client = get_ado_client()
    return jsonify({"workItems": client.read_work_items(ids)})
