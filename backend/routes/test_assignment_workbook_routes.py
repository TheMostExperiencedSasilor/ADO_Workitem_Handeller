import json
import re

import requests
from flask import Blueprint, jsonify, request, send_file

from routes.test_plan_routes import parse_test_plan_url
from services.ado_client import AdoClient
from services.ado_session import NOT_CONNECTED_MESSAGE, get_ado_client
from services.protected_test_run_publisher import ProtectedTestRunPublisher
from services.result_logging_guard import ResultLoggingGuard
from services.test_assignment_workbook import TestAssignmentWorkbookService

assignment_workbook_bp = Blueprint(
    "assignment_workbook", __name__, url_prefix="/api/test-plans"
)


def _read_payload():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        raise ValueError("Request must be a JSON object.")
    plan_id, suite_id = parse_test_plan_url(payload.get("url"))
    tester = str(payload.get("tester", "")).strip()
    if not tester:
        raise ValueError("Assigned tester is required.")
    return payload, plan_id, suite_id, tester


def _client() -> AdoClient:
    return get_ado_client()


def _service() -> TestAssignmentWorkbookService:
    return TestAssignmentWorkbookService(_client())


def _as_bool(value) -> bool:
    if isinstance(value, bool):
        return value
    return str(value or "").strip().lower() in {"1", "true", "yes", "on"}


def _ado_error(error: Exception):
    if isinstance(error, requests.Timeout):
        return jsonify({"error": "Azure DevOps API timed out. Please try again."}), 504
    if isinstance(error, requests.HTTPError):
        status = error.response.status_code if error.response is not None else None
        if status in (401, 403):
            message = (
                "Azure DevOps authentication or access failed. Check the configured PAT and "
                "Test Management read/write permissions."
            )
        elif status == 404:
            message = "Test plan, suite, point or run was not found in the configured ADO project."
        else:
            message = "Azure DevOps REST API failed. Please try again."
        return jsonify({"error": message}), status if status in (401, 403, 404) else 502
    return jsonify({"error": "Azure DevOps REST API failed or returned an invalid response. Please try again."}), 502


@assignment_workbook_bp.post("/assignment-preview")
def assignment_preview():
    try:
        _, plan_id, suite_id, tester = _read_payload()
        result = _service().build_assignment_rows(plan_id, suite_id, tester)
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    except (RuntimeError, requests.RequestException) as error:
        if isinstance(error, RuntimeError):
            return jsonify({"error": NOT_CONNECTED_MESSAGE}), 400
        return _ado_error(error)
    except Exception:
        return jsonify({"error": "Azure DevOps REST API failed or returned an invalid response. Please try again."}), 502

    point_count = result.get("assignedPointCount", 0)
    return jsonify({
        "planId": plan_id,
        "suiteId": suite_id,
        **result,
        "message": (
            f"Found {result['assignedCount']} case(s) across {point_count} test point(s) assigned to "
            f"{result['matchedTester'] or tester}."
            if result["assignedCount"]
            else f"No cases assigned to {tester} were found in Execute."
        ),
    })


