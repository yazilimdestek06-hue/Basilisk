I need you to plan and set up a "Basilisk Validator Node" on this Windows machine, built on top of OpenClaw — an agent framework
  with built-in Docker sandboxing, plugin system, and LLM orchestration.

  ## What This Machine Will Do

  1. **OpenClaw Gateway** — Runs the agent runtime (Pi Agent Core) with Docker sandbox for safe code execution + browser sandbox
  for visual analysis
  2. **Basilisk Validator Agent** — An OpenClaw agent configured as "basilisk-validator" that auto-claims verification tasks from
  the Basilisk platform, analyzes deliverables, and submits structured reports
  3. **File Server** — Handles large deliverable uploads/downloads so the main platform API doesn't carry file traffic
  4. **Cloudflare Tunnel** — Exposes file server + gateway to the internet (free, HTTPS, no port forwarding)

  ## OpenClaw Architecture (already explored — use this)

  OpenClaw provides:
  - **Agent runtime**: Pi Agent Core (`@mariozechner/pi-agent-core`) — LLM orchestration with tool execution
  - **Docker sandbox**: `Dockerfile.sandbox` (bash, Python, curl, git) + `Dockerfile.sandbox-browser` (Chromium/VNC)
  - **Plugin system**: `extensions/` directory — register custom tools via `api.registerTool()`
  - **Skills system**: `skills/` directory — markdown-defined tool docs
  - **Gateway**: WebSocket on port 18789, session-based routing
  - **Config**: `~/.openclaw/config.json` — agent definitions, sandbox settings, model config

  **Key OpenClaw files to reference** (clone from https://github.com/nicepkg/openclaw or the user may already have it):
  - `docker-compose.yml` — Gateway + CLI containers
  - `docker-setup.sh` — Quick Docker setup script
  - `Dockerfile`, `Dockerfile.sandbox`, `Dockerfile.sandbox-browser`
  - `src/config/types.agents.ts` — Agent config schema
  - `extensions/` — Plugin examples (discord, telegram, etc.)

  ## Architecture

  Internet
    │
    ├── Cloudflare Tunnel ──→ File Server (Express, port 4000)
    │                              ├── POST /upload (presigned, up to 500MB)
    │                              ├── GET /files/:id (download with range support)
    │                              └── Storage: D:/basilisk-files/
    │
    └── Cloudflare Tunnel ──→ OpenClaw Gateway (WebSocket, port 18789)
                                    │
                                    ↓
                              basilisk-validator agent
                                    ├── Model: claude-opus-4.6 (multimodal)
                                    ├── Custom Extension: basilisk-verification
                                    │     ├── claim_verification_task tool
                                    │     ├── analyze_deliverable tool
                                    │     ├── run_code_sandbox tool
                                    │     ├── analyze_images tool
                                    │     └── submit_report tool
                                    ├── Docker Sandbox (code execution)
                                    │     ├── Fresh container per job
                                    │     ├── Network: none
                                    │     ├── Memory: 2GB limit
                                    │     └── Timeout: 60s
                                    └── Browser Sandbox (visual verification)
                                          └── Chromium headless for screenshots

  ## Basilisk Platform API Details

  - API Base: https://basilisk-api.fly.dev
  - The validator registers as an agent (type: "ai", specialization: "verification", name: "Basilisk Validator")
  - Auth: POST /api/agents returns JWT token

  Endpoints the validator uses:
  - POST /api/agents — Register (returns JWT + API key)
  - GET /api/verification-tasks — List unclaimed verification tasks
  - POST /api/verification-tasks/:id/claim — Claim a task (body: { verifierId: agentId })
  - GET /api/jobs/:id — Get job details + deliverable URL + acceptance criteria
  - POST /api/verification-tasks/:id/submit-report — Submit verification report

  Verification report structure:
  ```json
  {
    "verifierId": "agent-id",
    "report": {
      "overallPassed": true,
      "overallScore": 85,
      "confidence": 0.92,
      "summary": "Deliverable meets all requirements...",
      "criteriaResults": [
        { "criterionId": "c1", "passed": true, "detail": "Code compiles successfully" },
        { "criterionId": "c2", "passed": true, "detail": "All 12 tests pass" },
        { "criterionId": "c3", "passed": false, "detail": "Missing responsive breakpoints" }
      ],
      "flags": [],
      "recommendation": "approve"
    }
  }

  Custom OpenClaw Extension: basilisk-verification

  Create at extensions/basilisk-verification/:

  extensions/basilisk-verification/
    package.json
    index.ts          ← Plugin registration (api.registerTool for each verification tool)
    src/
      basilisk-api.ts     ← HTTP client for Basilisk platform API
      file-server.ts      ← Express file server (runs alongside gateway)
      sandbox-runner.ts   ← Docker container management for code verification
      image-analyzer.ts   ← Multimodal LLM calls for visual deliverables
      report-builder.ts   ← Structured report generation
      task-poller.ts      ← Polls /api/verification-tasks, auto-claims unclaimed ones

  Agent Config (add to ~/.openclaw/config.json)

  {
    "agents": {
      "list": [
        {
          "id": "basilisk-validator",
          "name": "Basilisk Verification Agent",
          "model": {
            "primary": "claude-opus-4.6"
          },
          "skills": ["bash", "http", "file-read", "coding-agent"],
          "sandbox": {
            "mode": "all",
            "scope": "session",
            "docker": {
              "image": "node:22-slim",
              "memory": "2g",
              "cpus": "2",
              "network": "none"
            },
            "browser": {
              "enabled": true,
              "headless": true
            }
          },
          "tools": {
            "allowlist": ["bash", "http", "file-read"]
          }
        }
      ]
    }
  }

  File Server Requirements

  - Express on port 4000, runs as a sidecar to OpenClaw gateway
  - Upload: multipart, up to 500MB, SHA-256 hash verification
  - Presigned upload URLs (HMAC-signed, 1hr expiry)
  - Storage structure: D:/basilisk-files/YYYY-MM/job-id/file-id.ext
  - Download: serve by file ID, support Range headers for large files
  - Auto-cleanup: files older than 90 days
  - CORS: Allow basilisk.exchange origins
  - The validator agent reads files directly from D:/basilisk-files/ (zero network overhead)

  Task Poller (Daemon Process)

  A background loop that:
  1. Every 30 seconds: GET /api/verification-tasks
  2. Filter for unclaimed tasks
  3. POST claim on each unclaimed task
  4. For each claimed task:
  a. GET /api/jobs/:id for full job details + deliverable
  b. If deliverable is on local file server → read from filesystem
  c. If deliverable is external URL → download to local storage
  d. Route to OpenClaw agent session: agent:basilisk-validator:job-{jobId}
  e. Agent analyzes (code → sandbox, images → multimodal, content → LLM)
  f. Agent produces structured report
  g. POST report to /api/verification-tasks/:id/submit-report

  What I Need You To Plan

  1. Check prerequisites: Windows version, WSL2, Docker Desktop, Node.js, pnpm, available disk space, network speed
  2. OpenClaw setup: Clone repo (or check if already available), build, configure gateway
  3. Custom extension: basilisk-verification extension structure and implementation plan
  4. File server: Implementation alongside OpenClaw gateway
  5. Cloudflare Tunnel: Setup with cloudflared (two tunnels: file server + gateway)
  6. Task poller: Daemon that bridges Basilisk API ↔ OpenClaw agent
  7. Process management: pm2 or Windows Service to keep everything running on boot
  8. Security: Sandbox isolation, upload validation, rate limiting, API key rotation

  Explore this machine first (OS, disk, Docker status, installed tools) then create a detailed implementation plan. Do NOT start
  implementing — just plan.