"""Read Post Development Bugs and their existing Azure DevOps links."""

import re
from urllib.parse import quote, urlsplit

from services.test_case_browser import WorkItemBrowser, positive_id


LINK_FIELDS = "System.Title,System.State,System.ChangedDate,System.TeamProject"


class PostDevelopmentBugBrowser(WorkItemBrowser):
    work_item_type = "Post Development Bug"

    @staticmethod
    def _relations(item):
        return [relation for relation in item.get("relations") or [] if relation.get("rel") != "AttachedFile"]

    def detail(self, item_id):
        item = self._require_item(item_id)
        return {**self._detail_data(item), "linkCount": len(self._relations(item))}

    def links(self, item_id):
        relations = self._relations(self._require_item(item_id))
        organization = self.client.config.ado_organization
        targets = [work_item_target(relation.get("url"), organization) for relation in relations]
        ids = sorted({target for target in targets if target is not None})
        items = {}
        for start in range(0, len(ids), 200):
            page = ids[start:start + 200]
            result = self._get("wit/workitems", {
                "ids": ",".join(map(str, page)), "fields": LINK_FIELDS, "errorPolicy": "Omit",
            })
            items.update((item["id"], item["fields"]) for item in result["value"] if item.get("id") in page)

        links = []
        for relation, target in zip(relations, targets):
            attributes = relation.get("attributes") or {}
            kind = relation.get("rel") or "Link"
            fields = items.get(target, {})
            project = fields.get("System.TeamProject")
            base = f"https://dev.azure.com/{organization}"
            if project:
                base += f"/{quote(project, safe='')}"
            url = f"{base}/_workitems/edit/{target}" if target is not None else web_url(relation.get("url"))
            # If ADO omitted a restricted or deleted item, keep the relation and its ID.
            links.append({
                "type": kind, "name": attributes.get("name"), "id": target, "url": url,
                "title": fields.get("System.Title"), "state": fields.get("System.State"),
                "changedAt": fields.get("System.ChangedDate"), "comment": attributes.get("comment"),
            })
        return {"links": links}


def web_url(value):
    if not isinstance(value, str) or any(char.isspace() or char == "\\" for char in value):
        return None
    try:
        parsed = urlsplit(value)
        if parsed.scheme == "https" and parsed.hostname and parsed.username is None and parsed.password is None:
            return value
    except ValueError:
        pass
    return None


def work_item_target(value, organization):
    if not web_url(value):
        return None
    parsed = urlsplit(value)
    path = parsed.path
    if parsed.hostname == "dev.azure.com":
        prefix = f"/{organization}/"
        if not path.casefold().startswith(prefix.casefold()):
            return None
        path = path[len(prefix) - 1:]
    elif parsed.hostname != f"{organization.casefold()}.visualstudio.com":
        return None
    match = re.fullmatch(r"(?:/[^/]+)?/(?:_apis/wit/workitems|_workitems/edit)/(\d+)/?", path, re.IGNORECASE)
    try:
        return positive_id(match[1]) if match else None
    except ValueError:
        return None
