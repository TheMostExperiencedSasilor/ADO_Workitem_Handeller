# Security

## Token Handling

The ADO PAT and Copilot PAT entered in Setup are session-only. They are kept in backend process memory, never written to `.env`, browser storage, JSON exports, or logs, and never returned by status endpoints. Password inputs clear after successful connection. Disconnecting AI removes its in-memory credential; stopping the backend removes both credentials.

Only non-secret ADO organization/project settings are persisted. Legacy `ADO_PAT` entries are removed at startup. Legacy AI environment settings are no longer used; remove any old `GITHUB_TOKEN` from local `.env` files.

## Setup Section

The browser sends entered credentials to the local Flask backend. This is a local single-user app with process-wide connections, like the existing ADO session. Do not expose its setup/chat APIs publicly. A browser refresh clears the conversation but leaves the running backend's connection available until disconnect/termination.

The Copilot runtime uses a temporary base/working directory, disables config discovery, skills, session storage, and built-in tools, rejects permission requests, and deletes its temporary session after a turn. Only explicitly attached work-item fields are sent to Copilot, alongside the question and bounded conversation transcript. ADO credentials are not included in prompts.

## Why Backend-Only Tokens Matter

A browser app exposes its JavaScript and network calls to the user. If a PAT is placed in frontend code, anyone who opens the app can copy it. The backend acts as the trusted boundary and uses the tokens server-side.

## Recommended ADO PAT Scope

Use the smallest possible PAT scope for your current task:

- Read-only while testing `read` and `analyze`.
- Work item read/write only when testing create and update.

Avoid broad organization or project administration scopes.

## Transfer to Company Repo

Before transferring to a company repository:

- Delete local `.env` files.
- Confirm no real PAT or token was committed.
- Review commit history if any secret was ever accidentally committed.
- Disable or protect the setup endpoint if the app will run anywhere other than your own machine.
- Let the company GitHub administrator approve required app permissions.
