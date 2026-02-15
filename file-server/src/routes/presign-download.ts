import { Router, type Router as RouterType } from "express";
import { config } from "../config.js";
import { generateDownloadSignature } from "../security.js";
import { findFileById } from "../storage.js";

const router: RouterType = Router();

router.post("/presign-download", (req, res) => {
  const { fileId } = req.body as { fileId?: string };

  if (!fileId) {
    res.status(400).json({ error: "Missing required field: fileId" });
    return;
  }

  // Verify the file actually exists before signing
  const filePath = findFileById(fileId);
  if (!filePath) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  const expiresAt = Date.now() + config.downloadTokenExpiryMs;
  const sig = generateDownloadSignature(fileId, expiresAt);

  const downloadUrl = `/files/${fileId}?sig=${sig}&exp=${expiresAt}`;

  res.json({
    downloadUrl,
    fileId,
    expiresAt: new Date(expiresAt).toISOString(),
  });
});

export default router;
