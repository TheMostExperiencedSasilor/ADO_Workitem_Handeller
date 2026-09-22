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
