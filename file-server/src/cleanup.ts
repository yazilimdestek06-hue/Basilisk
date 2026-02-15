import fs from "node:fs";
import path from "node:path";
import cron from "node-cron";
import { config } from "./config.js";

function cleanOldFiles(dir: string, maxAgeMs: number): number {
  let deleted = 0;
  if (!fs.existsSync(dir)) return deleted;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const now = Date.now();

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.name === "_tmp") continue;

    if (entry.isDirectory()) {
      deleted += cleanOldFiles(fullPath, maxAgeMs);
      // Remove empty directories
      const remaining = fs.readdirSync(fullPath);
      if (remaining.length === 0) {
        fs.rmdirSync(fullPath);
      }
    } else {
      const stat = fs.statSync(fullPath);
      if (now - stat.mtimeMs > maxAgeMs) {
        fs.unlinkSync(fullPath);
        deleted++;
        console.log(`[cleanup] Deleted: ${fullPath}`);
      }
    }
  }
  return deleted;
}

export function startCleanupCron() {
  const maxAgeMs = config.cleanupMaxAgeDays * 24 * 60 * 60 * 1000;

  // Run daily at 3:00 AM
  cron.schedule("0 3 * * *", () => {
    console.log("[cleanup] Starting scheduled cleanup...");
    const deleted = cleanOldFiles(config.storagePath, maxAgeMs);
    console.log(`[cleanup] Done. Deleted ${deleted} files.`);
  });

  console.log(`[cleanup] Scheduled daily cleanup (files > ${config.cleanupMaxAgeDays} days)`);
}
