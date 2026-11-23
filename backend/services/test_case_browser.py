"""Read-only Test Case search and history against Azure DevOps."""
import re
from html import escape
from urllib.parse import unquote, urlparse
from xml.etree import ElementTree

import requests

__test__ = False  # Service module, not a pytest test module.


MAX_ID = 2147483647
STEPS_FIELD = "Microsoft.VSTS.TCM.Steps"
UPDATE_METADATA = {
    "System.Rev", "System.Watermark", "System.AuthorizedAs", "System.AuthorizedDate",
    "System.RevisedDate", "System.ChangedDate", "System.ChangedBy",
}


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

    def _get(self, path, params=None):
        response = requests.get(f"{self.client.base_url}/_apis/{path}", headers=self.client.headers,
                                params={"api-version": self.client.config.ado_api_version, **(params or {})},
                                timeout=30, allow_redirects=False)
        response.raise_for_status()
        data = response.json()
        if response.status_code != 200 or not isinstance(data, dict):
            raise ValueError("Invalid Azure DevOps metadata response.")
        return data

    def _case_point_contexts(self, case_id):
        """Match executions to exact points; never guess from case membership."""
        contexts, skip = [], 0
        while True:
            data = self._post("test/points", {"pointsFilter": {"testcaseIds": [case_id]}},
                              {"$skip": skip, "$top": 1000})
            points = data.get("points")
            if not isinstance(points, list):
                raise ValueError("Invalid Azure DevOps point response.")
            for point in points:
                if str((point.get("testCase") or {}).get("id")) != str(case_id):
                    continue
                plan, suite = dict(point.get("testPlan") or {}), dict(point.get("suite") or {})
                # Some ADO versions only put the plan/suite IDs in the point URL.
                # Extract IDs only; never send a PAT to a URL supplied by ADO.
                match = re.search(r"/_apis/test/Plans/([0-9]+)/Suites/([0-9]+)/Points/([0-9]+)/?$",
                                  urlparse(point.get("url") or "").path, re.IGNORECASE)
                if match and str(point.get("id")) == match[3]:
                    plan.setdefault("id", match[1])
                    suite.setdefault("id", match[2])
                contexts.append((str(point.get("id")), plan, suite))
            if len(points) < 1000:
                return contexts
            skip += len(points)

    def _history_references(self, case_id, results):
        """Enrich recorded IDs and point links, with request-local lookup caches."""
        contexts, plans, suites, warnings = None, {}, {}, set()
        references = []
        for result in results:
            plan, suite = dict(result.get("testPlan") or {}), dict(result.get("testSuite") or {})
            point_id = reference_id(result.get("testPoint"))
            # A full result can contain point/suite references omitted by the query.
            if reference_id(plan) and not reference_id(suite) and not suite.get("name") and not point_id:
                run_id, result_id = reference_id(result.get("testRun")), reference_id({"id": result.get("id")})
                if run_id and result_id:
                    try:
                        detail = self._get(f"test/Runs/{run_id}/results/{result_id}")
                        if str((detail.get("testCase") or {}).get("id")) == str(case_id):
                            suite = dict(detail.get("testSuite") or suite)
                            point_id = reference_id(detail.get("testPoint"))
                    except (requests.RequestException, ValueError, TypeError):
                        warnings.add("Some execution context could not be resolved from ADO.")
            if point_id and (not reference_id(plan) or (not reference_id(suite) and not suite.get("name"))):
                if contexts is None:
                    try:
                        contexts = self._case_point_contexts(case_id)
                    except (requests.RequestException, ValueError, TypeError):
                        contexts = []
                        warnings.add("Some execution context could not be resolved from ADO.")
                matches = [(p, s) for identifier, p, s in contexts if identifier == str(point_id)
                           and (not reference_id(plan) or reference_id(plan) == reference_id(p))
                           and (not reference_id(suite) or reference_id(suite) == reference_id(s))]
                if len(matches) == 1:
                    matched_plan, matched_suite = matches[0]
                    plan = {**matched_plan, **{key: value for key, value in plan.items() if value}}
                    suite = {**matched_suite, **{key: value for key, value in suite.items() if value}}
            plan_id, suite_id = reference_id(plan), reference_id(suite)
            if plan_id and not plan.get("name"):
                if plan_id not in plans:
                    try:
                        plans[plan_id] = self._get(f"testplan/plans/{plan_id}").get("name")
                    except (requests.RequestException, ValueError, TypeError):
                        plans[plan_id] = None
                if plans[plan_id]:
                    plan["name"] = plans[plan_id]
            if plan_id and suite_id and not suite.get("name"):
                key = (plan_id, suite_id)
                if key not in suites:
                    try:
                        suites[key] = self._get(f"testplan/Plans/{plan_id}/suites/{suite_id}").get("name")
                    except (requests.RequestException, ValueError, TypeError):
                        suites[key] = None
                if suites[key]:
                    suite["name"] = suites[key]
            for reference in (plan, suite):
                if reference_id(reference) and not reference.get("name"):
                    reference["name"] = "Name unavailable"
                    warnings.add("Some plan or suite names are unavailable or access is denied.")
            references.append((reference_label(plan), reference_label(suite)))
        return references, sorted(warnings)

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

    def _require_case(self, case_id):
        items = self.client.read_work_items([case_id])
        item = next((item for item in items if int(item["id"]) == case_id), None)
        if not item or item.get("fields", {}).get("System.WorkItemType") != "Test Case":
            raise LookupError("Test Case not found in the connected project.")
        fields = item["fields"]
        # Work item IDs are organization-wide; do not expose another project's case.
        if fields.get("System.TeamProject", "").casefold() != unquote(self.client.config.ado_project).casefold():
            raise LookupError("Test Case not found in the connected project.")
        return fields

    def detail(self, case_id):
        fields = self._require_case(case_id)
        metadata = {}
        metadata_warning = ""
        try:
            response = requests.get(f"{self.client.base_url}/_apis/wit/fields", headers=self.client.headers,
                                    params={"api-version": self.client.config.ado_api_version}, timeout=30,
                                    allow_redirects=False)
            response.raise_for_status()
            metadata = {entry["referenceName"]: entry for entry in response.json()["value"]}
        except (requests.RequestException, KeyError, TypeError, ValueError):
            metadata_warning = "Some field labels are derived from their reference names because ADO field labels could not be loaded."
        entries = []
        for key, value in fields.items():
            definition = metadata.get(key, {})
            entries.append({"referenceName": key, "name": definition.get("name") or field_label(key),
                            "type": definition.get("type"), "value": value})
        steps, steps_warning = self._detail_steps(fields.get(STEPS_FIELD, ""))
        return {"id": case_id, "title": fields.get("System.Title", ""), "fields": entries,
                "steps": steps, "stepsWarning": steps_warning,
                "url": f"{self.client.base_url}/_workitems/edit/{case_id}", "warning": metadata_warning}

    def _detail_steps(self, xml):
        shared_steps = {}
        incomplete = False

        def mark_incomplete():
            nonlocal incomplete
            incomplete = True

        def read_shared(reference):
            if reference not in shared_steps:
                try:
                    items = self.client.read_work_items([reference])
                except requests.RequestException:
                    items = []
                project = unquote(self.client.config.ado_project).casefold()
                for item in items:
                    fields = item.get("fields") or {}
                    if (str(item.get("id")) == str(reference) and fields.get("System.WorkItemType") == "Shared Steps"
                            and (fields.get("System.TeamProject") or "").casefold() == project):
                        shared_steps[reference] = fields.get(STEPS_FIELD, "")
                        break
                else:
                    shared_steps[reference] = ""
            return shared_steps[reference]

        rows = parse_steps(xml, read_shared, mark_incomplete)
        warning = "Some steps could not be loaded. Open the test case in ADO to review the missing steps." if incomplete else ""
        return rows, warning

    def modification_history(self, case_id):
        self._require_case(case_id)
        updates, seen = [], set()
        page_size = 100
        while True:
            data = self._get(f"wit/workItems/{case_id}/updates", {"$top": page_size, "$skip": len(updates)})
            page = data.get("value")
            if not isinstance(page, list):
                raise ValueError("Invalid Azure DevOps work item updates response.")
            for update in page:
                update_id = update.get("id")
                if str(update.get("workItemId")) != str(case_id) or type(update_id) is not int:
                    raise ValueError("Unexpected entry in Azure DevOps work item updates.")
                if update_id in seen:
                    raise ValueError("Azure DevOps work item updates did not advance.")
                seen.add(update_id)
                updates.append(describe_update(update))
            if len(page) < page_size:
                return {"updates": updates}

    def history(self, case_id, skip=0, page_size=50):
        # Query actual results, including manual runs, rather than current point status.
        # No date window: older retained executions remain reachable with Load more.
        data = self._post("testresults/results/query", {
            "query": f"SELECT * FROM TestResult WHERE TestCaseId = {case_id} ORDER BY DateCompleted DESC, TestRunId DESC, TestResultId DESC"
        }, {"$skip": skip, "$top": page_size + 1, "includeResultDetails": "true"}, results_host=True)
        values = data if isinstance(data, list) else data.get("value")
        if not isinstance(values, list):
            raise ValueError("Invalid Azure DevOps history response.")
        page = values[:page_size]
        for result in page:
            if str((result.get("testCase") or {}).get("id")) != str(case_id):
                raise ValueError("Unexpected test case in execution history.")
        references, warnings = self._history_references(case_id, page)
        rows = []
        for result, (plan, suite) in zip(page, references):
            rows.append({"resultId": result.get("id"), "runId": (result.get("testRun") or {}).get("id"),
                         "testSuite": suite, "testPlan": plan,
                         "result": result.get("outcome") or "Unspecified",
                         "loggedDate": result.get("completedDate") or result.get("lastUpdatedDate") or result.get("createdDate") or "",
                         "tester": display_value(result.get("runBy"))})
        return {"history": rows, "nextSkip": skip + page_size if len(values) > page_size else None,
                "warnings": warnings}


