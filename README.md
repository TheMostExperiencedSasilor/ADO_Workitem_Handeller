# ADO Work Item AI Assistant

A lightweight Python + HTML/CSS/JavaScript assistant for Azure DevOps work items and Test Plans, with local AI-assisted workflows and browser-based test planning/result handling.

## Core Features

- Read Azure DevOps test case details through Test Planner using a Personal Access Token (PAT).
- Work Items / Test Case supports ID/title search, one selected case, and Details, Automation, and execution History tabs.
- Show page shells for Objective, Post Development Bug, User Story, Feature, and Task under Work Items.
- Chat through GitHub Copilot using a session-only GitHub PAT, account-provided models, conversation history, and optional ADO work-item attachments.
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

The backend keeps running after the launcher exits. If it is already running with the current Python source, using the launcher again opens the existing localhost app. If its source has changed, the launcher restarts the exact app instance it previously recorded before opening the browser. The restart clears the session-only ADO PAT, so reconnect on Setup.

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

### Activate the AI Assistant

Python **3.11+** is required. Relaunch after pulling the changes; the launcher installs the pinned `github-copilot-sdk` dependency automatically. If an existing `backend/.venv` uses Python 3.10, recreate it with Python 3.11+ before relaunching.

1. In **Setup → AI Assistant · GitHub Copilot**, enter a fine-grained GitHub PAT with **Copilot Requests** permission. The account needs Copilot access; classic PATs are not supported. This is separate from the ADO PAT.
2. Click **Connect to Copilot**. The first connection automatically downloads the SDK's pinned runtime; allow network access to GitHub releases. A progress indicator stays visible while connecting. No separate Copilot CLI or Node.js installation is needed for this SDK runtime.
3. Open the floating **AI** button. Choose a model returned by your account. A Luna model is selected initially when available; otherwise the first available model is selected.
4. Ask a question, or enter up to 20 comma/space-separated work-item IDs to attach their current ADO fields. Attachments require an active ADO connection. Only explicitly attached items are sent to Copilot.
5. Continue with follow-up questions. The last 20 messages are retained in browser memory, and **New chat** clears the conversation and attachments. A browser refresh clears the conversation. **Disconnect AI** removes the backend's PAT; terminating the backend also removes it.

The assistant analyzes and drafts content for review. It has no shell, file, or ADO write tools. Copilot requests use your account's model access and usage allowance. The retired GitHub Models inference endpoint and old `AI_*` / `GITHUB_TOKEN` settings are no longer used by the assistant; remove legacy credentials from `.env` if present.

