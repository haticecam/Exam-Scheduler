dev:
	docker compose up -d
	cd frontend && npm run dev

stop:
	docker compose down

logs:
	docker compose logs -f

build:
	docker compose up -d --build

reset:
	docker compose down -v && docker compose up -d --build

.PHONY: dev stop logs build reset
