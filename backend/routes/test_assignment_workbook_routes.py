import re

import requests
from flask import Blueprint, jsonify, request, send_file

from config import AppConfig
from routes.test_plan_routes import parse_test_plan_url
from services.ado_client import AdoClient
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


def _service() -> TestAssignmentWorkbookService:
    config = AppConfig.from_env()
    config.require_ado()
    return TestAssignmentWorkbookService(AdoClient(config))


def _ado_error(error: Exception):
    if isinstance(error, requests.Timeout):
        return jsonify({"error": "Azure DevOps API timed out. Please try again."}), 504
    if isinstance(error, requests.HTTPError):
        status = error.response.status_code if error.response is not None else None
        if status in (401, 403):
            message = "Azure DevOps authentication or access failed. Check the configured PAT and Test Management read permission."
        elif status == 404:
            message = "Test plan or suite not found in the configured ADO organization/project, or access is unavailable."
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
            return jsonify({"error": "ADO configuration is missing or invalid. Check organization, project and PAT in Setup."}), 400
        return _ado_error(error)
    except Exception:
        return jsonify({"error": "Azure DevOps REST API failed or returned an invalid response. Please try again."}), 502

    return jsonify({
        "planId": plan_id,
        "suiteId": suite_id,
        **result,
        "message": (
            f"Found {result['assignedCount']} case(s) assigned to {result['matchedTester'] or tester}."
            if result["assignedCount"]
            else f"No cases assigned to {tester} were found in Execute."
        ),
    })


@assignment_workbook_bp.post("/assignment-workbook")
def assignment_workbook():
    try:
        _, plan_id, suite_id, tester = _read_payload()
        service = _service()
        result = service.build_assignment_rows(plan_id, suite_id, tester)
        workbook = service.make_workbook(result["rows"])
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    except (RuntimeError, requests.RequestException) as error:
        if isinstance(error, RuntimeError):
            return jsonify({"error": "ADO configuration is missing or invalid. Check organization, project and PAT in Setup."}), 400
        return _ado_error(error)
    except Exception:
        return jsonify({"error": "Unable to build the Excel workbook."}), 500

    safe_tester = re.sub(r"[^A-Za-z0-9._-]+", "_", result["matchedTester"] or tester).strip("_") or "tester"
    filename = f"TestPlan_{plan_id}_Suite_{suite_id}_{safe_tester}.xlsx"
    return send_file(
        workbook,
        as_attachment=True,
        download_name=filename,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
