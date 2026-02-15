import type { AnyAgentTool, OpenClawPluginApi } from "../../src/plugins/types.js";
import { BasiliskApiClient } from "./src/basilisk-api.js";
import { createClaimTaskTool } from "./src/tools/claim-task.js";
import { createAnalyzeDeliverableTool } from "./src/tools/analyze-deliverable.js";
import { createRunSandboxTool } from "./src/tools/run-sandbox.js";
import { createAnalyzeImagesTool } from "./src/tools/analyze-images.js";
import { createBrowserScreenshotTool } from "./src/tools/browser-screenshot.js";
import { createSubmitReportTool } from "./src/tools/submit-report.js";
import { startTaskPoller } from "./src/task-poller.js";

export default function register(api: OpenClawPluginApi) {
  const config = api.pluginConfig as {
    apiBase?: string;
    fileStoragePath?: string;
  };

  const apiBase = config.apiBase || process.env.BASILISK_API_BASE || "https://basilisk-api.fly.dev";
  const fileStoragePath = config.fileStoragePath || process.env.BASILISK_FILE_STORAGE || "D:/basilisk-files";

  const basiliskApi = new BasiliskApiClient(apiBase);

  // Register all verification tools
  api.registerTool(createClaimTaskTool(basiliskApi) as unknown as AnyAgentTool);
  api.registerTool(createAnalyzeDeliverableTool(fileStoragePath) as unknown as AnyAgentTool);
  api.registerTool(createRunSandboxTool() as unknown as AnyAgentTool);
  api.registerTool(createAnalyzeImagesTool() as unknown as AnyAgentTool);
  api.registerTool(createBrowserScreenshotTool(fileStoragePath) as unknown as AnyAgentTool);
  api.registerTool(createSubmitReportTool(basiliskApi) as unknown as AnyAgentTool);

  // Start background task poller as a service
  api.registerService({
    id: "basilisk-task-poller",
    start: () => startTaskPoller(api),
  });

  api.logger.info("Basilisk Verification extension loaded");
  api.logger.info(`API: ${apiBase}`);
  api.logger.info(`File storage: ${fileStoragePath}`);
}
