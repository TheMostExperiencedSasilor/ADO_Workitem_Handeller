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
}


@setup_bp.get("/status")
def setup_status():
    config = AppConfig.from_env()
    return jsonify(
        {
            "envFileExists": ENV_PATH.exists(),
            "adoOrganization": config.ado_organization,
            "adoProject": config.ado_project,
            "adoOrganizationConfigured": bool(config.ado_organization),
            "adoProjectConfigured": bool(config.ado_project),
            "adoPatConfigured": bool(config.ado_pat),
        }
    )


def _ado_connection_response(config: AppConfig):
    try:
        project = AdoClient(config).test_connection()
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


@setup_bp.get("/ado-connection")
def ado_connection():
    return _ado_connection_response(AppConfig.from_env())


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
