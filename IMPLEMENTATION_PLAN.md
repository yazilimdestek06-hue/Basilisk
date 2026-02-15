# Basilisk Validator Node — Implementation Plan (v2)

## Machine Audit Results

| Resource | Status | Details |
|----------|--------|---------|
| OS | Windows 10 Pro 10.0.19045 | OK |
| CPU | AMD Ryzen 7 7700X | 8 cores / 16 threads |
| RAM | 64 GB (2x 32GB) | Docker allocated 31GB |
| Disk C: | 1.9 TB total, ~1.38 TB free | OS + tools |
| Disk D: | 1.9 TB total, ~1.2 TB free | File storage target |
| Docker Desktop | v28.5.1, running, Linux containers | WSL2 backend, overlay2 |
| Node.js | v22.21.0 | OK |
| npm | 10.9.4 | OK |
| pnpm | NOT INSTALLED | **Needs install** |
| Git | 2.51.1 | OK |
| cloudflared | NOT INSTALLED | **Needs install** |
| pm2 | NOT INSTALLED | **Needs install** |
| OpenClaw | NOT CLONED | **Needs clone from github.com/openclaw/openclaw** |
| Basilisk API | https://basilisk-api.fly.dev | Reachable, returns auth-required |

### Resolved Decisions

| Question | Answer |
|----------|--------|
| Domain | `basilisk.exchange` — Namecheap, currently on Vercel. Nameservers move to Cloudflare. |
| Anthropic API key | Available |
| Basilisk auth | OAuth key available — validator self-registers on first boot |
| Gateway mode | **Docker** — enables multiple specialized agent containers |
| Concurrency | **Maximum possible** — dynamic scaling up to hardware limits (~6-8 concurrent) |

---

## Architecture Overview

```
Internet
  │
  ├── Cloudflare Tunnel ──→ File Server (Express, port 4000)
  │     (files.basilisk.exchange)    └── Storage: D:/basilisk-files/
  │
  └── Cloudflare Tunnel ──→ OpenClaw Gateway (Docker, port 18789)
        (gateway.basilisk.exchange)    │
                                       ├── Task Router (poller + dispatcher)
                                       │     ├── Polls /api/verification-tasks every 30s
                                       │     ├── Claims unclaimed tasks
                                       │     └── Routes to best-fit agent by deliverable type
                                       │
                                       ├── basilisk-validator-code (Docker container)
                                       │     ├── Model: claude-opus-4-6
                                       │     ├── Specialization: source code, tests, builds
                                       │     ├── Sandbox: node:22 + python3, network:none
                                       │     └── Tools: run_code_sandbox, analyze_deliverable
                                       │
                                       ├── basilisk-validator-visual (Docker container)
                                       │     ├── Model: claude-opus-4-6 (multimodal)
                                       │     ├── Specialization: UI/UX, screenshots, design
                                       │     ├── Browser sandbox: Chromium headless
                                       │     └── Tools: analyze_images, browser_screenshot
                                       │
                                       └── basilisk-validator-docs (Docker container)
                                             ├── Model: claude-opus-4-6
                                             ├── Specialization: docs, content, API specs
                                             └── Tools: analyze_deliverable, submit_report

Concurrency: Dynamic pool — up to 6-8 simultaneous jobs
  ├── Per-agent limits: 2 GB RAM, 2 CPUs per sandbox container
  ├── Queue overflow: tasks wait in FIFO queue until a slot opens
  └── Bottleneck: Anthropic API rate limits (not hardware)
```

---

## Phase 0: Install Missing Prerequisites

### 0.1 Install pnpm
```bash
npm install -g pnpm
```

### 0.2 Install cloudflared
```bash
winget install Cloudflare.cloudflared
```

### 0.3 Install pm2
```bash
npm install -g pm2 pm2-windows-startup
```

### 0.4 Create storage directory
```bash
mkdir -p /d/basilisk-files
```

### 0.5 Increase Docker Desktop memory allocation
Current: 31 GB. Recommended: **48 GB** (leaves 16 GB for Windows).
Docker Desktop → Settings → Resources → Memory → 48 GB.
This allows ~8 concurrent sandbox containers at 2 GB each + gateway overhead.

---

## Phase 1: Clone & Build OpenClaw