Authentication reference: [Copilot SDK authentication](https://github.com/github/copilot-sdk/blob/main/docs/auth/authenticate.md).

Non-secret ADO settings may still be configured in `backend/.env`:

```env
ADO_ORGANIZATION=your-org
ADO_PROJECT=your-project
```

## Security Rule

Never put credentials in frontend source, browser storage, JSON exports, or logs. Both the ADO PAT and the Copilot PAT entered on Setup are kept in backend process memory only. Status endpoints never return them; password fields clear after successful connection. This app is intended for a local, single-user machine.

## Test Case browser

Connect to ADO on Setup, then open **Work Items → Test Case**. Search is scoped to the connected project and `Test Case` work item type.

- **Exact match**: full ID or full title (ADO title matching is case-insensitive).
- **Flexible match by ID**: starting digits, ignoring spaces. `12 34` finds `1234`, `12345`, `123456`, etc.
- **Flexible match by title**: phrase at the start first, phrase elsewhere second, then words appearing separately in the same order. `HYSYS MCP` ranks `HYSYS MCP cooler`, `Review HYSYS MCP cooler`, then `HYSYS cooler MCP validation`. Results are ranked before display pagination; IDs break ties.

Select one radio button to load a case. Details shows description, preconditions, action/expected steps, planning fields, and classification. Automation shows the fields recorded in the organization's process, with ADO field display names. Shared steps are identified by ID and can be opened through the case's **Open in ADO** link. This initial browser is read-only.

**History** loads execution results on demand using the Azure DevOps Test Results query API (`7.1-preview.2`), without an application date cutoff. It continues fetching older results in 50-row batches in the background. The table stays usable while results arrive, and the counts identify partial loading. Failed-result filters therefore reach older executions rather than stopping at the first batch. An interrupted load keeps existing rows and offers **Retry loading**; **Refresh history** starts again.

Columns are Test Suite, Test Plan, Result, Logged Date and time, and Tester. Plan/suite names are looked up from their recorded IDs. When the result omits its suite, the browser first tries the full result, then matches its exact execution point to ADO point metadata. It does not guess a historical suite from other current memberships. Where metadata was renamed, the current ADO name is shown. Deleted/unresolvable associations display **Not recorded**; known IDs with inaccessible names display **Name unavailable (ID)** and a warning. Tester is the result's actual `runBy` identity. Logged time uses completion time, then last-updated time, then creation time, displayed in the browser's local timezone. ADO retention and PAT permissions determine which results remain accessible.

All History controls are beneath the table: suite/plan name-or-ID filters, Result (including **Failed**), tester, inclusive local From/To dates, Clear filters, Refresh, and page navigation. Choose **10, 20, or 30** rows per page (default 20), use First/Previous/Next/Last, or enter a page number. Filters combine and apply before display pagination; changing them resets to page one. Matching/loaded counts remain visible during background loading. Animated indeterminate progress bars cover search, detail loading, and History, with a static indicator for reduced-motion preferences.

Click **Logged Date and time** in the History header to open the mini-calendar. The first date click sets the start, the second sets the inclusive end, and a third starts a new range. Earlier second dates are ordered chronologically. Selected endpoints and dates between them are highlighted. Month/year navigation, arrow/Page Up/Page Down keys, Escape, and Clear dates are supported; the calendar stays synchronized with the footer From/To filters.

Search/details need Work Items read access. History also needs Test Management access; the documented preview query endpoint lists the `vso.test_write` scope. A denied or unavailable history endpoint displays an error with retry; it is not presented as an empty history. No ADO work items or results are changed.

Focused checks: `python -m pytest -q tests/test_test_case_browser.py` and `node --test tests/test_test_case_browser_frontend.cjs`. API tests use mocked ADO responses; validate the preview history endpoint with a connected organization before relying on its production history.

### Recovering from a Test Case search 405 after an update

An older backend can keep running after a Git update while serving the new frontend files from disk. Its old route table does not include the Test Case search API. This causes `405 Method Not Allowed` (wrapped as a 500 by older backend versions). A browser refresh does not reload Python code.

For the first upgrade from that older launcher, stop the detached backend from the app folder:

```powershell
.\backend\.venv\Scripts\python.exe .\start_app.py --stop
```

Then double-click `launcher/ADOWorkItemLauncher.exe` and reconnect to ADO on Setup. On macOS/Linux, use `backend/.venv/bin/python start_app.py --stop`, then launch normally.

Subsequent launches compare the running backend's startup source fingerprint with the local Python source. A changed, launcher-owned instance is restarted automatically. A legacy instance or one whose PID/instance marker does not match is left running and the launcher logs manual restart instructions. Application responses are not cached, and Test Case request method errors explain the required restart.

### Healthy backend followed by a launcher timeout on Windows

If `backend.log` says `Backend ready` and shows successful health checks, but the launcher times out, the server may be running as a child of the Windows virtual-environment Python redirector. Those processes have different PIDs. Startup therefore matches the source revision and fresh launch marker, then records the actual serving PID reported by health. It does not require that PID to equal the redirector PID. Stop/restart uses the recorded serving PID.

The launcher logs both PIDs and logs revision/launch-marker match results when a healthy server is rejected, so a startup identity failure can be distinguished from a backend that never started.
