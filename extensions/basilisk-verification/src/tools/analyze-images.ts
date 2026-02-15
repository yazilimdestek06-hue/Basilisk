import fs from "node:fs";
import { Type } from "@sinclair/typebox";

const json = (payload: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  details: payload,
});

export function createAnalyzeImagesTool() {
  return {
    name: "analyze_images",
    label: "Analyze Images",
    description: "Analyze images using Claude's multimodal capabilities. Evaluates visual deliverables against acceptance criteria for UI quality, layout, responsiveness, and design accuracy.",
    parameters: Type.Object({
      imagePaths: Type.Array(Type.String(), { description: "Local file paths to images to analyze" }),
      criteria: Type.Array(Type.String(), { description: "Acceptance criteria to evaluate each image against" }),
      context: Type.Optional(Type.String({ description: "Additional context about what the images should show" })),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const imagePaths = params.imagePaths as string[];
      const criteria = params.criteria as string[];
      const context = typeof params.context === "string" ? params.context : undefined;

      const validImages: Array<{ path: string; base64: string; mimeType: string }> = [];
      for (const imgPath of imagePaths) {
        if (!fs.existsSync(imgPath)) continue;
        const buffer = fs.readFileSync(imgPath);
        const ext = imgPath.split(".").pop()?.toLowerCase();
        const mimeMap: Record<string, string> = {
          png: "image/png",
          jpg: "image/jpeg",
          jpeg: "image/jpeg",
          gif: "image/gif",
          webp: "image/webp",
        };
        validImages.push({
          path: imgPath,
          base64: buffer.toString("base64"),
          mimeType: mimeMap[ext || ""] || "image/png",
        });
      }

      if (validImages.length === 0) {
        return json({ success: false, error: "No valid images found at provided paths" });
      }

      return json({
        success: true,
        imageCount: validImages.length,
        images: validImages.map((img) => ({
          path: img.path,
          mimeType: img.mimeType,
          sizeBytes: Buffer.from(img.base64, "base64").length,
        })),
        criteria,
        context: context || "Evaluate these images against the provided criteria",
        instruction: "Use your multimodal capabilities to analyze each image against the criteria. For each criterion, provide a pass/fail assessment with detailed explanation.",
      });
    },
  };
}
