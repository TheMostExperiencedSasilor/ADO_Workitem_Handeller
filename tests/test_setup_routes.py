import os
import sys

import pytest
import requests
from dataclasses import replace
from pathlib import Path
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

import routes.setup_routes as setup_routes
from app import create_app
from config import AppConfig, purge_persisted_ado_pat
from services.ado_client import AdoClient
from services.ado_session import (
    ado_session_connected,
    clear_ado_session,
    get_ado_config,
)


def test_setup_starts_disconnected_and_never_returns_pat(monkeypatch):
    clear_ado_session()
    monkeypatch.delenv("ADO_ORGANIZATION", raising=False)
    monkeypatch.delenv("ADO_PROJECT", raising=False)
    monkeypatch.setenv("ADO_PAT", "legacy-secret")

    response = create_app().test_client().get("/api/setup/status")

    assert response.status_code == 200
    assert response.json["adoOrganization"] == "aspentechnology"
    assert response.json["adoProject"] == "AspenTech SAFe"
    assert response.json["adoPatConfigured"] is False
    assert response.json["adoConnected"] is False
    assert "adoPat" not in response.json
    clear_ado_session()


def test_connect_keeps_pat_in_memory_only(monkeypatch, tmp_path):
    clear_ado_session()
    env_path = tmp_path / ".env"
    monkeypatch.setattr(setup_routes, "ENV_PATH", env_path)
    monkeypatch.setenv("ADO_ORGANIZATION", "old-org")
    monkeypatch.setenv("ADO_PROJECT", "Old Project")
    monkeypatch.delenv("ADO_PAT", raising=False)

    observed = {}

    def fake_test_connection(self):
        observed["organization"] = self.config.ado_organization
        observed["project"] = self.config.ado_project
        observed["pat"] = self.config.ado_pat
        return {"id": "1", "name": self.config.ado_project, "state": "wellFormed"}

    monkeypatch.setattr(AdoClient, "test_connection", fake_test_connection)

    response = create_app().test_client().post("/api/setup", json={
        "adoOrganization": "aspentechnology",
        "adoProject": "AspenTech SAFe",
        "adoPat": "session-secret",
    })

    assert response.status_code == 200
    assert response.json["connected"] is True
    assert response.json["patPersisted"] is False
    assert observed == {
        "organization": "aspentechnology",
        "project": "AspenTech SAFe",
        "pat": "session-secret",
    }
    assert ado_session_connected() is True
    assert get_ado_config().ado_pat == "session-secret"
    assert "ADO_PAT" not in env_path.read_text(encoding="utf-8")
    assert "session-secret" not in env_path.read_text(encoding="utf-8")
    assert os.environ.get("ADO_PAT") is None

    clear_ado_session()
    assert ado_session_connected() is False


def test_failed_connect_does_not_keep_pat(monkeypatch, tmp_path):
    clear_ado_session()
    monkeypatch.setattr(setup_routes, "ENV_PATH", tmp_path / ".env")
    monkeypatch.setattr(
        AdoClient,
        "test_connection",
        Mock(side_effect=RuntimeError("bad credentials")),
    )

    response = create_app().test_client().post("/api/setup", json={
        "adoOrganization": "aspentechnology",
        "adoProject": "AspenTech SAFe",
        "adoPat": "bad-secret",
    })

    assert response.status_code == 502
    assert "bad credentials" not in response.json["error"]
    assert ado_session_connected() is False


def test_legacy_ado_pat_is_removed_from_env_file_and_process(monkeypatch, tmp_path):
    env_path = tmp_path / ".env"
    env_path.write_text(
        "ADO_ORGANIZATION=aspentechnology\n"
        "ADO_PAT=legacy-secret\n"
        "ADO_PROJECT=AspenTech SAFe\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("ADO_PAT", "legacy-secret")

    assert purge_persisted_ado_pat(env_path) is True

    text = env_path.read_text(encoding="utf-8")
    assert "ADO_PAT" not in text
    assert "legacy-secret" not in text
    assert os.environ.get("ADO_PAT") is None


def test_ado_connection_uses_30_second_timeout(monkeypatch):
    monkeypatch.setenv("ADO_ORGANIZATION", "aspentechnology")
    monkeypatch.setenv("ADO_PROJECT", "AspenTech SAFe")
    config = replace(AppConfig.from_env(), ado_pat="session-secret")

    response = Mock()
    response.raise_for_status = Mock()
    response.headers = {"Content-Type": "application/json"}
    response.json.return_value = {
        "id": "project-id",
        "name": "AspenTech SAFe",
        "state": "wellFormed",
    }
    get = Mock(return_value=response)
    monkeypatch.setattr("services.ado_client.requests.get", get)

    AdoClient(config).test_connection()

    assert get.call_args.kwargs["timeout"] == 30


@pytest.mark.parametrize(("failure", "status", "message"), [
    (requests.HTTPError(response=Mock(status_code=401)), 401, "Authentication failed"),
    (requests.HTTPError(response=Mock(status_code=403)), 403, "Access denied"),
    (requests.HTTPError(response=Mock(status_code=404)), 404, "organization or project"),
    (requests.Timeout(), 504, "timed out"),
    (requests.ConnectionError(), 503, "network connection"),
    (ValueError("Expecting value: line 3 column 1 (char 4)"), 502, "unexpected response"),
])
def test_connection_errors_are_actionable_and_safe(monkeypatch, tmp_path, failure, status, message):
    clear_ado_session()
    monkeypatch.setattr(setup_routes, "ENV_PATH", tmp_path / ".env")
    monkeypatch.setattr(AdoClient, "test_connection", Mock(side_effect=failure))
    response = create_app().test_client().post("/api/setup", json={
        "adoOrganization": "example-org",
        "adoProject": "Example Project",
        "adoPat": "private-test-token",
    })
    assert response.status_code == status
    assert message.lower() in response.json["error"].lower()
    assert "private-test-token" not in response.get_data(as_text=True)
    assert "Expecting value" not in response.get_data(as_text=True)
    assert not ado_session_connected()


def test_connection_rejects_html_success_response(monkeypatch):
    monkeypatch.setenv("ADO_ORGANIZATION", "example-org")
    monkeypatch.setenv("ADO_PROJECT", "Example Project")
    config = replace(AppConfig.from_env(), ado_pat="private-test-token")
    response = Mock()
    response.headers = {"Content-Type": "text/html"}
    response.raise_for_status = Mock()
    response.json.side_effect = ValueError("Expecting value")
    monkeypatch.setattr("services.ado_client.requests.get", Mock(return_value=response))
    with pytest.raises(ValueError, match="Unexpected Azure DevOps response format"):
        AdoClient(config).test_connection()
    response.json.assert_not_called()
