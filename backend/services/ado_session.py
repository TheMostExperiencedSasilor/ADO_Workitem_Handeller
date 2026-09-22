from dataclasses import dataclass, replace
from threading import RLock

from config import AppConfig
from services.ado_client import AdoClient

NOT_CONNECTED_MESSAGE = (
    "ADO is not connected. Enter your PAT on the Setup page and click Connect to ADO."
)


@dataclass(frozen=True)
class RuntimeAdoSession:
    organization: str
    project: str
    pat: str
    api_version: str


_lock = RLock()
_session: RuntimeAdoSession | None = None


def clear_ado_session() -> None:
    global _session
    with _lock:
        _session = None


def ado_session_connected() -> bool:
    with _lock:
        return _session is not None


def set_ado_session(
    organization: str,
    project: str,
    pat: str,
    api_version: str,
) -> None:
    global _session
    if not organization.strip() or not project.strip() or not pat.strip():
        raise ValueError("ADO organization, project and PAT are required.")
    with _lock:
        _session = RuntimeAdoSession(
            organization=organization.strip(),
            project=project.strip(),
            pat=pat.strip(),
            api_version=api_version.strip() or "7.1",
        )


def connect_ado_session(organization: str, project: str, pat: str) -> dict:
    clear_ado_session()
    base = AppConfig.from_env()
    candidate = replace(
        base,
        ado_organization=organization.strip(),
        ado_project=project.strip(),
        ado_pat=pat.strip(),
    )
    candidate.require_ado()
    project_info = AdoClient(candidate).test_connection()
    set_ado_session(
        candidate.ado_organization,
        candidate.ado_project,
        candidate.ado_pat,
        candidate.ado_api_version,
    )
    return project_info


def get_ado_config() -> AppConfig:
    with _lock:
        current = _session
    if current is None:
        raise RuntimeError(NOT_CONNECTED_MESSAGE)

    return replace(
        AppConfig.from_env(),
        ado_organization=current.organization,
        ado_project=current.project,
        ado_pat=current.pat,
        ado_api_version=current.api_version,
    )


def get_ado_client() -> AdoClient:
    return AdoClient(get_ado_config())
