# Exam Scheduler API

A modular, highly scalable API designed to manage university exam scheduling and student enrollments. Powered by Django, PostgreSQL, Redis, Celery, and the Gurobi Optimization Engine (MILP).

## 🚀 Features
- **Course & Department Management:** Automatically generates departments, instructors, courses, and course sections via CSV upload (`CourseLoaderService`).
- **Dynamic Optimization Planning:** Scheduling units are automatically split by department (e.g., PHYSICS I for CS is planned independently from PHYSICS I for SE), ensuring realistic constraint management.
- **Asynchronous Solver:** Optimization runs are handled by Celery workers to prevent HTTP timeouts. Supporting long-running Gurobi jobs (from 5 mins to hours).
- **IIS Diagnostics:** If a schedule is "Infeasible," the system automatically performs an Irreducible Inconsistent Subsystem (IIS) analysis to tell you exactly which constraints are conflicting (e.g., "Not enough room capacity for Physics I").
- **Student Simulator:** Generates realistic, fully randomized student course enrollment plans to emulate a live university environment.
- **Departmental Views:** Dedicated endpoints to view results filtered and grouped by department.
- **Token Authentication:** All API endpoints are protected with DRF token authentication.
- **Rate Limiting:** The optimizer is capped at 3 concurrent runs per term (DB-based, no extra dependencies).
- **Exam Rooms in Database:** Room capacities are stored in the `Resource` model and loaded dynamically by the optimizer.

## 🛠 Technologies Used
- **Backend:** Django 6 / Django REST Framework
- **Optimization:** Gurobi MILP Engine (Academic WLS)
- **Background Tasks:** Celery + Redis
- **Database:** PostgreSQL
- **DevOps:** Docker & Docker Compose (Python 3.12)
- **API Docs:** Swagger (drf-spectacular)

## 📦 Installation & Setup

1. **Clone the repository:**
   ```bash
   git clone https://github.com/haticecam/exam-scheduler.git
   cd exam-scheduler
   ```

2. **Gurobi WLS License Setup:**
   *   Log in to [Gurobi User Portal](https://portal.gurobi.com/).
   *   Go to **Licenses > Web License Service (WLS)**.
   *   Click on your Active Academic WLS license and click **Download License**.
   *   Open the `gurobi.lic` file. You will need `WLSACCESSID`, `WLSSECRET`, and `LICENSEID`.

3. **Environment Configuration:**
   ```bash
   cp .env.example .env
   ```
   Edit `.env` and fill in your values:
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

4. **Run with Docker:**
   ```bash
   docker compose up -d --build
   ```

5. **Create your admin user and get your API token:**
   ```bash
   docker compose exec web python manage.py bootstrap_admin
   ```
   Copy the printed token — you will need it to authenticate all API requests.

6. **Seed exam rooms for your organization:**
   First get your organization's UUID from `GET /api/organizations/`, then:
   ```bash
   docker compose exec web python manage.py seed_rooms --org_id <your-org-uuid>
   ```

7. **Access Swagger UI:**
   Navigate to `http://localhost:8000/api/docs/`, click **Authorize**, and enter:
   ```
   Token <your-token-from-step-5>
   ```

## 💡 Usage Workflow

### 1. Data Ingestion
1.  **Organization:** `POST /api/organizations/`
2.  **Term:** `POST /api/terms/` (Status: Active)
3.  **Upload Catalog:** `POST /api/courses/upload/` (Upload your university CSV)
4.  **Enrollments:** `POST /api/students/` (Upload student-course mappings)
5.  **Seed Rooms:** `python manage.py seed_rooms --org_id <uuid>` (only needed once per organization)
6.  **Update Estimates (Demo Mode):** `POST /api/academic-units/update-estimates/` processes previous semesters to estimate cohort sizes.

### 2. Optimization
1.  **Run Solver:** `POST /api/optimize/run/`
    *   Parameters: `term_id`, `exam_days`, `slots_per_day`, `start_hour`, `hard_threshold`, `no_back_to_back`.
    *   Returns a `task_id` for tracking.
    *   Limited to **3 concurrent runs per term** — returns HTTP 429 if the limit is reached.
2.  **Monitor Progress:** Use `GET /api/optimize/history/` to see the status (PENDING, PROCESSING, OPTIMAL, INFEASIBLE).
3.  **View Results:**
    *   `GET /api/optimize/{id}/result/`: Full solution JSON.
    *   `GET /api/optimize/{id}/departments/`: List of departments in the solution.
    *   `GET /api/optimize/{id}/by-department/?dept=DEPT_NAME`: Filtered and grouped schedule for a specific department.

## 🔐 Authentication

All endpoints except `GET /api/status/` and `GET /api/docs/` require a token.

**Get a token:**
```bash
POST /api/auth/token/
{ "username": "admin", "password": "adminpass123" }
```

**Use it in every request:**
```
Authorization: Token <your-token>
```

To create additional users, use the Django admin at `http://localhost:8000/admin/`.

## 🐳 Docker Commands

| Situation | Command |
|---|---|
| Only Python code changed | `docker compose restart web` |
| `requirements.txt` changed | `docker compose up --build web` |
| Dockerfile / docker-compose.yml / migrations changed | `docker compose down && docker compose up --build` |
| Reset everything including the database ⚠️ | `docker compose down -v && docker compose up --build` |

> **Warning:** The `-v` flag removes the database volume. All data will be permanently lost. After a full reset, re-run `bootstrap_admin` and `seed_rooms`.

## 🔍 Diagnostics
If the solver status is `INFEASIBLE`, check the `result` endpoint. The `stats.diagnostics` field will contain:
- Conflicting constraint types (Capacity, Hard Conflicts, etc.)
- Specific recommendations on how to fix the model (e.g., "Increase exam_days to 7").

If the optimizer returns `"No active EXAM_ROOM resources found"`, run `seed_rooms` for your organization (see step 6 above).
