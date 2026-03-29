# Exam Scheduler API

A modular, highly scalable API designed to manage university exam scheduling and student enrollments. Powered by Django, PostgreSQL, Redis, Celery, and the Gurobi Optimization Engine.

## Features
- **Course & Department Management:** Automatically generates departments, instructors, courses, and course sections via CSV upload (`CourseLoaderService`).
- **Data Extrapolation:** Estimates accurate academic unit demographics using historical data (`DemoUpdaterService`).
- **Student Simulator:** Generates realistic, fully randomized student course enrollment plans to emulate a live university environment (`StudentSimulatorService`).
- **Continuous Enrollments:** Upload batch realistic enrollments, instantly populating DB matrices (`EnrollmentLoaderService`).
- **Containerized Architecture:** Fully independent deployments built with `docker-compose`.

## Technologies Used
- **Backend:** Django 5 / Django REST Framework
- **Databases:** PostgreSQL (Primary DB), Redis (Broker/Cache)
- **Background Operations:** Celery
- **Optimization:** Gurobi MILP Engine
- **DevOps:** Docker

## Quickstart (Docker)

1. Clone the repository and enter the projected folder:
   ```bash
   git clone https://github.com/haticecam/exam-scheduler.git
   cd exam-scheduler
   ```

2. Generate your local environment file:
   ```bash
   cp .env.example .env
   ```
   *Edit `.env` to include your target `POSTGRES_PASSWORD` and `GRB_LICENSEID` inside.*

3. Build and bring up the containers:
   ```bash
   docker compose up -d --build
   ```

4. Follow along with container logs:
   ```bash
   docker compose logs -f
   ```

5. Access the API documentation (Swagger) via:
   ```
   http://localhost:8000/api/docs/
   ```

## Initial Setup & Endpoints

Once your server is running, use Swagger to populate the database sequentially:
1. **Create Organization:** `POST /api/organizations/`
2. **Create Term:** `POST /api/terms/` (using the generated Organization ID).
3. **Course Bulk Upload:** `POST /api/courses/upload/` providing a CSV string matching typical catalog output and binding it directly to the Term ID.
4. **Update Estimates (Demo Mode):** `POST /api/academic-units/update-estimates/` processes previous semesters to estimate cohort capabilities.
5. **Simulate (Demo Mode):** `POST /api/simulateStudents/` renders an ad-hoc `.csv` array simulating `n` enrolled students.
6. **Apply Enrollments:** `POST /api/students/` inputs real/simulated students to calculate course shared capacities.

You are now ready to execute the Optimizer logic!

