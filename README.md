# ADO Work Item AI Assistant

A lightweight Python + HTML/CSS/JavaScript assistant for reading Azure DevOps work items, analyzing them with an AI backend, and creating or editing new ADO work items with writing rules.

## Core Features

- Read Azure DevOps work items by ID using a Personal Access Token (PAT).
- Supports input work item types such as Objective, Bug, Post Development Bug, User Story, Feature, and Epic.
- Analyze work item content through a backend AI service using a GitHub token or another OpenAI-compatible AI endpoint.
- Create or edit Azure DevOps work items such as Task, User Story, and Feature.
- Generate new work independently or from analyzed source work items.
- Apply writing rules such as SMART checks and splitting one large item into three smaller items.
- Includes ADO-style work item type tabs for Feature, Objective, Post Development Bug, Task, Test Case, and User Story page shells.
- Includes a floating AI chatbox in the frontend.
- Includes a local setup section for entering ADO and AI settings.
- Shows an `ADO connected` frontend notification after the backend verifies the saved ADO settings.
- Keeps all secrets in backend `.env` only. No PAT or GitHub token is exposed to frontend code.

## Project Structure

```text
ADO_Workitem_Handeller/
├── backend/
│   ├── app.py
│   ├── config.py
│   ├── requirements.txt
│   ├── .env.example
│   ├── routes/
│   │   ├── __init__.py
│   │   ├── chat_routes.py
│   │   ├── setup_routes.py
│   │   └── work_item_routes.py
│   ├── rules/
│   │   ├── __init__.py
│   │   └── writing_rules.py
│   └── services/
│       ├── __init__.py
│       ├── ado_client.py
│       ├── ai_client.py
│       └── work_item_builder.py
├── frontend/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── docs/
│   ├── architecture.md
│   ├── security.md
│   └── writing-rules.md
├── tests/
│   └── test_writing_rules.py
├── .gitignore
└── README.md
```

## One-click start (Windows)

Install Python 3.10 or newer once (enable **Add python.exe to PATH**), then
double-click **Start-App.bat** in the repository folder.

The launcher creates `backend/.venv`, installs dependencies on the first run
(and when `requirements.txt` changes), starts the app and opens your browser.
An internet connection is needed for dependency installation. Later launches
reuse the environment. No PowerShell activation or execution-policy changes are needed.

Enter your organization, project and PAT in the existing **Setup** section.
Saved settings are preserved. Keep the launcher window open; press **Ctrl+C**
to stop. If startup fails, the window stays open so you can read the error.
The launcher uses the configured host/port (default `http://127.0.0.1:5000`)
and runs without the debug reloader. The manual startup below remains available.

## Quick Start

1. Create and activate a Python virtual environment.

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

2. Start the backend.

```powershell
python app.py
```

3. Open the app.

```text
http://localhost:5000
```

4. Use the Setup section in the page to enter:

```text
ADO organization
ADO project
ADO PAT
AI base URL
AI model
GitHub / AI token
```

The setup section saves values into `backend/.env`. Password fields are cleared after saving and token values are never returned to the frontend. If the backend can reach the configured ADO project, the header shows `ADO connected`.

## Work Item Page Tabs

The frontend includes page shells for:

- Feature
- Objective
- Post Development Bug
- Task
- Test Case
- User Story

These are placeholders for the next design pass. Selecting Feature, Task, or User Story also syncs the create/edit type selector.

## Manual Setup Alternative

You can still create `.env` yourself if preferred.

```powershell
Copy-Item .env.example .env
```

Then fill in `.env` with your ADO and AI settings.

```env
ADO_ORGANIZATION=your-org
ADO_PROJECT=your-project
ADO_PAT=your-ado-pat
AI_PROVIDER=github
AI_BASE_URL=https://models.github.ai/inference
AI_MODEL=openai/gpt-4.1-mini
GITHUB_TOKEN=your-github-token
```

## Security Rule

Never put `ADO_PAT`, `GITHUB_TOKEN`, or other secrets in frontend files. The frontend calls backend endpoints only. The backend reads secrets from `.env`.

## Current Status

This is an initial scaffold. The main architecture is in place, and the next step is to test against a real Azure DevOps project and tune the work item fields for your team's templates.
