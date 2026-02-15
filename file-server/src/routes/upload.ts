import { Router, type Router as RouterType } from "express";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import multer from "multer";
import { config } from "../config.js";
import { verifyPresignToken } from "../security.js";
import { resolveStoragePath } from "../storage.js";

const upload = multer({
  dest: path.join(config.storagePath, "_tmp"),
  limits: { fileSize: config.maxFileSizeMb * 1024 * 1024 },
});

const router: RouterType = Router();

router.post("/upload", upload.single("file"), (req, res) => {
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

  // Verify SHA-256 hash
  const fileBuffer = fs.readFileSync(req.file.path);
  const actualHash = createHash("sha256").update(fileBuffer).digest("hex");

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

  res.json({
    fileId: payload.fileId,
    size: fileBuffer.length,
    sha256: actualHash,
    path: destPath,
  });
});

export default router;
