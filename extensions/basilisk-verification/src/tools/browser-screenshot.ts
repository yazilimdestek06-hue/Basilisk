import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { Type } from "@sinclair/typebox";

const json = (payload: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  details: payload,
});

export function createBrowserScreenshotTool(fileStoragePath: string) {
  return {
    name: "browser_screenshot",
    label: "Browser Screenshot",
    description: "Take a screenshot of a URL using a headless Chromium browser in a Docker sandbox. Useful for visual verification of deployed websites.",
    parameters: Type.Object({
      url: Type.String({ description: "URL to screenshot" }),
      viewportWidth: Type.Optional(Type.Number({ description: "Viewport width in pixels (default 1920)" })),
      viewportHeight: Type.Optional(Type.Number({ description: "Viewport height in pixels (default 1080)" })),
      fullPage: Type.Optional(Type.Boolean({ description: "Capture full scrollable page (default false)" })),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const url = String(params.url);
      const viewportWidth = typeof params.viewportWidth === "number" ? params.viewportWidth : 1920;
      const viewportHeight = typeof params.viewportHeight === "number" ? params.viewportHeight : 1080;
      const fullPage = params.fullPage === true;

      const outputDir = path.join(fileStoragePath, "_tmp", `screenshot-${Date.now()}`);
      fs.mkdirSync(outputDir, { recursive: true });
      const outputFile = path.join(outputDir, "screenshot.png");

      const script = `
        const { chromium } = require('playwright-core');
        (async () => {
          const browser = await chromium.launch({ headless: true });
          const page = await browser.newPage({ viewport: { width: ${viewportWidth}, height: ${viewportHeight} } });
          await page.goto('${url.replace(/'/g, "\\'")}', { waitUntil: 'networkidle', timeout: 30000 });
          await page.screenshot({ path: '/output/screenshot.png', fullPage: ${fullPage} });
          await browser.close();
        })();
      `;

      try {
        execSync([
          "docker", "run",
          "--rm",
          "--memory=2g",
          "--cpus=2",
          `-v=${outputDir}:/output`,
          "openclaw-sandbox-browser:local",
          "node", "-e", JSON.stringify(script),
        ].join(" "), {
          timeout: 45000,
          encoding: "utf-8",
        });

        if (fs.existsSync(outputFile)) {
          return json({
            success: true,
            screenshotPath: outputFile,
            url,
            viewport: { width: viewportWidth, height: viewportHeight },
            fullPage,
          });
        }

        return json({ success: false, error: "Screenshot file was not created" });
      } catch (err: unknown) {
        const execErr = err as { stderr?: string };
        return json({
          success: false,
          error: `Screenshot failed: ${String(execErr.stderr || err).slice(0, 1000)}`,
        });
      }
    },
  };
}
