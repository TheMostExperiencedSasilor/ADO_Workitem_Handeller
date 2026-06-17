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
    -> Azure DevOps REST API
    -> AI chat/completions endpoint
```

## Backend Modules

- `app.py`: Flask app factory, route registration, frontend hosting.
- `config.py`: environment variable loading and validation.
- `services/ado_client.py`: Azure DevOps REST API read/create/update operations.
- `services/ai_client.py`: AI analysis, drafting, and chat calls.
- `services/work_item_builder.py`: validates write payloads and prepares ADO fields.
- `rules/writing_rules.py`: deterministic SMART and split rules.
- `routes/work_item_routes.py`: work item read/analyze/draft/create/update endpoints.
- `routes/chat_routes.py`: floating chatbox endpoint.

## API Endpoints

- `GET /api/health`
- `POST /api/work-items/read`
- `POST /api/work-items/analyze`
- `POST /api/work-items/draft`
- `POST /api/work-items/create`
- `PATCH /api/work-items/<id>`
- `POST /api/chat`

## Work Item Types

Input analysis can handle any work item returned by ADO, including Objective, Bug, Post Development Bug, User Story, Feature, and Epic.

Creation is intentionally limited to:

- Task
- User Story
- Feature

This keeps the first version safer and avoids accidentally creating unsupported process-specific types.
