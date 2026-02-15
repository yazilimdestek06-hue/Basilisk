import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config.js";

interface PresignPayload {
  fileId: string;
  jobId: string;
  filename: string;
  sha256: string;
  expiresAt: number;
}

export function generatePresignToken(payload: PresignPayload): string {
  const data = JSON.stringify(payload);
  const encoded = Buffer.from(data).toString("base64url");
  const sig = createHmac("sha256", config.hmacSecret).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

export function verifyPresignToken(token: string): PresignPayload | null {
  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [encoded, sig] = parts;
  const expectedSig = createHmac("sha256", config.hmacSecret).update(encoded).digest("base64url");

  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))) {
    return null;
  }

  try {
    const payload: PresignPayload = JSON.parse(Buffer.from(encoded, "base64url").toString());
    if (Date.now() > payload.expiresAt) return null;
    return payload;
  } catch {
    return null;
  }
}

// --- Download signature (lightweight: HMAC over fileId + expiry) ---

export function generateDownloadSignature(fileId: string, expiresAt: number): string {
  const data = `${fileId}:${expiresAt}`;
  return createHmac("sha256", config.hmacSecret).update(data).digest("base64url");
}

export function verifyDownloadSignature(fileId: string, sig: string, exp: number): boolean {
  if (Date.now() > exp) return false;

  const expectedSig = createHmac("sha256", config.hmacSecret).update(`${fileId}:${exp}`).digest("base64url");

  try {
    return timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig));
  } catch {
    return false;
  }
}

export function sanitizeFilename(name: string): string {
  return name
    .replace(/\.\./g, "")
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 255);
}
