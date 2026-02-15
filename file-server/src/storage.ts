import fs from "node:fs";
import path from "node:path";
import { config } from "./config.js";

function getMonthDir(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

export function resolveStoragePath(jobId: string, fileId: string, ext: string): string {
  const monthDir = getMonthDir();
  const dir = path.join(config.storagePath, monthDir, jobId);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${fileId}${ext}`);
}

export function findFileById(fileId: string): string | null {
  return searchDir(config.storagePath, fileId);
}

function searchDir(dir: string, fileId: string): string | null {
  if (!fs.existsSync(dir)) return null;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = searchDir(fullPath, fileId);
      if (found) return found;
    } else if (entry.name.startsWith(fileId) && !entry.name.endsWith(".meta.json")) {
      return fullPath;
    }
  }
  return null;
}

export function getFileMeta(filePath: string) {
  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".zip": "application/zip",
    ".tar": "application/x-tar",
    ".gz": "application/gzip",
    ".pdf": "application/pdf",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".json": "application/json",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".html": "text/html",
    ".css": "text/css",
    ".js": "application/javascript",
    ".ts": "text/typescript",
  };
  return {
    size: stat.size,
    mtime: stat.mtime,
    contentType: mimeTypes[ext] || "application/octet-stream",
    filename: path.basename(filePath),
  };
}

// --- Sidecar metadata (.meta.json) ---

export interface FileMeta {
  fileId: string;
  jobId: string;
  filename: string;
  sha256: string;
  size: number;
  uploadedAt: number;
  approvedAt?: number;
}

function metaPath(filePath: string): string {
  return filePath + ".meta.json";
}

export function writeFileMeta(filePath: string, meta: FileMeta): void {
  fs.writeFileSync(metaPath(filePath), JSON.stringify(meta, null, 2));
}

export function readFileMeta(filePath: string): FileMeta | null {
  const mp = metaPath(filePath);
  if (!fs.existsSync(mp)) return null;
  try {
    return JSON.parse(fs.readFileSync(mp, "utf-8"));
  } catch {
    return null;
  }
}

export function markFileApproved(filePath: string): boolean {
  const meta = readFileMeta(filePath);
  if (!meta) return false;
  meta.approvedAt = Date.now();
  fs.writeFileSync(metaPath(filePath), JSON.stringify(meta, null, 2));
  return true;
}

/** Find all files with sidecar metadata where approvedAt + retention has passed. */
export function findExpiredApprovedFiles(dir: string, retentionMs: number): string[] {
  const expired: string[] = [];
  if (!fs.existsSync(dir)) return expired;

  const now = Date.now();
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.name === "_tmp") continue;

    if (entry.isDirectory()) {
      expired.push(...findExpiredApprovedFiles(fullPath, retentionMs));
    } else if (entry.name.endsWith(".meta.json")) {
      try {
        const meta: FileMeta = JSON.parse(fs.readFileSync(fullPath, "utf-8"));
        if (meta.approvedAt && now - meta.approvedAt > retentionMs) {
          // The actual file path is the meta path minus ".meta.json"
          const dataFile = fullPath.slice(0, -".meta.json".length);
          expired.push(dataFile);
        }
      } catch {
        // skip corrupt meta
      }
    }
  }

  return expired;
}
