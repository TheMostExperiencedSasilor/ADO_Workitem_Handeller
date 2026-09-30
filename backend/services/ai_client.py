from typing import Any

import requests

from config import AppConfig


class AiClient:
    def __init__(self, config: AppConfig) -> None:
        self.config = config
        self.config.require_ai()

    def chat(self, message: str, context: list[dict[str, Any]] | None = None) -> str:
        context_text = ""
        if context:
            context_text = "\n\nWork item context:\n" + self._summarize_work_items(context)
        prompt = f"You are an ADO work item assistant. Answer clearly and practically.{context_text}\n\nUser: {message}"
        return self._chat(prompt)

    def _chat(self, prompt: str) -> str:
        url = self.config.ai_base_url.rstrip("/") + "/chat/completions"
        response = requests.post(
            url,
            headers={
                "Authorization": f"Bearer {self.config.github_token}",
                "Content-Type": "application/json",
            },
            json={
                "model": self.config.ai_model,
                "messages": [
                    {
                        "role": "system",
                        "content": "You are a senior QA/SDET assistant for Azure DevOps work item analysis and writing.",
                    },
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.2,
            },
            timeout=60,
        )
        response.raise_for_status()
        data = response.json()
        return data["choices"][0]["message"]["content"]

    def _summarize_work_items(self, work_items: list[dict[str, Any]]) -> str:
        lines: list[str] = []
        for item in work_items:
            fields = item.get("fields", {})
            lines.append(
                "\n".join(
                    [
                        f"ID: {item.get('id')}",
                        f"Type: {fields.get('System.WorkItemType', '')}",
                        f"Title: {fields.get('System.Title', '')}",
                        f"State: {fields.get('System.State', '')}",
                        f"Description: {fields.get('System.Description', '')}",
                    ]
                )
            )
        return "\n\n---\n\n".join(lines)
