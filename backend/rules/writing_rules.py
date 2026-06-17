from dataclasses import dataclass


@dataclass(frozen=True)
class SmartResult:
    specific: bool
    measurable: bool
    achievable: bool
    relevant: bool
    time_bound: bool

    @property
    def score(self) -> int:
        return sum(
            [
                self.specific,
                self.measurable,
                self.achievable,
                self.relevant,
                self.time_bound,
            ]
        )

    def to_dict(self) -> dict[str, bool | int]:
        return {
            "specific": self.specific,
            "measurable": self.measurable,
            "achievable": self.achievable,
            "relevant": self.relevant,
            "time_bound": self.time_bound,
            "score": self.score,
        }


def evaluate_smart(title: str, description: str = "", acceptance_criteria: str = "") -> SmartResult:
    text = " ".join([title, description, acceptance_criteria]).lower()
    measurable_terms = ["%", "count", "number", "within", "at least", "less than", "greater than"]
    time_terms = ["by ", "before ", "after ", "sprint", "release", "date", "deadline"]
    relevance_terms = ["user", "customer", "business", "quality", "test", "defect", "risk", "value"]

    return SmartResult(
        specific=len(title.strip()) >= 12 and len(description.strip()) >= 20,
        measurable=any(term in text for term in measurable_terms) or any(char.isdigit() for char in text),
        achievable="impossible" not in text and "always" not in text,
        relevant=any(term in text for term in relevance_terms),
        time_bound=any(term in text for term in time_terms),
    )


def split_into_three(title: str, description: str = "") -> list[dict[str, str]]:
    base = title.strip() or "Work item"
    detail = description.strip() or "No description provided."
    return [
        {
            "title": f"Investigate - {base}",
            "description": f"Clarify scope, constraints, risks, and expected outcome.\n\nOriginal: {detail}",
        },
        {
            "title": f"Implement - {base}",
            "description": f"Deliver the agreed change and keep the implementation focused.\n\nOriginal: {detail}",
        },
        {
            "title": f"Validate - {base}",
            "description": f"Create or run validation checks and capture evidence.\n\nOriginal: {detail}",
        },
    ]


def apply_rules(payload: dict) -> dict:
    title = payload.get("title", "")
    description = payload.get("description", "")
    acceptance_criteria = payload.get("acceptanceCriteria", "")
    requested_rules = set(payload.get("rules", []))

    result: dict = {"input": payload, "rules": {}}
    if "smart" in requested_rules:
        result["rules"]["smart"] = evaluate_smart(
            title,
            description,
            acceptance_criteria,
        ).to_dict()
    if "split_into_three" in requested_rules:
        result["rules"]["split_into_three"] = split_into_three(title, description)
    return result
