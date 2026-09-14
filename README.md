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
│   └── .env.example
├── frontend/
│   ├── index.html
│   ├── styles.css
│   └── app.js
├── launcher/
│   ├── Start-App.vbs
│   ├── Start-App.bat
│   ├── Stop-App.vbs
│   ├── Stop-App.bat
│   ├── Start-App.sh
│   └── Start-App.command
├── docs/
├── tests/
├── start_app.py
├── .gitignore
└── README.md
```

## One-click start — Go Live style

Install Python 3.10 or newer once. The launcher uses the cross-platform
`start_app.py` bootstrapper, which creates `backend/.venv`, installs dependencies
on the first run (and when `requirements.txt` changes), starts the Flask backend
as a detached background process, waits until `/api/health` is ready, and opens
the configured localhost URL in your default browser.

Once the app is running, the launcher exits. There is no terminal window that
must remain open.

### Windows

For the normal no-console experience, double-click:

```text
launcher/Start-App.vbs
```

This behaves like a small **Go Live** button:

```text
one click -> start background backend -> wait for health -> open localhost
```

If the backend is already running, clicking `Start-App.vbs` again simply opens
the existing localhost app instead of starting a duplicate process.

To stop the background backend, double-click:

```text
launcher/Stop-App.vbs
```

`Start-App.bat` and `Stop-App.bat` remain available for troubleshooting from a
Command Prompt, but they are no longer required to stay open.

### macOS

Double-click:

```text
launcher/Start-App.command
```

You can also run the Unix launcher from Terminal:

```bash
./launcher/Start-App.sh
```

The bootstrapper returns after the detached backend is ready, so the shell is not
the lifetime owner of the web server.

### Linux / other Unix systems

Run:

```bash
./launcher/Start-App.sh
```

If executable permissions were removed while copying the files, restore them once:

```bash
chmod +x launcher/Start-App.sh launcher/Start-App.command
```

An internet connection is needed for dependency installation. Later launches reuse
the existing environment. Enter your organization, project and PAT in the existing
**Setup** section. Saved settings are preserved.

The launcher uses the configured host/port (default `http://127.0.0.1:5000`) and
runs without Flask's debug reloader. Runtime state is stored under `.runtime/` and
server/launcher diagnostics are written to:

```text
logs/backend.log
logs/launcher.log
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
