from functools import wraps

import requests
from flask import Blueprint, jsonify, request

from services.ado_session import NOT_CONNECTED_MESSAGE, get_ado_client
from services.test_case_browser import TestCaseBrowser, positive_id, search_options

work_items_bp = Blueprint("work_items", __name__, url_prefix="/api/work-items")


@work_items_bp.post("/read")
def read_work_items():
    payload = request.get_json(silent=True) or {}
    ids = [int(item_id) for item_id in payload.get("ids", []) if str(item_id).strip()]
    client = get_ado_client()
    return jsonify({"workItems": client.read_work_items(ids)})


def test_case_errors(handler):
    @wraps(handler)
    def wrapped(*args, **kwargs):
        try:
            return handler(*args, **kwargs)
        except RuntimeError:
            return jsonify({"error": NOT_CONNECTED_MESSAGE}), 400
        except LookupError:
            return jsonify({"error": "Test Case not found in the connected project."}), 404
        except requests.Timeout:
            return jsonify({"error": "Azure DevOps timed out. Please try again."}), 504
        except requests.HTTPError as error:
            status = error.response.status_code if error.response is not None else None
            if status in (401, 403):
                message = "ADO access failed. Check the PAT's Work Items read and Test Management permissions."
            elif status == 404:
                message = "Test Case or execution history API not found, or access is unavailable."
            else:
                message = "Azure DevOps could not load test case data. Please try again."
            return jsonify({"error": message}), status if status in (401, 403, 404) else 502
        except ValueError as error:
            return jsonify({"error": str(error)}), 400
        except Exception:
            return jsonify({"error": "Azure DevOps returned an invalid response. Please try again."}), 502
    return wrapped


@work_items_bp.post("/test-cases/search")
@test_case_errors
def search_test_cases():
    options = search_options(request.get_json(silent=True))
    return jsonify({"testCases": TestCaseBrowser(get_ado_client()).search(*options)})


@work_items_bp.get("/test-cases/<int:case_id>")
@test_case_errors
def read_test_case(case_id):
    return jsonify(TestCaseBrowser(get_ado_client()).detail(positive_id(case_id)))


@work_items_bp.get("/test-cases/<int:case_id>/history")
@test_case_errors
def read_test_case_history(case_id):
    skip = request.args.get("skip", "0")
    if not skip.isascii() or not skip.isdigit() or len(skip) > 8:
        raise ValueError("Invalid history page.")
    return jsonify(TestCaseBrowser(get_ado_client()).history(positive_id(case_id), int(skip)))
