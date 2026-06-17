# Security

## Token Handling

Secrets must stay in `backend/.env` only:

- `ADO_PAT`
- `GITHUB_TOKEN`
- any future AI provider token

The frontend must never contain these values. Do not place secrets in:

- `frontend/index.html`
- `frontend/app.js`
- browser local storage
- query strings
- screenshots or logs

## Setup Section

The browser setup section is intended for local development. It sends the entered PAT/token to the backend over the local Flask API and the backend writes the values into `backend/.env`.

The setup status endpoint only returns whether values are configured. It does not return the real PAT or token.

After saving setup, the password fields are cleared in the browser.

Do not expose this app publicly while the setup endpoint is enabled.

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
