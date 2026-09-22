import os
import sys
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

    assert response.status_code == 400
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
    response.json.return_value = {
        "id": "project-id",
        "name": "AspenTech SAFe",
        "state": "wellFormed",
    }
    get = Mock(return_value=response)
    monkeypatch.setattr("services.ado_client.requests.get", get)

    AdoClient(config).test_connection()

    assert get.call_args.kwargs["timeout"] == 30
