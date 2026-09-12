.PHONY: help install install-frontend install-server install-land \
	dev-frontend dev-server dev-land \
	build build-frontend build-server \
	clean clean-frontend clean-server

help:
	@echo "Canopy Watch"
	@echo ""
	@echo "  make install          Install frontend, server, and land-check deps"
	@echo "  make install-frontend Install frontend only"
	@echo "  make install-server   Install server only"
	@echo "  make install-land     Create .venv and install land-check Python deps"
	@echo "  make dev-frontend     Run Vite frontend (port 5173) — the website"
	@echo "  make dev-server       Run Express API (port 3001)"
	@echo "  make dev-land         Run land-check FastAPI (port 8765)"
	@echo "  make build            Build frontend and server"
	@echo "  make clean            Remove build artifacts and node_modules"

install: install-frontend install-server install-land

install-frontend:
	$(MAKE) -C frontend install

install-server:
	$(MAKE) -C server install

install-land:
	python3 -m venv .venv
	.venv/bin/pip install -r land-check/requirements.txt

dev-frontend:
	$(MAKE) -C frontend dev

dev-server:
	$(MAKE) -C server dev

dev-land:
	.venv/bin/uvicorn server:app --app-dir land-check --reload --reload-dir land-check --host 127.0.0.1 --port 8765

build: build-frontend build-server

build-frontend:
	$(MAKE) -C frontend build

build-server:
	$(MAKE) -C server build

clean: clean-frontend clean-server
	rm -rf .venv

clean-frontend:
	$(MAKE) -C frontend clean

clean-server:
	$(MAKE) -C server clean
