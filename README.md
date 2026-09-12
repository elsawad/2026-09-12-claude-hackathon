# Canopy Watch

Residents report tree hazards from a phone. The system verifies them against public city data, proposes a priority using HRM service standards, and city staff accept or override every item before it becomes action.

Built at the Claude Community Impact Lab, Halifax.

## Stack

- `frontend/` — Vite + React + TypeScript (one website: report home + land check map)
- `server/` — Express + TypeScript API
- `land-check/` — FastAPI endpoints for HRM parcel / Cityworks geometry checks

## Quick start

```bash
make install
make dev-server    # http://localhost:3001
make dev-land      # http://localhost:8765  (loads geojson; first start is slow)
make dev-frontend  # http://localhost:5173  ← open this
```

Run the three `dev-*` commands in separate terminals. Open **http://localhost:5173** — Report and Land check share that site. The frontend proxies `/api/health` to Express and the land endpoints to FastAPI.

## Make targets

| Target | What it does |
|---|---|
| `make install` | Install frontend, server, and land-check (`.venv`) deps |
| `make dev-frontend` | Start Vite on port 5173 |
| `make dev-server` | Start Express API on port 3001 |
| `make dev-land` | Start land-check API on port 8765 |
| `make build` | Build frontend and server |
| `make clean` | Remove build output, `node_modules`, and `.venv` |

Each Node package also has its own Makefile (`frontend/Makefile`, `server/Makefile`).
