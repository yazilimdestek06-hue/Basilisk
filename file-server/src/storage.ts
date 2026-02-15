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
    } else if (entry.name.startsWith(fileId)) {
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
