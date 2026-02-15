import { Router, type Router as RouterType } from "express";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { config } from "../config.js";
import { verifyPresignToken } from "../security.js";
import { resolveStoragePath, writeFileMeta, indexFile } from "../storage.js";

const upload = multer({
  dest: path.join(config.storagePath, "_tmp"),
  limits: { fileSize: config.maxFileSizeBytes },
});

const router: RouterType = Router();

/** Compute SHA-256 via streaming (no full-file memory load). */
function streamSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

router.post("/upload", upload.single("file"), async (req, res) => {
  const token = req.query.token as string;
  if (!token) {
    res.status(400).json({ error: "Missing presign token" });
    return;
  }

  const payload = verifyPresignToken(token);
  if (!payload) {
    res.status(403).json({ error: "Invalid or expired presign token" });
    return;
  }

  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  // Verify SHA-256 hash via stream (works for files of any size)
  const actualHash = await streamSha256(req.file.path);

  if (actualHash !== payload.sha256) {
    fs.unlinkSync(req.file.path);
    res.status(400).json({
      error: "SHA-256 hash mismatch",
      expected: payload.sha256,
      actual: actualHash,
    });
    return;
  }

  // Move to permanent storage
  const ext = path.extname(payload.filename);
  const destPath = resolveStoragePath(payload.jobId, payload.fileId, ext);
  fs.renameSync(req.file.path, destPath);

  const fileSize = fs.statSync(destPath).size;

  // Register in index and write sidecar metadata
  indexFile(payload.fileId, destPath);
  writeFileMeta(destPath, {
    fileId: payload.fileId,
    jobId: payload.jobId,
    filename: payload.filename,
    sha256: actualHash,
    size: fileSize,
    uploadedAt: Date.now(),
  });

  res.json({
    fileId: payload.fileId,
    size: fileSize,
    sha256: actualHash,
  });
});

export default router;
