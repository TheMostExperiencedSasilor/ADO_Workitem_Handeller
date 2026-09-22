import os
import sys
from pathlib import Path
from unittest.mock import Mock


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app import create_app
from config import AppConfig
from services.ado_client import AdoClient


def test_setup_status_uses_ado_defaults_and_never_returns_pat(monkeypatch):
    monkeypatch.delenv("ADO_ORGANIZATION", raising=False)
    monkeypatch.delenv("ADO_PROJECT", raising=False)
    monkeypatch.setenv("ADO_PAT", "saved-secret")

    response = create_app().test_client().get("/api/setup/status")

    assert response.status_code == 200
    assert response.json["adoOrganization"] == "aspentechnology"
    assert response.json["adoProject"] == "AspenTech SAFe"
    assert response.json["adoPatConfigured"] is True
    assert "adoPat" not in response.json


def test_connection_test_uses_current_form_without_saving(monkeypatch):
    monkeypatch.setenv("ADO_ORGANIZATION", "saved-org")
    monkeypatch.setenv("ADO_PROJECT", "Saved Project")
    monkeypatch.setenv("ADO_PAT", "saved-secret")

    observed = {}

    def fake_test_connection(self):
        observed["organization"] = self.config.ado_organization
        observed["project"] = self.config.ado_project
        observed["pat"] = self.config.ado_pat
        return {"id": "1", "name": self.config.ado_project, "state": "wellFormed"}

    monkeypatch.setattr(AdoClient, "test_connection", fake_test_connection)

    response = create_app().test_client().post(
        "/api/setup/ado-connection",
        json={
            "adoOrganization": "typed-org",
            "adoProject": "Typed Project",
            "adoPat": "",
        },
    )

    assert response.status_code == 200
    assert response.json["connected"] is True
    assert observed == {
        "organization": "typed-org",
        "project": "Typed Project",
        "pat": "saved-secret",
    }
    assert os.environ["ADO_ORGANIZATION"] == "saved-org"
    assert os.environ["ADO_PROJECT"] == "Saved Project"
    assert os.environ["ADO_PAT"] == "saved-secret"


def test_connection_test_can_use_new_unsaved_pat(monkeypatch):
    monkeypatch.setenv("ADO_ORGANIZATION", "saved-org")
    monkeypatch.setenv("ADO_PROJECT", "Saved Project")
    monkeypatch.setenv("ADO_PAT", "saved-secret")

    observed = {}

    def fake_test_connection(self):
        observed["pat"] = self.config.ado_pat
        return {"id": "1", "name": self.config.ado_project, "state": "wellFormed"}

    monkeypatch.setattr(AdoClient, "test_connection", fake_test_connection)

    response = create_app().test_client().post(
        "/api/setup/ado-connection",
        json={
            "adoOrganization": "typed-org",
            "adoProject": "Typed Project",
            "adoPat": "new-unsaved-secret",
        },
    )

    assert response.status_code == 200
    assert observed["pat"] == "new-unsaved-secret"
    assert os.environ["ADO_PAT"] == "saved-secret"


def test_ado_connection_uses_30_second_timeout(monkeypatch):
    monkeypatch.setenv("ADO_ORGANIZATION", "aspentechnology")
    monkeypatch.setenv("ADO_PROJECT", "AspenTech SAFe")
    monkeypatch.setenv("ADO_PAT", "saved-secret")

    response = Mock()
    response.raise_for_status = Mock()
    response.json.return_value = {
        "id": "project-id",
        "name": "AspenTech SAFe",
        "state": "wellFormed",
    }
    get = Mock(return_value=response)
    monkeypatch.setattr("services.ado_client.requests.get", get)

    AdoClient(AppConfig.from_env()).test_connection()

    assert get.call_args.kwargs["timeout"] == 30
