import re
from urllib.parse import parse_qs, urlparse

import requests
from flask import Blueprint, jsonify, request

from config import AppConfig
from services.ado_client import AdoClient

test_plans_bp = Blueprint("test_plans", __name__, url_prefix="/api/test-plans")


def parse_test_plan_url(value: str) -> tuple[int, int]:
    if not isinstance(value, str) or not value.strip():
        raise ValueError("Invalid URL. Paste an Azure DevOps Test Plan URL.")
    try:
        parsed = urlparse(value.strip())
        valid = (parsed.scheme in {"http", "https"} and parsed.hostname
                 and not parsed.username and not parsed.password
                 and parsed.path.rstrip("/").endswith("/_testPlans/execute"))
        parsed.port  # Validate malformed ports too.
        if not valid or any(char.isspace() for char in value.strip()):
            raise ValueError()
        query = parse_qs(parsed.query, keep_blank_values=True)
    except ValueError:
        raise ValueError("Invalid URL. Paste an Azure DevOps Test Plan execution URL.") from None
    ids = []
    for name in ("planId", "suiteId"):
        values = query.get(name)
        if not values or values == [""]:
            raise ValueError(f"{name} is missing from the URL.")
        if (len(values) != 1 or not re.fullmatch(r"[0-9]{1,10}", values[0])
                or not 0 < int(values[0]) <= 2147483647):
            raise ValueError(f"{name} must be a single positive numeric ID (32-bit integer).")
        ids.append(int(values[0]))
    return tuple(ids)


@test_plans_bp.post("/read-suite")
def read_suite():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "Request must be a JSON object containing url."}), 400
    try:
        plan_id, suite_id = parse_test_plan_url(payload.get("url"))
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    try:
        config = AppConfig.from_env()
        config.require_ado()
    except (RuntimeError, ValueError):
        return jsonify({"error": "ADO configuration is missing or invalid. Check organization, project and PAT in Setup."}), 400
    try:
        points = AdoClient(config).read_test_points(plan_id, suite_id)
    except requests.Timeout:
        return jsonify({"error": "Azure DevOps API timed out. Please try again."}), 504
    except requests.HTTPError as error:
        status = error.response.status_code if error.response is not None else None
        if status in (401, 403):
            message = "Azure DevOps authentication or access failed. Check the configured PAT and Test Management read permission."
        elif status == 404:
            message = "Test plan or suite not found in the configured ADO organization/project, or access is unavailable."
        else:
            message = "Azure DevOps REST API failed. Please try again."
        return jsonify({"error": message}), status if status in (401, 403, 404) else 502
    except Exception:
        # Never forward upstream bodies, URLs, headers or exception text to the browser.
        return jsonify({"error": "Azure DevOps REST API failed or returned an invalid response. Please try again."}), 502
    passed = sum(point["outcome"] == "Passed" for point in points)
    failed = sum(point["outcome"] == "Failed" for point in points)
    return jsonify({
        "planId": plan_id, "suiteId": suite_id,
        "summary": {"total": len(points), "passed": passed, "failed": failed,
                    "other": len(points) - passed - failed},
        "testPoints": points,
        "message": "Test suite loaded." if points else "This suite contains no test points.",
    })
