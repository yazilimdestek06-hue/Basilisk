import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import fs from "node:fs";
import { config } from "./config.js";
import presignRouter from "./routes/presign.js";
import uploadRouter from "./routes/upload.js";
import downloadRouter from "./routes/download.js";
import presignDownloadRouter from "./routes/presign-download.js";
import approveRouter from "./routes/approve.js";
import { startCleanupCron } from "./cleanup.js";

const app = express();

// CORS
app.use(
  cors({
    origin: config.corsOrigins,
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);

// JSON body parsing
app.use(express.json());

// Rate limiters
const uploadLimiter = rateLimit({
  windowMs: config.rateLimit.uploadWindowMs,
  max: config.rateLimit.uploadMax,
  message: { error: "Too many uploads, try again later" },
});

const downloadLimiter = rateLimit({
  windowMs: config.rateLimit.downloadWindowMs,
  max: config.rateLimit.downloadMax,
  message: { error: "Too many downloads, try again later" },
});

// Routes
app.use(uploadLimiter, presignRouter);
app.use(uploadLimiter, uploadRouter);
app.use(downloadLimiter, downloadRouter);
app.use(downloadLimiter, presignDownloadRouter);
app.use(approveRouter);

// Health check
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    storage: config.storagePath,
    uptime: process.uptime(),
  });
});

// Ensure storage directories exist
fs.mkdirSync(config.storagePath, { recursive: true });
fs.mkdirSync(`${config.storagePath}/_tmp`, { recursive: true });

// Start cleanup cron
startCleanupCron();

app.listen(config.port, () => {
  console.log(`[file-server] Listening on port ${config.port}`);
  console.log(`[file-server] Storage: ${config.storagePath}`);
});
