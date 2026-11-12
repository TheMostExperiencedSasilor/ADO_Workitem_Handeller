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
        if status == 401:
            message = "Authentication failed. Please check your ADO PAT."
        elif status == 403:
            message = "Access denied. Check your PAT permissions and project access."
        elif status == 404:
            message = "ADO organization or project not found, or you do not have access."
        elif status == 429:
            message = "Azure DevOps is receiving too many requests. Please try again later."
        elif status is not None and status >= 500:
            message = "Azure DevOps is temporarily unavailable. Please try again later."
        else:
            message = "Unable to connect to Azure DevOps. Please try again."
        return jsonify({"error": message}), status if status in (401, 403, 404, 429) else 502
    if isinstance(error, requests.ConnectionError):
        return jsonify({"error": "Unable to reach Azure DevOps. Check your network connection."}), 503
    if isinstance(error, requests.RequestException):
        return jsonify({"error": "Unable to connect to Azure DevOps. Please try again."}), 502
    # Do not expose raw JSON parsing errors, exception text, or request data.
    if isinstance(error, (ValueError, RuntimeError)):
        return jsonify({"error": "Azure DevOps returned an unexpected response. Verify your organization, project, and PAT."}), 502
    return jsonify({"error": "Unable to connect to Azure DevOps. Please try again."}), 502


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
