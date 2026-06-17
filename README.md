# ADO Work Item AI Assistant

A lightweight Python + HTML/CSS/JavaScript assistant for reading Azure DevOps work items, analyzing them with an AI backend, and creating or editing new ADO work items with writing rules.

## Core Features

- Read Azure DevOps work items by ID using a Personal Access Token (PAT).
- Supports input work item types such as Objective, Bug, Post Development Bug, User Story, Feature, and Epic.
- Analyze work item content through a backend AI service using a GitHub token or another OpenAI-compatible AI endpoint.
- Create or edit Azure DevOps work items such as Task, User Story, and Feature.
- Generate new work independently or from analyzed source work items.
- Apply writing rules such as SMART checks and splitting one large item into three smaller items.
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
