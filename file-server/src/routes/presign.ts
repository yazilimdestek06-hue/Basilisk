import { Router, type Router as RouterType } from "express";
import { v4 as uuidv4 } from "uuid";
import path from "node:path";
import { config } from "../config.js";
import { generatePresignToken, generateDownloadSignature, sanitizeFilename } from "../security.js";

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

  // Also generate a download URL (valid for downloadTokenExpiryMs)
  const dlExpiresAt = Date.now() + config.downloadTokenExpiryMs;
  const dlSig = generateDownloadSignature(fileId, dlExpiresAt);

  res.json({
    uploadUrl: `/upload?token=${token}`,
    downloadUrl: `/files/${fileId}?sig=${dlSig}&exp=${dlExpiresAt}`,
    fileId,
    expiresAt: new Date(expiresAt).toISOString(),
    downloadExpiresAt: new Date(dlExpiresAt).toISOString(),
  });
});

export default router;