def field_label(reference_name):
    return re.sub(r"(?<=[a-z])(?=[A-Z])", " ", reference_name.split(".")[-1])


def describe_update(update):
    fields = update.get("fields") or {}
    revision = update.get("rev")
    created_date = fields.get("System.CreatedDate", {}).get("newValue")
    created = revision == 1 and (update["id"] == 1 or created_date)
    revised_date = update.get("revisedDate")
    # revisedDate can identify when ADO superseded a revision. It can also be a year-9999 sentinel.
    changed_date = (fields.get("System.ChangedDate", {}).get("newValue")
                    or (created_date if created else None)
                    or fields.get("System.AuthorizedDate", {}).get("newValue")
                    or (revised_date if revised_date and not revised_date.startswith("9999-") else None))
    author = fields.get("System.ChangedBy", {}).get("newValue") or update.get("revisedBy")
    author_id = (author.get("id") or author.get("uniqueName")) if isinstance(author, dict) else None
    changes = []
    for reference, delta in fields.items():
        if reference in UPDATE_METADATA or delta.get("oldValue") == delta.get("newValue"):
            continue
        if reference == STEPS_FIELD:
            steps = compare_steps(delta.get("oldValue"), delta.get("newValue"))
            changes.append({"field": reference, "label": "Test Steps", "steps": steps})
        else:
            changes.append({"field": reference, "label": field_label(reference),
                            "before": delta.get("oldValue"), "after": delta.get("newValue")})
    relations = []
    relation_changes = update.get("relations") or {}
    for operation in ("added", "removed", "updated"):
        for relation in relation_changes.get(operation) or []:
            attributes = relation.get("attributes") or {}
            relations.append({"operation": operation, "type": relation.get("rel"),
                              "name": attributes.get("name"), "target": relation.get("url"),
                              "comment": attributes.get("comment")})
    return {"id": update["id"], "revision": revision, "created": bool(created), "changedAt": changed_date,
            "author": display_value(author), "authorId": author_id, "fields": changes, "relations": relations}


