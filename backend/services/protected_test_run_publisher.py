from typing import Any

from services.ado_client import AdoClient
from services.result_logging_guard import ResultLoggingGuard
from services.test_run_publisher import TestRunPublisher


class ProtectedTestRunPublisher(TestRunPublisher):
    """Apply the shared duplicate guard immediately before normal ADO publishing."""

    def __init__(self, client: AdoClient) -> None:
        super().__init__(client)
        self.guard = ResultLoggingGuard(client)

    def publish(
        self,
        plan_id: int,
        suite_id: int,
        rows: list[dict[str, Any]],
        result_key: str,
        run_name: str,
        allow_duplicate_logging: bool = False,
    ) -> dict[str, Any]:
        filtered_rows, guard_report = self.guard.filter_rows_for_ado(
            plan_id=plan_id,
            suite_id=suite_id,
            rows=rows,
            result_key=result_key,
            allow_duplicate_logging=allow_duplicate_logging,
        )

        if not allow_duplicate_logging and not guard_report["eligiblePointIds"]:
            raise ValueError(
                "No Active Azure DevOps Test Points are eligible to publish. "
                "Use Allow duplicated logging only when you intentionally want to log completed cases again."
            )

        result = super().publish(
            plan_id=plan_id,
            suite_id=suite_id,
            rows=filtered_rows,
            result_key=result_key,
            run_name=run_name,
        )
        result["allowDuplicateLogging"] = bool(allow_duplicate_logging)
        result["skippedCases"] = guard_report["skippedCases"]
        result["skippedPoints"] = guard_report["skippedPoints"]
        result["skipped"] = guard_report["skipped"]
        return result