### 1.1 Clone
```bash
cd /c/Users/Hyperkid/Desktop/Basilisk
git clone https://github.com/openclaw/openclaw.git
cd openclaw
```

### 1.2 Install & build
```bash
pnpm install
pnpm build
```

### 1.3 Build Docker images
```bash
docker build -t openclaw:local .
docker build -f Dockerfile.sandbox -t openclaw-sandbox:local .
docker build -f Dockerfile.sandbox-browser -t openclaw-sandbox-browser:local .
```

### 1.4 Verify gateway starts
```bash
docker-compose up openclaw-gateway
```
Confirm WebSocket listening on port 18789. Docker socket is mounted so the gateway can spawn sandbox containers (no Docker-in-Docker — uses sibling containers via `/var/run/docker.sock`).

---

## Phase 2: File Server

Standalone Express app, runs on host (not Docker). Sidecar to gateway.

### 2.1 Structure
```
C:\Users\Hyperkid\Desktop\Basilisk\file-server\
├── package.json
├── tsconfig.json
└── src/
    ├── index.ts              ← Express entry, port 4000
    ├── routes/
    │   ├── upload.ts         ← POST /upload (multipart, presigned URL validation)
    │   ├── download.ts       ← GET /files/:id (range support, streaming)
    │   └── presign.ts        ← POST /presign (generate upload URLs)
    ├── storage.ts            ← D:/basilisk-files/YYYY-MM/job-id/file-id.ext
    ├── security.ts           ← HMAC presign, rate limiter
    ├── cleanup.ts            ← Cron: delete files > 90 days
    └── config.ts             ← Port, paths, CORS origins
```

### 2.2 Upload flow
1. `POST /presign` → `{ jobId, filename, sha256 }` → returns HMAC-signed upload URL (1hr expiry)
2. `POST /upload?token=...` → multipart body → validate token → store to `D:/basilisk-files/YYYY-MM/{jobId}/{fileId}.ext`
3. Verify SHA-256 hash → return `{ fileId, size, sha256 }`

### 2.3 Download flow
1. `GET /files/:fileId` → stream file with `Range` header support
2. CORS: only `*.basilisk.exchange`

### 2.4 Security
- Rate limit: 10 uploads/min, 100 downloads/min per IP
- Max file: 500 MB (multer)
- Path traversal protection
- HMAC secret in `.env`

---

## Phase 3: Basilisk Verification Extension (Core)

### 3.1 Structure
```
openclaw/extensions/basilisk-verification/
├── package.json
├── openclaw.plugin.json
├── index.ts                        ← Plugin registration
└── src/
    ├── basilisk-api.ts             ← HTTP client for Basilisk platform
    ├── task-router.ts              ← Routes tasks to specialized agents
    ├── task-poller.ts              ← Background polling + claim loop
    ├── agent-pool.ts               ← Dynamic container pool manager
    ├── report-builder.ts           ← Structured report generation
    ├── types.ts                    ← Shared types
    └── tools/
        ├── claim-task.ts           ← claim_verification_task
        ├── analyze-deliverable.ts  ← analyze_deliverable
        ├── run-sandbox.ts          ← run_code_sandbox
        ├── analyze-images.ts       ← analyze_images (multimodal)
        ├── browser-screenshot.ts   ← browser_screenshot (Chromium headless)
        └── submit-report.ts        ← submit_report
```

### 3.2 Plugin manifest (`openclaw.plugin.json`)
```json
{
  "id": "basilisk-verification",
  "configSchema": {
    "type": "object",
    "properties": {
      "apiBase": { "type": "string", "default": "https://basilisk-api.fly.dev" },
      "fileStoragePath": { "type": "string", "default": "D:/basilisk-files" },
      "pollIntervalMs": { "type": "number", "default": 30000 },
      "maxConcurrentJobs": { "type": "number", "default": 8 },
      "sandboxMemory": { "type": "string", "default": "2g" },
      "sandboxCpus": { "type": "string", "default": "2" },
      "sandboxTimeoutSec": { "type": "number", "default": 60 }
    }
  }
}
```

