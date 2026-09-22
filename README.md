# ADO Work Item AI Assistant

A lightweight Python + HTML/CSS/JavaScript assistant for Azure DevOps work items and Test Plans, with local AI-assisted workflows and browser-based test planning/result handling.

## Core Features

- Read Azure DevOps work items by ID using a Personal Access Token (PAT).
- Supports work item workflows for Objective, Bug, Post Development Bug, User Story, Feature, Task, and Test Case.
- Analyze work item content through a backend AI service using a GitHub token or another OpenAI-compatible AI endpoint.
- Create or edit Azure DevOps work items such as Task, User Story, and Feature.
- Apply writing rules such as SMART checks and splitting one large item into smaller work items.
- Test Results workspace with Summary, Test Planner, Result Tracker, and Charts.
- Test Planner can select ADO test cases and generate Visual Studio UFT `.playlist` files directly in the web app.
- Result Tracker supports editable result grids, JSON save/open, Excel export, ADO Test Run publishing, and optional OTE workbook transfer.
- Includes a floating AI chatbox in the frontend.
- Includes a local Setup page for Azure DevOps connection settings.
- Shows live ADO connection state and a glowing local app running/stopped indicator.
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

The former standalone `UFT_Playlist_Generator-main` PowerShell/WinForms utility has been removed. Playlist generation is now part of the Test Planner page, so there is no second implementation or separate executable/build path to maintain.

## One-click start — one launcher per platform

There are exactly **three user-facing launchers**: one for Windows, one for macOS/Unix, and one for Linux. All three do the same job:

```text
one click -> ensure Python environment -> start/reuse detached backend
          -> wait for /api/health -> open localhost -> launcher exits
```

The backend keeps running after the launcher exits. If it is already running, using the launcher again simply opens the existing localhost app instead of starting a duplicate process.

### Windows

Double-click:

```text
launcher/Start-Windows.vbs
```

This launcher calls Python directly and **does not go through a BAT file**. It prefers `pythonw.exe`, so Command Prompt / Windows Terminal should not appear. First-run dependency installation is also launched with the Windows `CREATE_NO_WINDOW` flag.

### macOS / Unix

Double-click:

```text
launcher/Start-Unix.command
```

It starts the same `start_app.py` bootstrapper and returns after the detached backend is healthy and localhost has opened.

### Linux

Run:

```bash
./launcher/Start-Linux.sh
```

If executable permissions were removed while copying the repository, restore them once:

```bash
chmod +x launcher/Start-Unix.command launcher/Start-Linux.sh
```

The configured host/port is respected; the default is `http://127.0.0.1:5000`. Runtime state is stored under `.runtime/` and logs are written to:

```text
logs/backend.log
logs/launcher.log
```

For troubleshooting or an explicit manual stop, the shared bootstrapper is available directly:

```text
python start_app.py --stop
```

## Manual / Debug Start

The launchers are the normal way to use the app. For backend debugging, you can still run it manually.

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python app.py
```

Then open:

```text
http://localhost:5000
```

## Setup

Use the Setup page to configure the Azure DevOps connection:

```text
ADO organization   (defaults to aspentechnology)
ADO project        (defaults to AspenTech SAF)
ADO PAT
```

The Setup page saves values into `backend/.env`. The PAT field is cleared after saving and the token value is never returned to the frontend. `Test connection` checks the values currently entered on the page without saving them first; when the PAT field is blank, an already-saved PAT is reused for the test. If the backend can reach the configured ADO project, the header shows `ADO connected`.

AI settings remain backend environment configuration for now and are not exposed on the Setup page.

You can also create `.env` manually if preferred:

```powershell
Copy-Item .env.example .env
```

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
