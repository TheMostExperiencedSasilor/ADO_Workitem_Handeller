import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from rules.writing_rules import evaluate_smart, split_into_three


def test_evaluate_smart_scores_clear_item():
    result = evaluate_smart(
        title="Add ADO work item reader",
        description="Allow a user to read work item details by ID for testing value.",
        acceptance_criteria="Complete before release and return at least 1 matching item.",
    )

    assert result.specific is True
    assert result.measurable is True
    assert result.relevant is True
    assert result.time_bound is True
    assert result.score >= 4


def test_split_into_three_creates_expected_titles():
    items = split_into_three("Improve bug triage", "Make the triage flow clearer.")

    assert len(items) == 3
    assert items[0]["title"].startswith("Investigate")
    assert items[1]["title"].startswith("Implement")
    assert items[2]["title"].startswith("Validate")
