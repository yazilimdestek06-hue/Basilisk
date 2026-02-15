import fs from "node:fs";
import path from "node:path";
import { Type } from "@sinclair/typebox";

const json = (payload: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  details: payload,
});

export function createAnalyzeDeliverableTool(fileStoragePath: string) {
  return {
    name: "analyze_deliverable",
    label: "Analyze Deliverable",
    description: "Download or locate a deliverable file and analyze it against acceptance criteria. Detects deliverable type (code, visual, docs) and returns analysis strategy.",
    parameters: Type.Object({
      jobId: Type.String({ description: "Job ID" }),
      deliverableUrl: Type.String({ description: "URL or local path of the deliverable" }),
      acceptanceCriteria: Type.Array(
        Type.Object({
          id: Type.String(),
          description: Type.String(),
        }),
        { description: "List of acceptance criteria to evaluate" },
      ),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const jobId = String(params.jobId);
      const deliverableUrl = String(params.deliverableUrl);
      const acceptanceCriteria = params.acceptanceCriteria as Array<{ id: string; description: string }>;
      let localPath: string | null = null;

      // Check if deliverable is on local file server
      const localMatch = deliverableUrl.match(/\/files\/([a-f0-9-]+)/);
      if (localMatch) {
        const fileId = localMatch[1];
        const searchPath = findLocalFile(fileStoragePath, fileId);
        if (searchPath) {
          localPath = searchPath;
        }
      }

      // If not local, it's an external URL
      if (!localPath && (deliverableUrl.startsWith("http://") || deliverableUrl.startsWith("https://"))) {
        const tmpDir = path.join(fileStoragePath, "_tmp", jobId);
        fs.mkdirSync(tmpDir, { recursive: true });
        const tmpFile = path.join(tmpDir, `deliverable-${Date.now()}`);

        const res = await fetch(deliverableUrl);
        if (!res.ok) {
          return json({ success: false, error: `Failed to download: ${res.status}` });
        }
        const buffer = Buffer.from(await res.arrayBuffer());
        fs.writeFileSync(tmpFile, buffer);
        localPath = tmpFile;
      }

      if (!localPath) {
        return json({ success: false, error: "Could not locate deliverable" });
      }

      const ext = path.extname(localPath).toLowerCase();
      const stat = fs.statSync(localPath);

      return json({
        success: true,
        localPath,
        size: stat.size,
        extension: ext,
        criteriaCount: acceptanceCriteria.length,
        criteria: acceptanceCriteria,
      });
    },
  };
}

function findLocalFile(storagePath: string, fileId: string): string | null {
  if (!fs.existsSync(storagePath)) return null;
  const entries = fs.readdirSync(storagePath, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(storagePath, entry.name);
    if (entry.name === "_tmp") continue;
    if (entry.isDirectory()) {
      const found = findLocalFile(full, fileId);
      if (found) return found;
    } else if (entry.name.startsWith(fileId)) {
      return full;
    }
  }
  return null;
}