def compare_steps(previous, current):
    def snapshot(xml):
        if xml is not None and not isinstance(xml, str):
            return None, False
        malformed = False

        def mark_malformed():
            nonlocal malformed
            malformed = True
        rows = parse_steps(xml, mark_incomplete=mark_malformed, include_identity=True)
        return (None if malformed else rows), any(row.get("shared") for row in rows)

    before, before_shared = snapshot(previous)
    after, after_shared = snapshot(current)
    note = "Shared step contents are available when included in the historical Test Steps field." if before_shared or after_shared else ""
    if before is None or after is None:
        return {"before": before, "after": after, "warning": "ADO returned unreadable Test Steps for at least one version."}

    old_keys = [row["key"] for row in before]
    new_keys = [row["key"] for row in after]
    if any(None in keys or len(set(keys)) != len(keys) for keys in (old_keys, new_keys)):
        return {"before": before, "after": after,
                "warning": "Some step IDs are missing or repeated. Showing both versions in their original order.", "note": note}

    old_rows, new_rows = dict(zip(old_keys, before)), dict(zip(new_keys, after))
    old_positions = {key: index for index, key in enumerate(key for key in old_keys if key in new_rows)}
    new_positions = {key: index for index, key in enumerate(key for key in new_keys if key in old_rows)}
    changes = []
    for key in new_keys + [key for key in old_keys if key not in new_rows]:
        old, new = old_rows.get(key), new_rows.get(key)
        moved = old is not None and new is not None and old_positions[key] != new_positions[key]
        if old is None or new is None or moved or any(old[cell] != new[cell] for cell in ("action", "expected")):
            changes.append({"before": old, "after": new, "moved": moved})
    return {"changes": changes, "note": note}


