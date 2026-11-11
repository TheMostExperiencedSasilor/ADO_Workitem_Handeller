"""Read-only Test Case search and execution history against Azure DevOps."""
import re
from urllib.parse import unquote
from xml.etree import ElementTree

import requests

__test__ = False  # Service module, not a pytest test module.


MAX_ID = 2147483647


def positive_id(value):
    if isinstance(value, bool) or not re.fullmatch(r"[0-9]{1,10}", str(value)):
        raise ValueError("Test case ID must be a positive 32-bit integer.")
    number = int(value)
    if not 0 < number <= MAX_ID:
        raise ValueError("Test case ID must be a positive 32-bit integer.")
    return number


def search_options(payload):
    if not isinstance(payload, dict):
        raise ValueError("Request must be a JSON object.")
    field, mode = payload.get("field", "id"), payload.get("mode", "exact")
    query = payload.get("query", "")
    if not isinstance(field, str) or not isinstance(mode, str) or field not in {"id", "title"} or mode not in {"exact", "flexible"}:
        raise ValueError("Choose ID or title and Exact match or Flexible match.")
    if not isinstance(query, str) or not query.strip() or len(query) > 300:
        raise ValueError("Enter a search value of 1–300 characters.")
    query = query.strip()
    if field == "id":
        query = re.sub(r"\s+", "", query)
        query = str(positive_id(query))
    elif mode == "flexible":
        query = " ".join(query.split())
    return field, mode, query


def title_rank(title, query):
    title, query = " ".join(title.casefold().split()), " ".join(query.casefold().split())
    if title.startswith(query):
        return 1
    if query in title:
        return 2
    return 3 if re.search(".*?".join(re.escape(word) for word in query.split()), title) else None


