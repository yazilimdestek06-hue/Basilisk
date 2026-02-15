import { Router, type Router as RouterType } from "express";
import { v4 as uuidv4 } from "uuid";
import path from "node:path";
import { config } from "../config.js";
import { generatePresignToken, sanitizeFilename } from "../security.js";

const router: RouterType = Router();

router.post("/presign", (req, res) => {
  const { jobId, filename, sha256 } = req.body as {
    jobId?: string;
    filename?: string;
    sha256?: string;
  };

  if (!jobId || !filename || !sha256) {
    res.status(400).json({ error: "Missing required fields: jobId, filename, sha256" });
    return;
  }

  const fileId = uuidv4();
  const ext = path.extname(sanitizeFilename(filename));
  const expiresAt = Date.now() + config.presignExpiryMs;

  const token = generatePresignToken({ fileId, jobId, filename: sanitizeFilename(filename), sha256, expiresAt });

  res.json({
    uploadUrl: `/upload?token=${token}`,
    fileId,
    expiresAt: new Date(expiresAt).toISOString(),
  });
});

export default router;
