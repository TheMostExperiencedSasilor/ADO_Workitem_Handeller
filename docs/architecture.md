# Architecture

## Overview

The app has two clear layers:

- Frontend: plain HTML, CSS, and JavaScript.
- Backend: Python Flask API.

The frontend never talks directly to Azure DevOps or the AI provider. It only calls local backend endpoints.

## Request Flow

```text
Browser UI
  -> Flask API
    -> backend/.env for local setup values
    -> Azure DevOps REST API
    -> AI chat/completions endpoint
```

## Backend Modules

- `app.py`: Flask app factory, route registration, frontend hosting.
- `config.py`: environment variable loading and validation.
- `services/ado_client.py`: Azure DevOps REST API reads, test run updates, and connection checks.
- `services/ai_client.py`: AI chat calls.
- `routes/setup_routes.py`: local setup status, `.env` writing, and ADO connection status endpoints.
- `routes/work_item_routes.py`: work item read endpoint used by Test Planner.
- `routes/chat_routes.py`: floating chatbox endpoint.

## API Endpoints

- `GET /api/health`
- `GET /api/setup/status`
- `GET /api/setup/ado-connection`
- `POST /api/setup`
- `POST /api/work-items/read`
- `POST /api/chat`

## Work Item Types

The Work Items section currently contains informational page shells for several work item types. Test Planner continues to read test case titles by ID through the shared work-item read endpoint.