def display_value(value):
    if isinstance(value, dict):
        return str(value.get("displayName") or value.get("uniqueName") or value.get("name") or "")
    return "" if value is None else str(value)


def reference_label(value):
    value = value or {}
    name, identifier = value.get("name"), value.get("id")
    return f"{name} ({identifier})" if name and identifier else str(name or identifier or "Not recorded")


def reference_id(value):
    try:
        return positive_id((value or {}).get("id"))
    except (ValueError, AttributeError):
        return None


def _step_cell(part):
    if part.get("isformatted", "").lower() == "false":
        return escape("".join(part.itertext()), quote=False)
    if not len(part):
        return part.text or ""
    # ADO can store HTML as escaped text or as inline XML with tail text.
    return escape(part.text or "", quote=False) + "".join(
        ElementTree.tostring(child, encoding="unicode") for child in part
    )


def parse_steps(xml, read_shared=None, mark_incomplete=lambda: None, *, include_identity=False):
    if not xml:
        return []

    def parse_group(group, prefix="", active=(), depth=0, parent_key=()):
        def row_values(number, action, expected, key, shared=False):
            row = {"number": number, "action": action, "expected": expected}
            if include_identity:
                row.update(key=key, shared=shared)
            return row

        entries = [child for child in group if child.tag in ("step", "compref")]
        rows = []
        for index, child in enumerate(entries, 1):
            number = f"{prefix}{index}"
            step_id = child.get("id")
            key = (*parent_key, step_id) if parent_key is not None and step_id else None
            if child.tag == "step":
                parts = child.findall("parameterizedString")
                action, expected = ([_step_cell(part) for part in parts[:2]] + ["", ""])[:2]
                rows.append(row_values(number, action, expected, key))
                continue

            reference = child.get("ref", "")
            shared_key = (*parent_key, f"compref:{step_id}:{reference}") if key is not None else None
            resolved = []
            if depth < 12:
                # A reference can contain real steps or only the IDs used by the parent case.
                inline = any(part.tag == "compref" or part.find("parameterizedString") is not None
                             for part in child if part.tag in ("step", "compref"))
                if inline:
                    resolved = parse_group(child, f"{number}.", active, depth + 1, shared_key)
                elif read_shared:
                    try:
                        shared_id = positive_id(reference)
                        if shared_id not in active and (shared_xml := read_shared(shared_id)):
                            shared = ElementTree.fromstring(shared_xml)
                            if shared.tag == "steps":
                                resolved = parse_group(shared, f"{number}.", (*active, shared_id), depth + 1)
                    except (ValueError, ElementTree.ParseError):
                        pass
            if resolved:
                rows.extend(resolved)
            else:
                if not include_identity:
                    mark_incomplete()
                label = f" #{reference}" if re.fullmatch(r"[0-9]{1,10}", reference) else ""
                rows.append(row_values(number, f"Shared steps:{label} (open in ADO to view)", "", shared_key, shared=True))
        return rows

    try:
        if not re.search(r"<!DOCTYPE", xml, re.IGNORECASE):
            root = ElementTree.fromstring(xml)
            if root.tag == "steps":
                return parse_group(root)
    except ElementTree.ParseError:
        pass
    mark_incomplete()
    return [{"number": "1", "action": "Steps could not be parsed. Open this test case in ADO to view them.", "expected": ""}]
