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
- Keeps the ADO PAT in backend process memory only for the current app session. AI tokens remain backend-only. No secret is exposed to frontend code.

## Project Structure

```text
ADO_Workitem_Handeller/
├── backend/
├── frontend/
├── launcher/
│   ├── ADOWorkItemLauncher.exe
│   ├── Start-Windows.ps1       # editable source, not the user entry point
│   ├── build_launcher.ps1
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
launcher/ADOWorkItemLauncher.exe
```

The EXE is built from `Start-Windows.ps1` with ps2exe `-noConsole`. It uses
`pythonw.exe` (or `pyw.exe` on first run), waits for `start_app.py` to finish
setup and open the browser, and then closes automatically. The Flask backend is
detached and keeps running; no launcher console needs to stay open. Startup
errors are shown in a dialog and recorded in `logs/launcher.log`.

To rebuild the EXE on Windows after editing the PowerShell source, install
ps2exe and run `launcher/build_launcher.ps1`. GitHub Actions also rebuilds the
EXE when the launcher source or build script changes.

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
ADO project        (defaults to AspenTech SAFe)
ADO PAT
```

The PAT field is blank by default and the PAT is never returned to the frontend. `Connect to ADO` stays disabled until organization, project, and PAT are all filled. Clicking it persists only the non-secret organization/project settings, tests the connection, and keeps the PAT only in backend process memory for the current app session. While ADO is being checked, the header shows an animated `Connecting to ADO…` indicator; the connection request times out after 30 seconds. On success the header shows `ADO connected`, the PAT field is cleared, and the button becomes disabled again. After the backend process terminates, the PAT is gone; the next launch starts as `ADO not connected` and requires the PAT again. Legacy `ADO_PAT` entries are removed from `backend/.env` at backend startup.

AI settings remain backend environment configuration for now and are not exposed on the Setup page.

You can also create `.env` manually if preferred:

```powershell
Copy-Item .env.example .env
```

```env
ADO_ORGANIZATION=your-org
ADO_PROJECT=your-project
AI_PROVIDER=github
AI_BASE_URL=https://models.github.ai/inference
AI_MODEL=openai/gpt-4.1-mini
GITHUB_TOKEN=your-github-token
```

## Security Rule

Never put `ADO_PAT`, `GITHUB_TOKEN`, or other secrets in frontend files. The ADO PAT is session-only and must not be written to `.env`, JSON, browser storage, logs, or other persistent files. AI credentials remain backend environment configuration.