### 3.3 Plugin entry (`index.ts`)
```typescript
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { createClaimTaskTool } from "./src/tools/claim-task.js";
import { createAnalyzeDeliverableTool } from "./src/tools/analyze-deliverable.js";
import { createRunSandboxTool } from "./src/tools/run-sandbox.js";
import { createAnalyzeImagesTool } from "./src/tools/analyze-images.js";
import { createBrowserScreenshotTool } from "./src/tools/browser-screenshot.js";
import { createSubmitReportTool } from "./src/tools/submit-report.js";
import { startTaskPoller } from "./src/task-poller.js";

const plugin = {
  id: "basilisk-verification",
  name: "Basilisk Verification",
  description: "Multi-agent verification system for Basilisk platform deliverables",
  configSchema: { /* from plugin.json */ },

  register(api: OpenClawPluginApi) {
    // Register tools (available to all agent types)
    api.registerTool(createClaimTaskTool(api));
    api.registerTool(createAnalyzeDeliverableTool(api));
    api.registerTool(createRunSandboxTool(api));
    api.registerTool(createAnalyzeImagesTool(api));
    api.registerTool(createBrowserScreenshotTool(api));
    api.registerTool(createSubmitReportTool(api));

    // Start background poller + router service
    api.registerService({
      name: "basilisk-task-poller",
      start: () => startTaskPoller(api),
    });
  },
};

export default plugin;
```

### 3.4 Task Router (`task-router.ts`)

The router inspects the claimed task and routes to the best-fit agent:

```
Incoming task
  │
  ├── Deliverable type detection:
  │     ├── .zip/.tar.gz/.git repo → CODE
  │     ├── .png/.jpg/.figma/deployed URL → VISUAL
  │     ├── .md/.pdf/.docx/API spec → DOCS
  │     └── Mixed → CODE (default, most capable)
  │
  ├── Route to agent:
  │     ├── CODE  → basilisk-validator-code
  │     ├── VISUAL → basilisk-validator-visual
  │     └── DOCS  → basilisk-validator-docs
  │
  └── If target agent pool is full → queue with priority (FIFO)
```

### 3.5 Agent Pool Manager (`agent-pool.ts`)

Dynamically manages container lifecycle:

```
Pool config:
  maxContainers: 8 (configurable, based on hardware)
  perAgentType:
    code:   min 1, max 4
    visual: min 1, max 3
    docs:   min 0, max 2

Scaling logic:
  - On task claim: if idle container of matching type → assign
  - If no idle container and pool < max → spawn new container
  - If pool at max → enqueue task, assign when container frees up
  - Idle containers killed after 5 min (save resources)
  - Health check: ping containers every 30s, restart if unresponsive
```

### 3.6 Tool implementations

#### `claim_verification_task`
- Params: `{ taskId?: string }`
- `GET /api/verification-tasks` → filter unclaimed → `POST claim`
- Returns task details

#### `analyze_deliverable`
- Params: `{ jobId, deliverableUrl, acceptanceCriteria[] }`
- Local file → read from `D:/basilisk-files/` directly
- External URL → download to temp storage
- Detect type → route analysis strategy (code/visual/docs)
- Returns structured analysis per criterion

#### `run_code_sandbox`
- Params: `{ code, language, testCommands[], timeoutSec? }`
- Docker container: `openclaw-sandbox:local`, `--memory=2g --cpus=2 --network=none`
- Mount deliverable as `:ro`
- Execute commands, capture stdout/stderr/exit codes
- Auto-destroy after completion or timeout (60s)
- Returns `{ results[], timedOut }`

#### `analyze_images`
- Params: `{ imagePaths[], criteria[], context? }`
- Send to Claude Opus 4.6 multimodal with criteria prompt
- Returns per-image pass/fail per criterion

#### `browser_screenshot`
- Params: `{ url, viewportWidth?, viewportHeight?, fullPage? }`
- Spawn `openclaw-sandbox-browser:local` container (Chromium headless)
- Navigate to URL, capture screenshot(s)
- Returns image paths for `analyze_images` to process

#### `submit_report`
- Params: `{ taskId, report: VerificationReport }`
- Validate structure → `POST /api/verification-tasks/:id/submit-report`
- Returns confirmation

### 3.7 `basilisk-api.ts` — HTTP Client
```typescript
class BasiliskApiClient {
  private token: string;
  private agentId: string;
  private apiBase: string;

  // Self-registers on first boot, persists credentials to .env
  async register(): Promise<{ agentId: string; token: string; apiKey: string }>;
  async getVerificationTasks(): Promise<VerificationTask[]>;
  async claimTask(taskId: string): Promise<void>;
  async getJobDetails(jobId: string): Promise<JobDetails>;
  async submitReport(taskId: string, report: VerificationReport): Promise<void>;
  async refreshToken(): Promise<void>;
}
```

