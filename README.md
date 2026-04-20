# Exam Scheduler

A full-stack university exam scheduling system. The backend is a Django REST API powered by Gurobi MILP optimization, Celery, Redis, and PostgreSQL. The frontend is a Next.js 16 dashboard for managing courses, students, rooms, and running the optimizer.

## Stack

| Layer | Tech |
|---|---|
| Backend API | Django 6 / Django REST Framework |
| Optimization | Gurobi MILP Engine (Academic WLS) |
| Background Tasks | Celery + Redis |
| Database | PostgreSQL |
| Frontend | Next.js 16 / React 19 / Tailwind CSS |
| DevOps | Docker & Docker Compose |
| API Docs | Swagger (drf-spectacular) at `http://localhost:8000/api/docs/` |

## Quick Start

### 1. Clone the repository

```bash
git clone https://github.com/haticecam/exam-scheduler.git
cd exam-scheduler
```

### 2. Gurobi WLS License

- Log in to [Gurobi User Portal](https://portal.gurobi.com/)
- Go to **Licenses > Web License Service (WLS)**, download your academic license
- You will need `WLSACCESSID`, `WLSSECRET`, and `LICENSEID` for the next step

### 3. Environment Configuration

```bash
cp .env.example .env
```

Edit `.env`:

```env
SECRET_KEY=your-django-secret-key
DEBUG=False
ALLOWED_HOSTS=localhost,127.0.0.1
DATABASE_URL=postgresql://admin:adminpassword@db:5432/examscheduler
REDIS_URL=redis://redis:6379/0
GRB_WLSACCESSID=your_access_id
GRB_WLSSECRET=your_secret
GRB_LICENSEID=your_license_number
```

### 4. Install frontend dependencies

```bash
cd frontend && npm install && cd ..
```

### 5. Run everything

```bash
make dev
```

This starts the backend (Docker, detached) and the frontend dev server in one command.

- Frontend: `http://localhost:3000`
- Backend API: `http://localhost:8000`
- Swagger UI: `http://localhost:8000/api/docs/`

### 6. Bootstrap admin user

```bash
docker compose exec web python manage.py bootstrap_admin
```

Copy the printed token — you need it to authenticate API requests.

### 7. Seed exam rooms

```bash
docker compose exec web python manage.py seed_rooms --org_id <your-org-uuid>
```

Get your org UUID from `GET /api/organizations/` first.

## Make Commands

| Command | What it does |
|---|---|
| `make dev` | Start backend (detached) + frontend dev server |
| `make stop` | Stop all backend containers |
| `make logs` | Tail backend container logs |
| `make build` | Rebuild and start backend containers |
| `make reset` | Destroy volumes and rebuild (⚠️ deletes all data) |

## Docker Commands

| Situation | Command |
|---|---|
| Only Python code changed | `docker compose restart web` |
| `requirements.txt` changed | `docker compose up --build web` |
| Dockerfile / docker-compose.yml / migrations changed | `docker compose down && docker compose up --build` |
| Reset everything including the database ⚠️ | `docker compose down -v && docker compose up --build` |

> **Warning:** The `-v` flag removes the database volume. All data will be permanently lost. Re-run `bootstrap_admin` and `seed_rooms` after a full reset.

## Authentication

All endpoints except `GET /api/status/` and `GET /api/docs/` require a token.

```bash
POST /api/auth/token/
{ "username": "admin", "password": "adminpass123" }
```

Use in every request:
```
Authorization: Token <your-token>
```

To create additional users, use the Django admin at `http://localhost:8000/admin/`.

## Usage Workflow

### 1. Data Ingestion

1. **Organization:** `POST /api/organizations/`
2. **Term:** `POST /api/terms/` (Status: Active)
3. **Upload Catalog:** `POST /api/courses/upload/` (university CSV)
4. **Enrollments:** `POST /api/students/` (student-course mappings)
5. **Seed Rooms:** `python manage.py seed_rooms --org_id <uuid>` (once per org)
6. **Update Estimates:** `POST /api/academic-units/update-estimates/`

### 2. Optimization

1. **Run Solver:** `POST /api/optimize/run/`
   - Parameters: `term_id`, `exam_days`, `slots_per_day`, `start_hour`, `hard_threshold`, `no_back_to_back`
   - Returns a `task_id`. Limited to **3 concurrent runs per term** (HTTP 429 if exceeded)
2. **Monitor Progress:** `GET /api/optimize/history/` — statuses: PENDING, PROCESSING, OPTIMAL, INFEASIBLE
3. **View Results:**
   - `GET /api/optimize/{id}/result/` — full solution JSON
   - `GET /api/optimize/{id}/departments/` — list of departments
   - `GET /api/optimize/{id}/by-department/?dept=DEPT_NAME` — filtered schedule

## Diagnostics

If the solver returns `INFEASIBLE`, check `result.stats.diagnostics` — it lists conflicting constraint types and specific fix recommendations (e.g., "Increase exam_days to 7").

If you see `"No active EXAM_ROOM resources found"`, run `seed_rooms` for your organization.
