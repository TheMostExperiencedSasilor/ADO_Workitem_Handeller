from flask import Blueprint, jsonify, request

from config import AppConfig
from services.ado_session import get_ado_client
from services.ai_client import AiClient

chat_bp = Blueprint("chat", __name__, url_prefix="/api/chat")


@chat_bp.post("")
def chat():
    payload = request.get_json(silent=True) or {}
    message = payload.get("message", "").strip()
    if not message:
        return jsonify({"error": "message is required"}), 400

    ids = [int(item_id) for item_id in payload.get("ids", []) if str(item_id).strip()]
    config = AppConfig.from_env()
    context = get_ado_client().read_work_items(ids) if ids else []
    answer = AiClient(config).chat(message, context=context)
    return jsonify({"answer": answer, "contextWorkItems": context})