Registration payload:
```json
{
  "type": "ai",
  "specialization": "verification",
  "name": "Basilisk Validator",
  "capabilities": ["code-analysis", "image-analysis", "sandbox-execution", "browser-analysis"]
}
```

### 3.8 Task Poller (`task-poller.ts`)

```
Loop every 30 seconds:
  1. GET /api/verification-tasks → filter unclaimed
  2. For each unclaimed task:
     a. POST claim with { verifierId: agentId }
     b. GET /api/jobs/:id → job details + deliverable + criteria
     c. Detect deliverable type
     d. task-router.ts → pick best agent type
     e. agent-pool.ts → assign or queue
     f. Send structured prompt to agent container:
        - Job description + acceptance criteria
        - Deliverable path (local) or URL
        - Instructions: analyze → build report → submit
     g. Agent autonomously uses tools → submits report
  3. On error: log, retry up to 3x, then mark failed
  4. Metrics: tasks/min, avg processing time, queue depth
```

---

## Phase 4: Multi-Agent Configuration

### 4.1 Three specialized agents in `~/.openclaw/config.json`

```json
{
  "agents": {
    "list": [
      {
        "id": "basilisk-validator-code",
        "name": "Basilisk Code Verifier",
        "model": { "primary": "claude-opus-4-6" },
        "skills": ["bash", "http", "file-read", "coding-agent"],
        "systemPrompt": "You are a code verification specialist. You analyze source code deliverables against acceptance criteria. You compile, run tests, check code quality, and verify functionality using sandbox execution. Be thorough and precise.",
        "sandbox": {
          "mode": "all",
          "scope": "session",
          "docker": {
            "image": "openclaw-sandbox:local",
            "memory": "2g",
            "cpus": "2",
            "network": "none"
          },
          "browser": { "enabled": false }
        },
        "tools": {
          "allowlist": [
            "bash", "http", "file-read",
            "claim_verification_task", "analyze_deliverable",
            "run_code_sandbox", "submit_report"
          ]
        }
      },
      {
        "id": "basilisk-validator-visual",
        "name": "Basilisk Visual Verifier",
        "model": { "primary": "claude-opus-4-6" },
        "skills": ["http", "file-read"],
        "systemPrompt": "You are a visual/UI verification specialist. You analyze screenshots, design deliverables, and deployed websites against visual acceptance criteria. You check layout, responsiveness, color accuracy, and UX quality.",
        "sandbox": {
          "mode": "all",
          "scope": "session",
          "docker": {
            "image": "openclaw-sandbox:local",
            "memory": "2g",
            "cpus": "2",
            "network": "none"
          },
          "browser": {
            "enabled": true,
            "headless": true,
            "image": "openclaw-sandbox-browser:local"
          }
        },
        "tools": {
          "allowlist": [
            "http", "file-read",
            "claim_verification_task", "analyze_deliverable",
            "analyze_images", "browser_screenshot", "submit_report"
          ]
        }
      },
      {
        "id": "basilisk-validator-docs",
        "name": "Basilisk Document Verifier",
        "model": { "primary": "claude-opus-4-6" },
        "skills": ["http", "file-read"],
        "systemPrompt": "You are a documentation and content verification specialist. You analyze written deliverables — docs, API specs, reports, articles — against acceptance criteria. You check completeness, accuracy, formatting, and quality.",
        "sandbox": {
          "mode": "all",
          "scope": "session",
          "docker": {
            "image": "openclaw-sandbox:local",
            "memory": "1g",
            "cpus": "1",
            "network": "none"
          },
          "browser": { "enabled": false }
        },
        "tools": {
          "allowlist": [
            "http", "file-read",
            "claim_verification_task", "analyze_deliverable",
            "submit_report"
          ]
        }
      }
    ]
  },
  "gateway": {
    "port": 18789,
    "token": "${OPENCLAW_GATEWAY_TOKEN}"
  },
  "providers": {
    "anthropic": {
      "apiKey": "${ANTHROPIC_API_KEY}"
    }
  },
  "extensions": {
    "enabled": ["basilisk-verification"]
  }
}
```

