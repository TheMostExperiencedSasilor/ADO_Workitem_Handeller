from collections import defaultdict

import requests
from flask import Blueprint, jsonify, request

from config import AppConfig
from routes.test_plan_routes import parse_test_plan_url
from services.ado_client import AdoClient


logged_ado_results_bp = Blueprint(
    "logged_ado_results", __name__, url_prefix="/api/test-plans"
)


def _client() -> AdoClient:
    return AdoClient(AppConfig.from_env())


def _aliases(point: dict) -> list[str]:
    tester = point.get("tester") or {}
    if isinstance(tester, dict):
        return [
            str(value).strip()
            for value in (tester.get("displayName"), tester.get("uniqueName"))
            if str(value or "").strip()
        ]
    text = str(tester or "").strip()
    return [text] if text else []


def _display_name(point: dict) -> str:
    aliases = _aliases(point)
    return aliases[0] if aliases else ""


def _completed_outcome(point: dict) -> str:
    raw = str((point.get("results") or {}).get("outcome") or "").strip().lower()
    normalized = raw.replace("_", "").replace(" ", "")
    if normalized == "passed":
        return "Passed"
    if normalized == "failed":
        return "Failed"
    if normalized == "blocked":
        return "Blocked"
    if normalized in {"notapplicable", "na"}:
        return "N/A"
    # notExecuted / unspecified / blank mean there is no completed ADO result to copy.
    return ""


@logged_ado_results_bp.post("/logged-results")
def logged_results():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict):
        return jsonify({"error": "Request body is required."}), 400

    raw_ids = payload.get("testCaseIds")
    if not isinstance(raw_ids, list):
        return jsonify({"error": "testCaseIds must be a list."}), 400

    case_ids: list[int] = []
    for raw in raw_ids:
        try:
            value = int(raw)
        except (TypeError, ValueError):
            continue
        if value > 0 and value not in case_ids:
            case_ids.append(value)
    if not case_ids:
        return jsonify({"error": "At least one Test Case ID is required."}), 400

    tester_query = str(payload.get("tester") or "").strip()
    if not tester_query:
        return jsonify({"error": "Assigned tester is required."}), 400

    try:
        plan_id, suite_id = parse_test_plan_url(payload.get("url"))
        points = _client()._read_test_plan_pages(
            f"Plans/{plan_id}/Suites/{suite_id}/TestPoint"
        )
    except RuntimeError:
        return jsonify({"error": "ADO configuration is missing or invalid. Check Setup."}), 400
    except requests.Timeout:
        return jsonify({"error": "Azure DevOps API timed out. Please try again."}), 504
    except requests.RequestException:
        return jsonify({"error": "Unable to read current Azure DevOps Test Point results."}), 502
    except ValueError as error:
        return jsonify({"error": str(error)}), 400
    except Exception:
        return jsonify({"error": "Unable to read current Azure DevOps Test Point results."}), 502

    wanted = set(case_ids)
    relevant = []
    for point in points:
        reference = point.get("testCaseReference") or {}
        try:
            case_id = int(reference.get("id"))
        except (TypeError, ValueError):
            continue
        if case_id in wanted:
            relevant.append(point)

    query_folded = tester_query.casefold()
    exact = [
        point for point in relevant
        if any(alias.casefold() == query_folded for alias in _aliases(point))
    ]
    candidates = exact or [
        point for point in relevant
        if any(query_folded in alias.casefold() for alias in _aliases(point))
    ]

    matched_names = list(dict.fromkeys(
        name for point in candidates for name in [_display_name(point)] if name
    ))
    if not exact and len({name.casefold() for name in matched_names}) > 1:
        return jsonify({
            "error": "Tester search matches multiple people: "
            + ", ".join(matched_names[:8])
            + ". Enter the exact display name or email."
        }), 400

    results_by_case: dict[int, list[str]] = defaultdict(list)
    for point in candidates:
        reference = point.get("testCaseReference") or {}
        try:
            case_id = int(reference.get("id"))
        except (TypeError, ValueError):
            continue
        outcome = _completed_outcome(point)
        if outcome:
            results_by_case[case_id].append(outcome)

    results = []
    for case_id in case_ids:
        distinct = list(dict.fromkeys(results_by_case.get(case_id, [])))
        results.append({
            "testCaseId": case_id,
            "result": distinct[0] if len(distinct) == 1 else "",
            "ambiguous": len(distinct) > 1,
            "loggedResults": distinct,
        })

    return jsonify({
        "planId": plan_id,
        "suiteId": suite_id,
        "matchedTester": matched_names[0] if len(matched_names) == 1 else tester_query,
        "results": results,
    })
