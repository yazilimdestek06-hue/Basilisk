import type { OpenClawPluginApi } from "../../src/plugins/types.js";
import type { AgentType } from "./types.js";
import { BasiliskApiClient } from "./basilisk-api.js";
import { AgentPool } from "./agent-pool.js";
import { GatewayHttpClient } from "./gateway-client.js";
import { detectDeliverableType, getAgentIdForType } from "./task-router.js";

const MAX_RETRIES = 3;
const DEFAULT_GATEWAY_URL = "http://127.0.0.1:18789";

export async function startTaskPoller(pluginApi: OpenClawPluginApi) {
  const config = pluginApi.pluginConfig as {
    apiBase?: string;
    fileStoragePath?: string;
    pollIntervalMs?: number;
    maxConcurrentJobs?: number;
    gatewayUrl?: string;
    gatewayToken?: string;
  };

  const apiBase = config.apiBase || process.env.BASILISK_API_BASE || "https://basilisk-api.fly.dev";
  const pollInterval = config.pollIntervalMs || 30000;
  const maxJobs = config.maxConcurrentJobs || 8;

  const gatewayUrl = config.gatewayUrl || process.env.OPENCLAW_GATEWAY_URL || DEFAULT_GATEWAY_URL;
  const gatewayToken = config.gatewayToken || process.env.OPENCLAW_GATEWAY_TOKEN || "";
  if (!gatewayToken) {
    console.error("[task-poller] No gateway token found (set gatewayToken in plugin config or OPENCLAW_GATEWAY_TOKEN env)");
  }

  const api = new BasiliskApiClient(apiBase);
  const gateway = new GatewayHttpClient(gatewayUrl, gatewayToken);
  const pool = new AgentPool({
    maxContainers: maxJobs,
    perAgentType: {
      code: { min: 1, max: 4 },
      visual: { min: 1, max: 3 },
      docs: { min: 0, max: 2 },
    },
    idleTimeoutMs: 300000,
  });

  // Register or restore credentials
  const existingAgentId = process.env.BASILISK_AGENT_ID;
  const existingToken = process.env.BASILISK_JWT_TOKEN;

  if (existingAgentId && existingToken) {
    api.setCredentials(existingAgentId, existingToken);
    console.log(`[task-poller] Using existing credentials: agent=${existingAgentId}`);
  } else {
    console.log("[task-poller] Registering as new agent...");
    const creds = await api.register();
    console.log(`[task-poller] Registered: agent=${creds.agentId}`);
  }

  const retryCount = new Map<string, number>();

  async function pollOnce() {
    try {
      const tasks = await api.getVerificationTasks();
      const unclaimed = tasks.filter((t) => t.status === "open" || t.status === "pending");

      if (unclaimed.length === 0) return;

      console.log(`[task-poller] Found ${unclaimed.length} unclaimed tasks`);

      for (const task of unclaimed) {
        // Skip tasks that have exceeded retries
        if ((retryCount.get(task.id) || 0) >= MAX_RETRIES) continue;

        processTask(task).catch((err) => {
          console.error(`[task-poller] Error processing task ${task.id}:`, err);
          retryCount.set(task.id, (retryCount.get(task.id) || 0) + 1);
        });
      }
    } catch (err) {
      console.error("[task-poller] Poll error:", err);
    }
  }

  async function processTask(task: any) {
    const taskId = task.id;
    const ctx = task.verificationContext || {};
    const jobId = ctx.parentJobId || task.parentJobId || task.jobId || taskId;

    // Claim the task
    await api.claimTask(taskId);
    console.log(`[task-poller] Claimed task ${taskId}`);

    // Route to best agent type using task data directly
    const agentType = detectDeliverableType(task);
    const agentId = getAgentIdForType(agentType);
    console.log(`[task-poller] Task ${taskId} → ${agentType} agent (${agentId})`);

    // Request a pool slot
    const slotId = await pool.requestSlot(taskId, jobId, agentType);

    try {
      // Build job-like object from task data for prompt
      const jobData = {
        title: ctx.parentJobTitle || task.title,
        description: ctx.parentJobDescription || task.description,
        deliverableUrl: ctx.deliverable?.url || task.deliverableUrl || "N/A",
        acceptanceCriteria: ctx.acceptanceCriteria || [],
      };

      const prompt = buildAgentPrompt(taskId, jobData as any, agentType);
      const sessionKey = `verify:${taskId}`;

      console.log(`[task-poller] Dispatching task ${taskId} via HTTP API → ${agentId} (slot: ${slotId})`);
      console.log(`[task-poller] Job: ${jobData.title}`);
      console.log(`[task-poller] Criteria: ${jobData.acceptanceCriteria.length}`);
      console.log(`[task-poller] Deliverable: ${jobData.deliverableUrl}`);

      const result = await gateway.dispatch(agentId, sessionKey, prompt, agentType);
      console.log(`[task-poller] Task ${taskId} completed successfully (run: ${result.runId}, response: ${result.content.length} chars)`);
    } finally {
      pool.releaseSlot(slotId);
    }
  }

  function buildAgentPrompt(taskId: string, job: import("./types.js").JobDetails, agentType: AgentType): string {
    const criteriaList = job.acceptanceCriteria
      .map((c, i) => `${i + 1}. [${c.id}] ${c.description}`)
      .join("\n");

    const typeInstructions: Record<AgentType, string> = {
      code: `2. Use \`run_code_sandbox\` to compile, run tests, and verify the code works
3. Check for build errors, test failures, code quality issues, and security concerns`,
      visual: `2. Use \`browser_screenshot\` to render the deliverable in a browser
3. Use \`analyze_images\` to compare screenshots against design requirements
4. Check responsive layout, color accuracy, and visual consistency`,
      docs: `2. Read and evaluate the documentation content for completeness and accuracy
3. Check grammar, structure, formatting, and technical correctness`,
    };

    return `You have been assigned verification task ${taskId}.

## Job: ${job.title}
${job.description}

## Deliverable
URL: ${job.deliverableUrl}

## Acceptance Criteria
${criteriaList}

## Instructions
1. Use \`analyze_deliverable\` to download and inspect the deliverable
${typeInstructions[agentType]}
4. Evaluate each acceptance criterion individually with specific evidence
5. Use \`submit_report\` to submit your structured verification report

Be thorough. Check every criterion. Provide specific evidence for each pass/fail.`;
  }

  // Start polling loop
  console.log(`[task-poller] Starting poll loop (interval: ${pollInterval}ms, max jobs: ${maxJobs})`);
  console.log(`[task-poller] Pool stats:`, pool.getStats());

  const intervalId = setInterval(pollOnce, pollInterval);
  pollOnce(); // Run immediately on start

  // Return cleanup function
  return () => {
    clearInterval(intervalId);
    console.log("[task-poller] Stopped");
  };
}