### 4.2 Resource allocation per agent type

| Agent | RAM/container | CPUs | Browser | Max instances |
|-------|--------------|------|---------|---------------|
| `validator-code` | 2 GB | 2 | No | 4 |
| `validator-visual` | 2 GB | 2 | Yes (Chromium) | 3 |
| `validator-docs` | 1 GB | 1 | No | 2 |
| **Total max** | | | | **8 concurrent** (configurable) |

### 4.3 Environment variables (`.env`)
```bash
# LLM
ANTHROPIC_API_KEY=sk-ant-...

# OpenClaw Gateway
OPENCLAW_GATEWAY_TOKEN=<random-uuid>

# Basilisk Platform
BASILISK_API_BASE=https://basilisk-api.fly.dev
BASILISK_OAUTH_KEY=<your-oauth-key>
BASILISK_AGENT_ID=<auto-populated on first registration>
BASILISK_JWT_TOKEN=<auto-populated on first registration>

# File Server
FILE_SERVER_PORT=4000
FILE_SERVER_HMAC_SECRET=<random-64-char-hex>
BASILISK_FILE_STORAGE=D:/basilisk-files

# Agent Pool
MAX_CONCURRENT_JOBS=8
POOL_IDLE_TIMEOUT_MS=300000
```

---

## Phase 5: Cloudflare Tunnel + DNS Migration

### 5.1 Move nameservers from Namecheap to Cloudflare

1. Create free Cloudflare account (or log in)
2. Add site: `basilisk.exchange`
3. Cloudflare scans existing DNS records
4. **Re-create Vercel DNS records** in Cloudflare:
   - `A` or `CNAME` records that Vercel requires (e.g. `@` → `76.76.21.21`, `www` → `cname.vercel-dns.com`)
   - Copy all existing records from Namecheap DNS
5. Cloudflare gives you two nameservers (e.g. `ada.ns.cloudflare.com`, `bob.ns.cloudflare.com`)
6. Go to Namecheap → Domain → Nameservers → **Custom DNS** → paste Cloudflare nameservers
7. Wait for propagation (usually 1-24 hours)
8. Cloudflare shows "Active" status

**Vercel continues to work** — same DNS records, just hosted on Cloudflare now.

### 5.2 Authenticate cloudflared
```bash
cloudflared tunnel login
# Opens browser → Cloudflare dashboard → select basilisk.exchange zone
```

### 5.3 Create tunnel
```bash
cloudflared tunnel create basilisk-node
```
Creates credentials file at `~/.cloudflared/<tunnel-id>.json`.

### 5.4 Add DNS routes
```bash
cloudflared tunnel route dns basilisk-node files.basilisk.exchange
cloudflared tunnel route dns basilisk-node gateway.basilisk.exchange
```

### 5.5 Tunnel config: `~/.cloudflared/config.yml`
```yaml
tunnel: basilisk-node
credentials-file: C:\Users\Hyperkid\.cloudflared\<tunnel-id>.json

ingress:
  - hostname: files.basilisk.exchange
    service: http://localhost:4000
  - hostname: gateway.basilisk.exchange
    service: http://localhost:18789
  - service: http_status:404
```

Single `cloudflared` process handles both subdomains.

### 5.6 Run
```bash
cloudflared tunnel run basilisk-node
```

---

## Phase 6: Process Management (pm2)

### 6.1 Ecosystem file: `ecosystem.config.js`
```javascript
module.exports = {
  apps: [
    {
      name: "openclaw-gateway",
      cwd: "C:/Users/Hyperkid/Desktop/Basilisk/openclaw",
      script: "dist/index.js",
      args: "gateway --port 18789",
      env_file: "C:/Users/Hyperkid/Desktop/Basilisk/.env",
      restart_delay: 5000,
      max_restarts: 50,
      exp_backoff_restart_delay: 1000,
    },
    {
      name: "basilisk-file-server",
      cwd: "C:/Users/Hyperkid/Desktop/Basilisk/file-server",
      script: "dist/index.js",
      env_file: "C:/Users/Hyperkid/Desktop/Basilisk/.env",
      restart_delay: 5000,
      max_restarts: 50,
    },
    {
      name: "cloudflare-tunnel",
      script: "cloudflared",
      args: "tunnel run basilisk-node",
      restart_delay: 5000,
      max_restarts: 50,
    },
  ],
};
```

