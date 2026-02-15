import { Router, type Router as RouterType } from "express";
import fs from "node:fs";
import { findFileById, getFileMeta } from "../storage.js";

const router: RouterType = Router();

router.get("/files/:fileId", (req, res) => {
  const { fileId } = req.params;

  // Prevent path traversal
  if (fileId.includes("..") || fileId.includes("/") || fileId.includes("\\")) {
    res.status(400).json({ error: "Invalid file ID" });
    return;
  }

  const filePath = findFileById(fileId);
  if (!filePath) {
    res.status(404).json({ error: "File not found" });
    return;
  }

  const meta = getFileMeta(filePath);
  const fileSize = meta.size;

  res.setHeader("Content-Type", meta.contentType);
  res.setHeader("Content-Disposition", `attachment; filename="${meta.filename}"`);
  res.setHeader("Accept-Ranges", "bytes");

  // Handle Range requests
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

    if (start >= fileSize || end >= fileSize || start > end) {
      res.status(416).setHeader("Content-Range", `bytes */${fileSize}`);
      res.end();
      return;
    }

    res.status(206);
    res.setHeader("Content-Range", `bytes ${start}-${end}/${fileSize}`);
    res.setHeader("Content-Length", end - start + 1);
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.setHeader("Content-Length", fileSize);
    fs.createReadStream(filePath).pipe(res);
  }
});

export default router;
