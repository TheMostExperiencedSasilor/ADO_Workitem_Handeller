import os
from pathlib import Path

import requests
from dotenv import set_key
from flask import Blueprint, jsonify, request

from config import AppConfig
from services.ado_session import (
    ado_session_connected,
    clear_ado_session,
    connect_ado_session,
)

setup_bp = Blueprint("setup", __name__, url_prefix="/api/setup")

ENV_PATH = Path(__file__).resolve().parents[1] / ".env"

PERSISTED_SETUP_KEYS = {
    "adoOrganization": "ADO_ORGANIZATION",
    "adoProject": "ADO_PROJECT",
}


@setup_bp.get("/status")
def setup_status():
    config = AppConfig.from_env()
    connected = ado_session_connected()
    return jsonify(
        {
            "envFileExists": ENV_PATH.exists(),
            "adoOrganization": config.ado_organization,
            "adoProject": config.ado_project,
            "adoOrganizationConfigured": bool(config.ado_organization),
            "adoProjectConfigured": bool(config.ado_project),
            "adoPatConfigured": connected,
            "adoConnected": connected,
        }
    )


def _connection_error(error: Exception):
    if isinstance(error, requests.Timeout):
        return jsonify({"error": "ADO connection timed out. Please try again."}), 504
    if isinstance(error, requests.HTTPError):
        status = error.response.status_code if error.response is not None else None
        if status in (401, 403):
            message = "ADO authentication or access failed. Check your PAT and permissions."
        elif status == 404:
            message = "ADO project was not found or is not accessible."
        else:
            message = "ADO connection failed. Please try again."
        return jsonify({"error": message}), status if status in (401, 403, 404) else 502
    if isinstance(error, (ValueError, RuntimeError)):
        return jsonify({"error": str(error)}), 400
    return jsonify({"error": "ADO connection failed. Please try again."}), 502


@setup_bp.post("")
def connect_setup():
    payload = request.get_json(silent=True) or {}
    organization = str(payload.get("adoOrganization", "")).strip()
    project = str(payload.get("adoProject", "")).strip()
    pat = str(payload.get("adoPat", "")).strip()

    if not organization or not project or not pat:
        return jsonify({"error": "ADO organization, project and PAT are required."}), 400

    clear_ado_session()
    ENV_PATH.touch(exist_ok=True)

    saved_keys: list[str] = []
    for payload_key, env_key in PERSISTED_SETUP_KEYS.items():
        value = organization if payload_key == "adoOrganization" else project
        set_key(str(ENV_PATH), env_key, value)
        os.environ[env_key] = value
        saved_keys.append(env_key)

    try:
        project_info = connect_ado_session(organization, project, pat)
    except Exception as error:
        clear_ado_session()
        return _connection_error(error)

    return jsonify(
        {
            "connected": True,
            "message": "ADO connected",
            "project": project_info,
            "savedKeys": saved_keys,
            "patPersisted": False,
        }
    )
