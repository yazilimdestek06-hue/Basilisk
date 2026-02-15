import type { AgentType } from "./types.js";

const TIMEOUT_BY_TYPE: Record<AgentType, number> = {
  code: 600_000,   // 10 minutes
  visual: 300_000, // 5 minutes
  docs: 180_000,   // 3 minutes
};

export interface GatewayDispatchResult {
  content: string;
  runId: string;
}

export class GatewayHttpClient {
  private baseUrl: string;
  private token: string;

  constructor(baseUrl: string, token: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.token = token;
  }

  /**
   * Dispatch a verification prompt to a specific agent via the OpenAI-compatible
   * HTTP endpoint. The agent will use its registered tools (analyze_deliverable,
   * run_code_sandbox, submit_report, etc.) to process the task autonomously.
   */
  async dispatch(
    agentId: string,
    sessionKey: string,
    prompt: string,
    agentType: AgentType,
  ): Promise<GatewayDispatchResult> {
    const timeoutMs = TIMEOUT_BY_TYPE[agentType];
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.token}`,
          "X-OpenClaw-Agent-Id": agentId,
          "X-OpenClaw-Session-Key": sessionKey,
        },
        body: JSON.stringify({
          model: "openclaw",
          stream: false,
          messages: [{ role: "user", content: prompt }],
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Gateway HTTP ${res.status}: ${body}`);
      }

      const data = (await res.json()) as {
        id?: string;
        choices?: Array<{ message?: { content?: string } }>;
      };

      const content = data.choices?.[0]?.message?.content ?? "";
      const runId = data.id ?? "";

      return { content, runId };
    } finally {
      clearTimeout(timer);
    }
  }
}