@assignment_workbook_bp.post("/assignment-workbook")
def assignment_workbook():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or not isinstance(payload.get("rows"), list):
        return jsonify({"error": "Tracked rows are required."}), 400
    try:
        workbook = TestAssignmentWorkbookService.make_workbook(payload["rows"])
    except Exception:
        return jsonify({"error": "Unable to build the Excel workbook."}), 500

    filename = str(payload.get("filename") or "Test_Assignment.xlsx")
    filename = re.sub(r"[^A-Za-z0-9._-]+", "_", filename).strip("_") or "Test_Assignment.xlsx"
    if not filename.lower().endswith(".xlsx"):
        filename += ".xlsx"
    return send_file(
        workbook,
        as_attachment=True,
        download_name=filename,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@assignment_workbook_bp.post("/logging-eligibility")
def logging_eligibility():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or not isinstance(payload.get("rows"), list):
        return jsonify({"error": "Tracked rows are required."}), 400
    try:
        plan_id, suite_id = parse_test_plan_url(payload.get("url"))
        report = ResultLoggingGuard(_client()).evaluate(
            plan_id=plan_id,
            suite_id=suite_id,
            rows=payload["rows"],
            result_key=str(payload.get("resultKey") or "").strip(),
            mode=str(payload.get("mode") or "ado").strip().lower(),
            allow_duplicate_logging=_as_bool(payload.get("allowDuplicateLogging")),
        )
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    except (RuntimeError, requests.RequestException) as error:
        if isinstance(error, RuntimeError):
            return jsonify({"error": NOT_CONNECTED_MESSAGE}), 400
        return _ado_error(error)
    except Exception:
        return jsonify({"error": "Unable to refresh duplicate-logging eligibility from Azure DevOps."}), 502
    return jsonify(report)


@assignment_workbook_bp.post("/transfer-to-ote")
def transfer_to_ote():
    ote_file = request.files.get("oteFile")
    if not ote_file or not ote_file.filename:
        return jsonify({"error": "Select an OTE .xlsx file."}), 400
    if not ote_file.filename.lower().endswith(".xlsx"):
        return jsonify({"error": "OTE file must be an .xlsx workbook."}), 400

    try:
        rows = json.loads(request.form.get("rows", "[]"))
        if not isinstance(rows, list):
            raise ValueError("Tracked rows are invalid.")
        result_key = str(request.form.get("resultKey", "")).strip()
        allow_duplicate_logging = _as_bool(request.form.get("allowDuplicateLogging"))
        guard_report = {"skippedCases": 0, "skippedPoints": 0, "skipped": []}

        if not allow_duplicate_logging:
            plan_id, suite_id = parse_test_plan_url(request.form.get("url"))
            rows, guard_report = ResultLoggingGuard(_client()).filter_rows_for_ote(
                plan_id=plan_id,
                suite_id=suite_id,
                rows=rows,
                result_key=result_key,
                allow_duplicate_logging=False,
            )
            if not guard_report["eligibleCaseIds"]:
                raise ValueError(
                    "No Active Azure DevOps Test Cases are eligible to transfer to OTE. "
                    "Use Allow duplicated logging only when you intentionally want to log completed cases again."
                )

        output, updated_count = TestAssignmentWorkbookService.transfer_to_ote(
            ote_file.read(), rows, result_key
        )
    except (ValueError, json.JSONDecodeError) as error:
        return jsonify({"error": str(error)}), 400
    except (RuntimeError, requests.RequestException) as error:
        if isinstance(error, RuntimeError):
            return jsonify({"error": NOT_CONNECTED_MESSAGE}), 400
        return _ado_error(error)
    except Exception:
        return jsonify({"error": "Unable to update the OTE workbook."}), 500

    original = re.sub(r"[^A-Za-z0-9._-]+", "_", ote_file.filename).strip("_") or "OTE.xlsx"
    stem = original[:-5] if original.lower().endswith(".xlsx") else original
    filename = f"{stem}_Completed.xlsx"
    response = send_file(
        output,
        as_attachment=True,
        download_name=filename,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    response.headers["X-OTE-Updated-Cases"] = str(updated_count)
    response.headers["X-OTE-Skipped-Cases"] = str(guard_report.get("skippedCases", 0))
    return response


@assignment_workbook_bp.post("/publish-test-run")
def publish_test_run():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "Request must be a JSON object."}), 400
    if not isinstance(payload.get("rows"), list):
        return jsonify({"error": "Tracked rows are required."}), 400

    try:
        plan_id, suite_id = parse_test_plan_url(payload.get("url"))
        result = ProtectedTestRunPublisher(_client()).publish(
            plan_id=plan_id,
            suite_id=suite_id,
            rows=payload["rows"],
            result_key=str(payload.get("resultKey") or "").strip(),
            run_name=str(payload.get("runName") or "").strip(),
            allow_duplicate_logging=_as_bool(payload.get("allowDuplicateLogging")),
        )
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    except (RuntimeError, requests.RequestException) as error:
        if isinstance(error, RuntimeError):
            return jsonify({"error": NOT_CONNECTED_MESSAGE}), 400
        return _ado_error(error)
    except Exception:
        return jsonify({"error": "Unable to create and publish the Azure DevOps test run."}), 502

    skipped = int(result.get("skippedCases") or 0)
    skip_text = f" {skipped} case(s) were skipped because their latest ADO status was not Active." if skipped else ""
    return jsonify({
        **result,
        "message": (
            f"Created ADO Test Run {result['runId']} with {result['publishedPoints']} published test point(s).{skip_text}"
        ),
    }), 201