class TestCaseBrowser:
    def __init__(self, client):
        self.client = client

    def _post(self, path, body, params=None, results_host=False):
        client = self.client
        base = client.base_url.replace("https://dev.azure.com/", "https://vstmr.dev.azure.com/") if results_host else client.base_url
        response = requests.post(
            f"{base}/_apis/{path}", headers=client.json_headers,
            params={"api-version": "7.1-preview.2" if results_host else client.config.ado_api_version, **(params or {})},
            json=body, timeout=30, allow_redirects=False,
        )
        response.raise_for_status()
        if response.status_code != 200:
            raise ValueError("Unexpected Azure DevOps response.")
        return response.json()

    def search(self, field, mode, query):
        conditions = ["[System.TeamProject] = @project", "[System.WorkItemType] = 'Test Case'"]
        if field == "id":
            number = int(query)
            if mode == "exact":
                conditions.append(f"[System.Id] = {number}")
            else:
                # WIQL IDs are numeric: prefix matching is a union of numeric ranges.
                ranges = []
                for digits in range(11 - len(query)):
                    low = number * 10 ** digits
                    if low > MAX_ID:
                        break
                    high = min((number + 1) * 10 ** digits - 1, MAX_ID)
                    ranges.append(f"([System.Id] >= {low} AND [System.Id] <= {high})")
                conditions.append("(" + " OR ".join(ranges) + ")")
        else:
            words = query.split() if mode == "flexible" else [query]
            operator = "CONTAINS" if mode == "flexible" else "="
            conditions.extend(f"[System.Title] {operator} '{word.replace(chr(39), chr(39) * 2)}'" for word in words)

        items, after = [], 0
        while True:
            wiql = "SELECT [System.Id] FROM WorkItems WHERE " + " AND ".join(conditions)
            wiql += f" AND [System.Id] > {after} ORDER BY [System.Id] ASC"
            data = self._post("wit/wiql", {"query": wiql}, {"$top": 1000})
            refs = data.get("workItems")
            if not isinstance(refs, list):
                raise ValueError("Invalid Azure DevOps search response.")
            ids = [positive_id(item["id"]) for item in refs]
            if not ids:
                break
            if min(ids) <= after:
                raise ValueError("Azure DevOps search did not advance.")
            for start in range(0, len(ids), 200):
                for item in self.client.read_work_items(ids[start:start + 200]):
                    fields = item.get("fields", {})
                    if fields.get("System.WorkItemType") != "Test Case":
                        continue
                    title = fields.get("System.Title", "")
                    rank = title_rank(title, query) if field == "title" and mode == "flexible" else 1
                    if rank is None:
                        continue
                    items.append({"id": item["id"], "title": title, "state": fields.get("System.State", ""),
                                  "assignedTo": display_value(fields.get("System.AssignedTo")), "rank": rank})
            after = max(ids)
            if len(ids) < 1000:
                break
        items.sort(key=lambda item: (item["rank"], int(item["id"])))
        return items

    def detail(self, case_id):
        items = self.client.read_work_items([case_id])
        item = next((item for item in items if int(item["id"]) == case_id), None)
        if not item or item.get("fields", {}).get("System.WorkItemType") != "Test Case":
            raise LookupError("Test Case not found in the connected project.")
        fields = item["fields"]
        # Work item IDs are organization-wide; do not expose another project's case.
        if fields.get("System.TeamProject", "").casefold() != unquote(self.client.config.ado_project).casefold():
            raise LookupError("Test Case not found in the connected project.")
        names = {}
        metadata_warning = ""
        try:
            response = requests.get(f"{self.client.base_url}/_apis/wit/fields", headers=self.client.headers,
                                    params={"api-version": self.client.config.ado_api_version}, timeout=30,
                                    allow_redirects=False)
            response.raise_for_status()
            names = {entry["referenceName"]: entry["name"] for entry in response.json()["value"]}
        except (requests.RequestException, KeyError, TypeError, ValueError):
            metadata_warning = "Some field labels are derived from their reference names because ADO field labels could not be loaded."
        entries = [{"referenceName": key, "name": names.get(key) or re.sub(r"(?<=[a-z])(?=[A-Z])", " ", key.split(".")[-1]),
                    "value": value} for key, value in fields.items()]
        return {"id": case_id, "title": fields.get("System.Title", ""), "fields": entries,
                "steps": parse_steps(fields.get("Microsoft.VSTS.TCM.Steps", "")),
                "url": f"{self.client.base_url}/_workitems/edit/{case_id}", "warning": metadata_warning}

    def history(self, case_id, skip=0, page_size=50):
        # Query actual results, including manual runs, rather than current point status.
        # No date window: older retained executions remain reachable with Load more.
        data = self._post("testresults/results/query", {
            "query": f"SELECT * FROM TestResult WHERE TestCaseId = {case_id} ORDER BY DateCompleted DESC, TestRunId DESC, TestResultId DESC"
        }, {"$skip": skip, "$top": page_size + 1, "includeResultDetails": "true"}, results_host=True)
        values = data if isinstance(data, list) else data.get("value")
        if not isinstance(values, list):
            raise ValueError("Invalid Azure DevOps history response.")
        rows = []
        for result in values[:page_size]:
            if str((result.get("testCase") or {}).get("id")) != str(case_id):
                raise ValueError("Unexpected test case in execution history.")
            rows.append({"resultId": result.get("id"), "runId": (result.get("testRun") or {}).get("id"),
                         "testSuite": reference_label(result.get("testSuite")),
                         "testPlan": reference_label(result.get("testPlan")),
                         "result": result.get("outcome") or "Unspecified",
                         "loggedDate": result.get("completedDate") or result.get("lastUpdatedDate") or result.get("createdDate") or "",
                         "tester": display_value(result.get("runBy"))})
        return {"history": rows, "nextSkip": skip + page_size if len(values) > page_size else None}


def display_value(value):
    if isinstance(value, dict):
        return str(value.get("displayName") or value.get("uniqueName") or value.get("name") or "")
    return "" if value is None else str(value)


def reference_label(value):
    value = value or {}
    name, identifier = value.get("name"), value.get("id")
    return f"{name} ({identifier})" if name and identifier else str(name or identifier or "Not recorded")


def parse_steps(xml):
    if not xml:
        return []
    try:
        root = ElementTree.fromstring(xml)
        steps = []
        for child in root:
            if child.tag == "step":
                parts = child.findall("parameterizedString")
                steps.append({"action": parts[0].text or "" if parts else "", "expected": parts[1].text or "" if len(parts) > 1 else ""})
            elif child.tag == "compref":
                steps.append({"action": f"Shared steps: #{child.get('ref', '')} (open in ADO to view)", "expected": ""})
        return steps
    except ElementTree.ParseError:
        return [{"action": "Steps could not be parsed. Open this test case in ADO to view them.", "expected": ""}]
