import re

from flask import Blueprint, jsonify, request

from services.ado_session import get_ado_client
from services.ai_client import AiClient, AiServiceError
from services.ai_session import ai_status, clear_ai_session, connect_ai_session, get_ai_session

chat_bp = Blueprint("chat", __name__, url_prefix="/api/chat")


@chat_bp.errorhandler(AiServiceError)
def ai_error(error):
    return jsonify({"error": str(error)}), error.status


def payload_object():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        raise ValueError("A JSON object is required.")
    return payload


@chat_bp.get("/status")
def status():
    return jsonify(ai_status())


@chat_bp.post("/connect")
def connect():
    token = payload_object().get("token")
    if not isinstance(token, str) or not token.strip() or len(token) > 4096:
        raise ValueError("A GitHub PAT is required for Copilot.")
    return jsonify(connect_ai_session(token.strip()))


@chat_bp.post("/disconnect")
def disconnect():
    clear_ai_session()
    return jsonify(ai_status())


@chat_bp.post("")
def chat():
    payload = payload_object()
    message = payload.get("message")
    if not isinstance(message, str) or not message.strip() or len(message) > 16000:
        raise ValueError("Enter a message of 1 to 16000 characters.")
    ids = payload.get("ids", [])
    if not isinstance(ids, list) or len(ids) > 20 or any(
        not re.fullmatch(r"[1-9][0-9]{0,9}", str(item)) for item in ids
    ):
        raise ValueError("Enter up to 20 positive work-item IDs.")
    history = payload.get("history", [])
    if not isinstance(history, list) or len(history) > 20 or any(
        not isinstance(turn, dict) or turn.get("role") not in ("user", "assistant")
        or not isinstance(turn.get("content"), str) or len(turn["content"]) > 16000
        for turn in history
    ):
        raise ValueError("Conversation history must contain up to 20 user/assistant messages of at most 16000 characters each.")
    current = get_ai_session()
    model = payload.get("model")
    if not isinstance(model, str) or model not in {m["id"] for m in current.models}:
        raise ValueError("Select an available Copilot model.")
    history = [{"role": turn["role"], "content": turn["content"]} for turn in history]
    ids = list(dict.fromkeys(int(item) for item in ids))
    context = get_ado_client().read_work_items(ids) if ids else []
    answer = AiClient(current.token).chat(message.strip(), model=model, history=history, context=context)
    return jsonify({"answer": answer, "contextIds": ids})
