import { randomBytes } from "node:crypto";
import dotenv from "dotenv";
import path from "node:path";

dotenv.config({ path: path.resolve(import.meta.dirname, "../../.env") });

export const config = {
  port: parseInt(process.env.FILE_SERVER_PORT || "4000", 10),
  storagePath: process.env.BASILISK_FILE_STORAGE || "D:/basilisk-files",
  hmacSecret: process.env.FILE_SERVER_HMAC_SECRET || randomBytes(32).toString("hex"),
  corsOrigins: [
    /\.basilisk\.exchange$/,
    "https://basilisk.exchange",
    "http://localhost:3000",
  ] as (string | RegExp)[],
  maxFileSizeBytes: 5 * 1024 * 1024 * 1024, // 5 GB
  presignExpiryMs: 60 * 60 * 1000, // 1 hour
  downloadTokenExpiryMs: 60 * 60 * 1000, // 1 hour
  cleanupMaxAgeDays: 90,
  approvedFileRetentionMs: 48 * 60 * 60 * 1000, // 48 hours after approval
  rateLimit: {
    uploadWindowMs: 60 * 1000,
    uploadMax: 10,
    downloadWindowMs: 60 * 1000,
    downloadMax: 30,
  },
} as const;
