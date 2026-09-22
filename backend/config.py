import os
import re
from dataclasses import dataclass
from pathlib import Path

from dotenv import load_dotenv

ENV_PATH = Path(__file__).resolve().parent / ".env"


def purge_persisted_ado_pat(env_path: Path = ENV_PATH) -> bool:
    """Remove legacy persisted ADO PAT values before loading backend settings."""
    os.environ.pop("ADO_PAT", None)
    if not env_path.exists():
        return False

    original = env_path.read_text(encoding="utf-8")
    lines = original.splitlines(keepends=True)
    filtered = [
        line
        for line in lines
        if not re.match(r"^\s*(?:export\s+)?ADO_PAT\s*=", line)
    ]
    updated = "".join(filtered)
    if updated == original:
        return False

    env_path.write_text(updated, encoding="utf-8")
    return True


# Migration/security guard: ADO PAT is session-only and must never be loaded from .env.
purge_persisted_ado_pat()
load_dotenv(ENV_PATH)


@dataclass(frozen=True)
class AppConfig:
    ado_organization: str
    ado_project: str
    ado_pat: str
    ado_api_version: str
    ai_provider: str
    ai_base_url: str
    ai_model: str
    github_token: str
    flask_host: str
    flask_port: int
    flask_debug: bool

    @staticmethod
    def from_env() -> "AppConfig":
        return AppConfig(
            ado_organization=os.getenv("ADO_ORGANIZATION", "aspentechnology"),
            ado_project=os.getenv("ADO_PROJECT", "AspenTech SAFe"),
            # Runtime ADO routes receive PAT from services.ado_session instead.
            # Keeping this environment read supports direct AdoClient unit tests only;
            # config import removes any persisted/process ADO_PAT at application startup.
            ado_pat=os.getenv("ADO_PAT", ""),
            ado_api_version=os.getenv("ADO_API_VERSION", "7.1"),
            ai_provider=os.getenv("AI_PROVIDER", "github"),
            ai_base_url=os.getenv("AI_BASE_URL", "https://models.github.ai/inference"),
            ai_model=os.getenv("AI_MODEL", "openai/gpt-4.1-mini"),
            github_token=os.getenv("GITHUB_TOKEN", ""),
            flask_host=os.getenv("FLASK_HOST", "127.0.0.1"),
            flask_port=int(os.getenv("FLASK_PORT", "5000")),
            flask_debug=os.getenv("FLASK_DEBUG", "false").lower() == "true",
        )

    def require_ado(self) -> None:
        missing = [
            name
            for name, value in {
                "ADO_ORGANIZATION": self.ado_organization,
                "ADO_PROJECT": self.ado_project,
                "ADO_PAT": self.ado_pat,
            }.items()
            if not value
        ]
        if missing:
            raise RuntimeError(f"Missing ADO configuration: {', '.join(missing)}")

    def require_ai(self) -> None:
        missing = [
            name
            for name, value in {
                "AI_BASE_URL": self.ai_base_url,
                "AI_MODEL": self.ai_model,
                "GITHUB_TOKEN": self.github_token,
            }.items()
            if not value
        ]
        if missing:
            raise RuntimeError(f"Missing AI configuration: {', '.join(missing)}")
