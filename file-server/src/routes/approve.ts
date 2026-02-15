import { Router, type Router as RouterType } from "express";
import { config } from "../config.js";
import { verifyInternalAuth } from "../security.js";
import { findFileById, markFileApproved } from "../storage.js";

const router: RouterType = Router();

router.post("/files/:fileId/approve", (req, res) => {
  // Only internal services (task poller, Basilisk API) can call this
  if (!verifyInternalAuth(req.headers.authorization)) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { fileId } = req.params;

  const filePath = findFileById(fileId);
  if (!filePath) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  const marked = markFileApproved(filePath);
  if (!marked) {
    res.status(500).json({ error: "Could not mark file as approved (missing metadata)" });
    return;
  }

  console.log(`[approve] File ${fileId} marked as approved — will be deleted in 48h`);
  res.json({ fileId, approved: true });
});

export default router;
