# Basilisk - AI-Powered Verification Network

Basilisk is an autonomous verification system that uses AI agents to verify deliverables (code, visual assets, documentation) submitted by freelancers on the Basilisk marketplace. Agents claim tasks, analyze deliverables using sandboxed tools, and submit structured verification reports.

## Architecture

```
                         ┌──────────────────────┐
                         │   Basilisk API        │
                         │ basilisk-api.fly.dev  │
                         └──────┬───────┬────────┘
                           poll │       │ submit report
                    ┌───────────┘       └──────────────┐
                    ▼                                   ▲
          ┌─────────────────┐                           │
          │   Task Poller   │                           │
          │ (30s interval)  │                           │
          └────────┬────────┘                           │
                   │ claim + route                      │
                   ▼                                    │
          ┌─────────────────┐                           │
          │   Agent Pool    │                           │
          │  (max 8 slots)  │                           │
          │  code: 4 max    │                           │
          │  visual: 3 max  │                           │
          │  docs: 2 max    │                           │
          └────────┬────────┘                           │
                   │ dispatch via HTTP                  │
                   ▼                                    │
          ┌─────────────────┐     ┌──────────────┐     │
          │  OpenClaw       │────▶│  AI Agent     │     │
          │  Gateway        │     │  (Sonnet 4.5) │     │
          │  :18789         │     │              │     │
          │  /v1/chat/      │     │  Tools:       │     │
          │  completions    │     │  - analyze    │─────┘
          └─────────────────┘     │  - sandbox    │
                                  │  - screenshot │
                                  │  - submit     │
                                  └───────┬───────┘
                                          │
                                  ┌───────▼───────┐
                                  │ Docker Sandbox │
                                  │ (isolated)     │
                                  │ no network     │
                                  │ 2GB mem, 2 CPU │
                                  └────────────────┘
```

## Components

### 1. Verification Extension (`extensions/basilisk-verification/`)

OpenClaw plugin that runs inside the gateway. Contains all verification logic:

| File | Purpose |
|------|---------|
| `index.ts` | Plugin entry point - registers tools and starts poller service |
| `src/task-poller.ts` | Polls Basilisk API for unclaimed tasks, claims them, dispatches to agents |
| `src/task-router.ts` | Routes tasks to the right agent type (code/visual/docs) based on deliverable |
| `src/gateway-client.ts` | HTTP client that dispatches prompts to agents via OpenAI-compatible API |
| `src/agent-pool.ts` | Concurrency limiter - max 8 concurrent tasks with per-type limits |
| `src/basilisk-api.ts` | HTTP client for Basilisk platform API (register, claim, submit) |
| `src/report-builder.ts` | Builds structured verification reports from criteria results |
| `src/types.ts` | TypeScript interfaces for tasks, jobs, reports, criteria |

#### Agent Tools

| Tool | Description |
|------|-------------|
| `analyze_deliverable` | Downloads deliverable files, detects type, prepares for analysis |
| `run_code_sandbox` | Executes code in isolated Docker container (no network, 2GB RAM) |
| `browser_screenshot` | Takes screenshots of URLs using headless Chromium in Docker |
| `analyze_images` | Evaluates visual deliverables against design criteria |
| `claim_verification_task` | Claims a task from the Basilisk API |
| `submit_report` | Submits structured verification report with pass/fail per criterion |

### 2. File Server (`file-server/`)

Express.js server for secure file upload/download with presigned URLs:

- **Presigned uploads**: `POST /presign` → generates HMAC-signed upload token
- **Secure upload**: `POST /upload?token=...` → verifies SHA-256 hash before storing
- **Download**: `GET /files/:fileId` → supports range requests for large files
- **Cleanup**: Daily cron job removes files older than 90 days
- **Security**: Path traversal protection, rate limiting, CORS

### 3. Process Orchestration (`ecosystem.config.js`)

PM2 configuration managing three services:

| Service | Port | Purpose |
|---------|------|---------|
| `openclaw-gateway` | 18789 | AI agent gateway (WebSocket + HTTP) |
| `file-server` | 4000 | Deliverable file storage |
| `cloudflare-tunnel` | - | Exposes services via Cloudflare Tunnel |

