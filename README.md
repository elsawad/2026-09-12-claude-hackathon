# Canopy Watch

Residents report tree hazards from a phone. The system verifies them against public city data, proposes a priority using HRM service standards, and city staff accept or override every item before it becomes action.

Built at the Claude Community Impact Lab, Halifax.

## Stack

- `frontend/` — Vite + React + TypeScript
- `server/` — Express + TypeScript API

## Quick start

```bash
make install
make dev-server    # http://localhost:3001
make dev-frontend  # http://localhost:5173
```

Run the two `dev-*` commands in separate terminals. The frontend proxies `/api` to the server.

## Make targets

| Target | What it does |
|---|---|
| `make install` | Install frontend and server deps |
| `make dev-frontend` | Start Vite on port 5173 |
| `make dev-server` | Start API on port 3001 |
| `make build` | Build both packages |
| `make clean` | Remove build output and `node_modules` |

Each package also has its own Makefile (`frontend/Makefile`, `server/Makefile`).
