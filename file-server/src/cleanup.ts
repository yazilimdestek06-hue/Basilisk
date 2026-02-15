import fs from "node:fs";
import path from "node:path";
import cron from "node-cron";
import { config } from "./config.js";
import { findExpiredApprovedFiles, removeFromIndex } from "./storage.js";

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
        console.log(`[cleanup] Deleted (age): ${fullPath}`);
      }
    }
  }
  return deleted;
}

/** Delete approved deliverables that have passed the 48h retention window. */
function cleanApprovedFiles(): number {
  const expired = findExpiredApprovedFiles(config.storagePath, config.approvedFileRetentionMs);
  let deleted = 0;

  for (const filePath of expired) {
    try {
      // Delete the data file and remove from index
      if (fs.existsSync(filePath)) {
        const fileId = path.basename(filePath).replace(/\.[^.]+$/, "");
        removeFromIndex(fileId);
        fs.unlinkSync(filePath);
        console.log(`[cleanup] Deleted (approved 48h): ${filePath}`);
        deleted++;
      }
      // Delete the sidecar .meta.json
      const metaFile = filePath + ".meta.json";
      if (fs.existsSync(metaFile)) {
        fs.unlinkSync(metaFile);
      }
    } catch (err) {
      console.error(`[cleanup] Failed to delete ${filePath}:`, err);
    }
  }

  return deleted;
}

export function startCleanupCron() {
  const maxAgeMs = config.cleanupMaxAgeDays * 24 * 60 * 60 * 1000;

  // Run daily at 3:00 AM — general age-based cleanup
  cron.schedule("0 3 * * *", () => {
    console.log("[cleanup] Starting scheduled cleanup...");
    const deleted = cleanOldFiles(config.storagePath, maxAgeMs);
    console.log(`[cleanup] Age-based: Deleted ${deleted} files.`);
  });

  // Run every hour — approved file cleanup (48h retention)
  cron.schedule("0 * * * *", () => {
    const deleted = cleanApprovedFiles();
    if (deleted > 0) {
      console.log(`[cleanup] Approved retention: Deleted ${deleted} files.`);
    }
  });

  console.log(`[cleanup] Scheduled: daily age cleanup (>${config.cleanupMaxAgeDays}d), hourly approved cleanup (>48h)`);
}