## How It Works

### Task Lifecycle

1. **Poll**: Task poller queries `GET /api/verification-tasks` every 30 seconds
2. **Claim**: When unclaimed tasks are found, poller calls `POST /api/verification-tasks/:id/claim`
3. **Route**: `task-router.ts` detects deliverable type from URL, file extension, criteria keywords, or description
4. **Pool**: `agent-pool.ts` allocates a concurrency slot (max 8 total, per-type limits)
5. **Dispatch**: `gateway-client.ts` sends prompt via `POST /v1/chat/completions` to the OpenClaw gateway
6. **Agent Execution**: The AI agent (Claude Sonnet 4.5) autonomously:
   - Downloads the deliverable with `analyze_deliverable`
   - Runs tests in Docker sandbox with `run_code_sandbox` (for code)
   - Takes screenshots with `browser_screenshot` (for visual)
   - Evaluates each acceptance criterion
   - Submits report via `submit_report`
7. **Complete**: Report is stored on Basilisk API, task status changes to `completed`

### Agent Routing

```
Task Data → detectDeliverableType() → AgentType → AgentId
                    │
                    ├── Explicit category field
                    ├── URL patterns (github.com → code, figma.com → visual)
                    ├── File extensions (.zip → code, .png → visual, .pdf → docs)
                    ├── Criteria keywords ("compile" → code, "responsive" → visual)
                    ├── Description keywords
                    └── Default: code (most capable)
```

| Agent Type | Agent ID | Timeout | Docker Config |
|------------|----------|---------|---------------|
| `code` | `basilisk-validator-code` | 10 min | 2GB RAM, 2 CPU, no network |
| `visual` | `basilisk-validator-visual` | 5 min | 2GB RAM, 2 CPU, bridge network + browser |
| `docs` | `basilisk-validator-docs` | 3 min | 1GB RAM, 1 CPU, no network |

### Gateway Dispatch

The poller communicates with AI agents through the OpenClaw gateway's OpenAI-compatible HTTP API:

```
POST http://127.0.0.1:18789/v1/chat/completions
Headers:
  Authorization: Bearer <OPENCLAW_GATEWAY_TOKEN>
  X-OpenClaw-Agent-Id: basilisk-validator-code
  X-OpenClaw-Session-Key: verify:<taskId>
Body:
  { "model": "openclaw", "stream": false, "messages": [...] }
```

Each task gets a unique session key (`verify:<taskId>`) for isolation.

## Setup

### Prerequisites

- Node.js 22+
- Docker (for sandboxed code execution)
- PM2 (`npm install -g pm2`)
- OpenClaw gateway (installed separately)
- Cloudflare Tunnel (optional, for public access)

### Installation

```bash
# Clone this repo
git clone https://github.com/yazilimdestek06-hue/Basilisk.git
cd Basilisk

# Copy and configure environment
cp .env.example .env
# Edit .env with your API keys and tokens

# Install file server dependencies
cd file-server && npm install && npm run build && cd ..

# Copy extension into OpenClaw
cp -r extensions/basilisk-verification/ <openclaw-path>/extensions/

# Start all services
pm2 start ecosystem.config.js
pm2 logs
```

### Configuration

The OpenClaw gateway config (`~/.openclaw/openclaw.json`) needs:

1. **Agent definitions** for `basilisk-validator-code`, `basilisk-validator-visual`, `basilisk-validator-docs`
2. **Plugin entry** for `basilisk-verification` with API base, file storage path, gateway token
3. **Sandbox config** with Docker image `openclaw-sandbox:local`

See `IMPLEMENTATION_PLAN.md` for detailed configuration examples.

## Monitoring

```bash
# Service status
pm2 status

# Live logs
pm2 logs openclaw-gateway

# Look for these log patterns:
# [task-poller] Found N unclaimed tasks
# [task-poller] Claimed task <id>
# [task-poller] Dispatching task <id> via HTTP API → <agent>
# [task-poller] Task <id> completed successfully
```

## License

MIT
