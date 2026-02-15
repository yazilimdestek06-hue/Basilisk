// pm2 Ecosystem Configuration for Basilisk Validator Node
// Start: pm2 start ecosystem.config.js
// Status: pm2 status
// Logs: pm2 logs

const path = require("path");
const fs = require("fs");

const BASILISK_ROOT = "C:/Users/Hyperkid/Desktop/Basilisk";
const OPENCLAW_ROOT = path.join(BASILISK_ROOT, "openclaw");
const CLOUDFLARED = "C:/Users/Hyperkid/AppData/Local/Microsoft/WinGet/Packages/Cloudflare.cloudflared_Microsoft.Winget.Source_8wekyb3d8bbwe/cloudflared.exe";

// Load .env file
function loadEnv(filePath) {
  const env = {};
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    for (const line of content.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eqIdx = trimmed.indexOf("=");
      if (eqIdx === -1) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      const value = trimmed.slice(eqIdx + 1).trim();
      if (key && value) env[key] = value;
    }
  } catch {}
  return env;
}

const dotenv = loadEnv(path.join(BASILISK_ROOT, ".env"));

module.exports = {
  apps: [
    // ─── OpenClaw Gateway ───────────────────────────
    {
      name: "openclaw-gateway",
      cwd: OPENCLAW_ROOT,
      script: "node",
      args: "openclaw.mjs gateway --port 18789 --verbose",
      env: {
        ...dotenv,
        NODE_ENV: "production",
        OPENCLAW_GATEWAY_PORT: 18789,
        OPENCLAW_CONFIG_PATH: "C:/Users/Hyperkid/.openclaw/openclaw.json",
        OPENCLAW_STATE_DIR: "C:/Users/Hyperkid/.openclaw",
      },
      max_memory_restart: "2G",
      restart_delay: 5000,
      max_restarts: 10,
      autorestart: true,
      watch: false,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: path.join(BASILISK_ROOT, "logs/openclaw-gateway-error.log"),
      out_file: path.join(BASILISK_ROOT, "logs/openclaw-gateway-out.log"),
      merge_logs: true,
    },

    // ─── File Server ────────────────────────────────
    {
      name: "file-server",
      cwd: path.join(BASILISK_ROOT, "file-server"),
      script: "node",
      args: "dist/index.js",
      env: {
        ...dotenv,
        NODE_ENV: "production",
        PORT: 4000,
      },
      max_memory_restart: "512M",
      restart_delay: 3000,
      max_restarts: 10,
      autorestart: true,
      watch: false,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: path.join(BASILISK_ROOT, "logs/file-server-error.log"),
      out_file: path.join(BASILISK_ROOT, "logs/file-server-out.log"),
      merge_logs: true,
    },

    // ─── Cloudflare Tunnel ──────────────────────────
    {
      name: "cloudflare-tunnel",
      script: CLOUDFLARED,
      args: "tunnel run basilisk",
      env: {},
      max_memory_restart: "256M",
      restart_delay: 5000,
      max_restarts: 5,
      autorestart: true,
      watch: false,
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: path.join(BASILISK_ROOT, "logs/cloudflare-tunnel-error.log"),
      out_file: path.join(BASILISK_ROOT, "logs/cloudflare-tunnel-out.log"),
      merge_logs: true,
    },
  ],
};
