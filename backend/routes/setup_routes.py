import os
from pathlib import Path

from dotenv import set_key
from flask import Blueprint, jsonify, request

from config import AppConfig
from services.ado_client import AdoClient

setup_bp = Blueprint("setup", __name__, url_prefix="/api/setup")

ENV_PATH = Path(__file__).resolve().parents[1] / ".env"

SETUP_KEYS = {
    "adoOrganization": "ADO_ORGANIZATION",
    "adoProject": "ADO_PROJECT",
    "adoPat": "ADO_PAT",
    "adoApiVersion": "ADO_API_VERSION",
    "aiProvider": "AI_PROVIDER",
    "aiBaseUrl": "AI_BASE_URL",
    "aiModel": "AI_MODEL",
    "githubToken": "GITHUB_TOKEN",
}


@setup_bp.get("/status")
def setup_status():
    config = AppConfig.from_env()
    return jsonify(
        {
            "envFileExists": ENV_PATH.exists(),
            "adoOrganizationConfigured": bool(config.ado_organization),
            "adoProjectConfigured": bool(config.ado_project),
            "adoPatConfigured": bool(config.ado_pat),
            "aiBaseUrlConfigured": bool(config.ai_base_url),
            "aiModelConfigured": bool(config.ai_model),
            "githubTokenConfigured": bool(config.github_token),
        }
    )


@setup_bp.get("/ado-connection")
def ado_connection():
    try:
        project = AdoClient(AppConfig.from_env()).test_connection()
        return jsonify(
            {
                "connected": True,
                "message": "ADO connected",
                "project": project,
            }
        )
    except Exception as error:
        return jsonify(
            {
                "connected": False,
                "message": "ADO not connected",
                "error": str(error),
            }
        ), 400


@setup_bp.post("")
def save_setup():
    payload = request.get_json(silent=True) or {}
    ENV_PATH.touch(exist_ok=True)

    saved_keys: list[str] = []
    for payload_key, env_key in SETUP_KEYS.items():
        value = str(payload.get(payload_key, "")).strip()
        if value:
            set_key(str(ENV_PATH), env_key, value)
            os.environ[env_key] = value
            saved_keys.append(env_key)

    return jsonify(
        {
            "message": "Setup saved to backend .env and applied to the running backend.",
            "savedKeys": saved_keys,
            "tokenValuesReturned": False,
        }
    )
