# PKG Simulator Database Integration

This document explains how to set up and use the database connector for the PKG Simulator.

## Architecture

Since the PKG Simulator runs in a browser environment, it cannot directly connect to PostgreSQL. Instead, we use a proxy server architecture:

1. **Frontend (Browser)**: React/Vite app that makes HTTP requests
2. **Proxy Server**: Express.js server that connects to PostgreSQL
3. **Database**: PostgreSQL (port-forwarded from Kubernetes)

## Setup

### 1. Install Dependencies

```bash
cd tools/pkg-simulator-v2.6
npm install
```

### 2. Configure Database Connection

The proxy server uses environment variables matching `docker/env.example`:

```bash
# Set these environment variables (or use defaults)
export POSTGRES_HOST=localhost
export POSTGRES_PORT=5432
export POSTGRES_DB=seedcore  # Note: database name is 'seedcore', not 'postgres'
export POSTGRES_USER=postgres
export POSTGRES_PASSWORD=password
```

### 3. Start Port Forwarding

Make sure you have port-forwarded PostgreSQL from your Kubernetes cluster:

```bash
cd deploy
./port-forward.sh
```

This should forward PostgreSQL to `localhost:5432`.

### 4. Start the Database Proxy Server

In one terminal:

```bash
cd tools/pkg-simulator-v2.6
npm run db-proxy
```

The proxy server will start on `http://localhost:3011` by default.

### 5. Start the Vite Dev Server

In another terminal:

```bash
cd tools/pkg-simulator-v2.6
npm run dev
```

The frontend will start on `http://localhost:3000` and will connect to the proxy server.

## Configuration

### Environment Variables

**Proxy Server** (Node.js):
- `POSTGRES_HOST` - PostgreSQL host (default: `localhost`)
- `POSTGRES_PORT` - PostgreSQL port (default: `5432`)
- `POSTGRES_DB` - Database name (default: `postgres`)
- `POSTGRES_USER` - Database user (default: `postgres`)
- `POSTGRES_PASSWORD` - Database password (default: `password`)
- `DB_PROXY_PORT` - Proxy server port (default: `3011`)

**Frontend** (Vite):
- `VITE_DB_PROXY_URL` - Proxy server URL (default: `http://localhost:3011`)

You can create a `.env` file in `tools/pkg-simulator-v2.6/`:

```env
VITE_DB_PROXY_URL=http://localhost:3011
```

## API Endpoints

The proxy server exposes the following endpoints:

- `GET /health` - Health check
- `GET /api/snapshots` - Get all PKG snapshots
- `GET /api/subtask-types` - Get all subtask types
- `GET /api/rules` - Get all rules with conditions and emissions
- `GET /api/deployments` - Get all deployments
- `GET /api/validation-runs` - Get all validation runs
- `GET /api/facts` - Get facts (from `facts` table)
- `GET /api/unified-memory?limit=50` - Get unified memory items

## Troubleshooting

### Connection Errors

If you see connection errors:

1. **Check port forwarding**: Make sure `./port-forward.sh` is running and PostgreSQL is accessible on `localhost:5432`
2. **Check proxy server**: Verify the proxy server is running on port 3011
3. **Check database credentials**: Ensure your environment variables match your PostgreSQL setup

### CORS Errors

If you see CORS errors, make sure:
- The proxy server is configured to allow requests from `http://localhost:3000`
- Both servers are running

### Empty Data

If you see empty lists:
- Verify the database has data in the PKG tables (`pkg_snapshots`, `pkg_policy_rules`, etc.)
- Check the browser console for error messages
- Check the proxy server logs for SQL errors

## Development

### Running Both Servers

You can use a process manager like `concurrently` to run both servers:

```bash
npm install -g concurrently
concurrently "npm run db-proxy" "npm run dev"
```

Or use separate terminals as described above.
