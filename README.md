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
├── frontend/
├── launcher/
│   ├── Start-Windows.vbs
│   ├── Start-Unix.command
│   └── Start-Linux.sh
├── docs/
├── tests/
├── start_app.py
├── .gitignore
└── README.md
```

## One-click start — one launcher per platform

There are now exactly **three user-facing launchers**: one for Windows, one for
macOS/Unix, and one for Linux. All three do the same job:

```text
one click -> ensure Python environment -> start/reuse detached backend
          -> wait for /api/health -> open localhost -> launcher exits
```

The backend keeps running after the launcher exits. If it is already running,
using the launcher again simply opens the existing localhost app instead of
starting a duplicate process.

### Windows

Double-click:

```text
launcher/Start-Windows.vbs
```

This launcher calls Python directly and **does not go through a BAT file**.
It prefers `pythonw.exe`, so Command Prompt / Windows Terminal should not appear.
First-run dependency installation is also launched with the Windows
`CREATE_NO_WINDOW` flag.

### macOS / Unix

Double-click:

```text
launcher/Start-Unix.command
```

It starts the same `start_app.py` bootstrapper and returns after the detached
backend is healthy and localhost has opened.

### Linux

Run:

```bash
./launcher/Start-Linux.sh
```

If executable permissions were removed while copying the repository, restore
them once:

```bash
chmod +x launcher/Start-Unix.command launcher/Start-Linux.sh
```

The configured host/port is respected; the default is
`http://127.0.0.1:5000`. Runtime state is stored under `.runtime/` and logs
are written to:

```text
logs/backend.log
logs/launcher.log
```

For troubleshooting or an explicit manual stop, the shared bootstrapper is still
available directly:

```text
python start_app.py --stop
```

## Quick Start

1. Create and activate a Python virtual environment.

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

2. Start the backend manually when debugging.

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
