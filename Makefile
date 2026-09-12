.PHONY: help install install-frontend install-server \
	dev dev-frontend dev-server \
	build build-frontend build-server \
	clean clean-frontend clean-server

help:
	@echo "Canopy Watch"
	@echo ""
	@echo "  make install          Install frontend and server dependencies"
	@echo "  make install-frontend Install frontend only"
	@echo "  make install-server   Install server only"
	@echo "  make dev-frontend     Run Vite frontend (port 5173)"
	@echo "  make dev-server       Run API server (port 3001)"
	@echo "  make build            Build frontend and server"
	@echo "  make clean            Remove build artifacts and node_modules"

install: install-frontend install-server

install-frontend:
	$(MAKE) -C frontend install

install-server:
	$(MAKE) -C server install

dev-frontend:
	$(MAKE) -C frontend dev

dev-server:
	$(MAKE) -C server dev

build: build-frontend build-server

build-frontend:
	$(MAKE) -C frontend build

build-server:
	$(MAKE) -C server build

clean: clean-frontend clean-server

clean-frontend:
	$(MAKE) -C frontend clean

clean-server:
	$(MAKE) -C server clean
