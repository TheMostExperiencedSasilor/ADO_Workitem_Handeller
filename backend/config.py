import os
from dataclasses import dataclass
from dotenv import load_dotenv

load_dotenv()


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
            ado_organization=os.getenv("ADO_ORGANIZATION", ""),
            ado_project=os.getenv("ADO_PROJECT", ""),
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