### 6.2 Start & persist
```bash
pm2 start ecosystem.config.js
pm2 save
pm2-startup install   # Auto-start on Windows boot
```

### 6.3 Monitoring
```bash
pm2 monit     # Live CPU/RAM dashboard
pm2 logs      # Tail all process logs
pm2 status    # Process status table
```

---

## Phase 7: Security Hardening

### 7.1 Docker sandbox isolation
- `--network=none` — zero internet access
- `--memory=2g` — OOM protection
- `--cpus=2` — prevents CPU starvation
- `--read-only` root filesystem + tmpfs for `/tmp`
- Mount deliverables as `:ro` (read-only)
- `--rm` — auto-destroy after execution
- 60-second hard kill timeout
- No `--privileged`, no `SYS_ADMIN` capabilities
- Docker socket mounted to gateway only (not to sandbox containers)

### 7.2 File server security
- SHA-256 hash verification on upload
- HMAC-SHA256 presigned URLs, 1-hour expiry, single-use
- express-rate-limit: 10 uploads/min, 100 downloads/min per IP
- CORS: strict `*.basilisk.exchange` only
- Path traversal: normalize paths, reject `..`
- Max 500 MB per file (multer)
- MIME type validation

### 7.3 Secrets management
- All secrets in `.env` (gitignored)
- JWT auto-refresh before expiry
- HMAC secret rotation: monthly, 24hr overlap for old key
- Gateway token: random UUID

### 7.4 Network security
- No ports exposed to internet directly — Cloudflare Tunnel only
- Cloudflare handles TLS termination (HTTPS)
- Cloudflare WAF rules (optional): block non-API traffic

---

## Execution Order

```
Phase 0 (prerequisites)
  │
  ├──→ Phase 1 (clone + build OpenClaw)
  │       │
  │       ├──→ Phase 3 (basilisk-verification extension)
  │       │       │
  │       │       └──→ Phase 4 (multi-agent config)
  │       │               │
  │       │               └──→ Phase 6 (pm2) ──→ Phase 7 (hardening)
  │       │
  │       └──→ Phase 1.3 (Docker images) ←── can parallel with Phase 2
  │
  └──→ Phase 2 (file server) ←── can parallel with Phase 1
          │
          └──→ Phase 5 (Cloudflare tunnel + DNS migration)
```

**Critical path:** Phase 0 → Phase 1 → Phase 3 → Phase 4 → Phase 6

**Parallel tracks:**
- Phase 2 (file server) alongside Phase 1 (OpenClaw build)
- Phase 5 (DNS migration) can start early — propagation takes hours
- Docker image builds alongside extension development

---

## Final File Tree

```
C:\Users\Hyperkid\Desktop\Basilisk\
├── IMPLEMENTATION_PLAN.md
├── plan.md
├── .env                                ← Secrets (gitignored)
├── .gitignore
├── ecosystem.config.js                 ← pm2 process config
│
├── file-server/                        ← Express file server
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── index.ts
│       ├── config.ts
│       ├── storage.ts
│       ├── security.ts
│       ├── cleanup.ts
│       └── routes/
│           ├── upload.ts
│           ├── download.ts
│           └── presign.ts
│
├── openclaw/                           ← Cloned from github.com/openclaw/openclaw
│   └── extensions/
│       └── basilisk-verification/      ← Custom extension
│           ├── package.json
│           ├── openclaw.plugin.json
│           ├── index.ts
│           └── src/
│               ├── basilisk-api.ts
│               ├── task-router.ts
│               ├── task-poller.ts
│               ├── agent-pool.ts
│               ├── report-builder.ts
│               ├── types.ts
│               └── tools/
│                   ├── claim-task.ts
│                   ├── analyze-deliverable.ts
│                   ├── run-sandbox.ts
│                   ├── analyze-images.ts
│                   ├── browser-screenshot.ts
│                   └── submit-report.ts
│
└── ~/.openclaw/
    └── config.json                     ← 3 agent definitions + gateway + providers

~/.cloudflared/
    ├── config.yml                      ← Tunnel ingress rules
    └── <tunnel-id>.json                ← Tunnel credentials
```
