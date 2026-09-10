import json
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
        output, updated_count = TestAssignmentWorkbookService.transfer_to_ote(
            ote_file.read(), rows, result_key
        )
    except (ValueError, json.JSONDecodeError) as error:
        return jsonify({"error": str(error)}), 400
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
    return response
