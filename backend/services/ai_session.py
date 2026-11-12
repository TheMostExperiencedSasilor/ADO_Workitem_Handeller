from dataclasses import dataclass, field
from threading import RLock

from services.ai_client import AiClient


@dataclass(frozen=True)
class AiSession:
    token: str = field(repr=False)
    models: tuple[dict, ...]


_lock = RLock()
_session: AiSession | None = None


def clear_ai_session():
    global _session
    with _lock:
        _session = None


def ai_status():
    with _lock:
        return {"connected": _session is not None,
                "models": list(_session.models) if _session else []}


def connect_ai_session(token):
    global _session
    clear_ai_session()
    models = AiClient(token).list_models()
    with _lock:
        _session = AiSession(token, tuple(models))
    return ai_status()


def get_ai_session():
    with _lock:
        current = _session
    if current is None:
        raise ValueError("AI is not connected. Enter your GitHub PAT under Setup and click Connect to Copilot.")
    return current
