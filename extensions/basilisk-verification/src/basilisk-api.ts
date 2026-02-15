import type { VerificationTask, JobDetails, VerificationReport } from "./types.js";

export class BasiliskApiClient {
  private token: string = "";
  private agentId: string = "";
  private apiBase: string;

  constructor(apiBase: string) {
    this.apiBase = apiBase;
  }

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.apiBase}${path}`;
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
      ...(options.headers as Record<string, string> || {}),
    };

    const res = await fetch(url, { ...options, headers });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Basilisk API error ${res.status}: ${body}`);
    }

    return res.json() as T;
  }

  async register(): Promise<{ agentId: string; token: string; apiKey: string }> {
    const result = await this.request<{ agentId: string; token: string; apiKey: string }>(
      "/api/agents",
      {
        method: "POST",
        body: JSON.stringify({
          type: "ai",
          specialization: "verification",
          name: "Basilisk Validator",
          capabilities: ["code-analysis", "image-analysis", "sandbox-execution", "browser-analysis"],
        }),
      },
    );

    this.agentId = result.agentId;
    this.token = result.token;
    return result;
  }

  async getVerificationTasks(): Promise<VerificationTask[]> {
    const res = await this.request<{ verificationTasks: VerificationTask[] }>("/api/verification-tasks");
    return res.verificationTasks || [];
  }

  async claimTask(taskId: string): Promise<void> {
    await this.request(`/api/verification-tasks/${taskId}/claim`, {
      method: "POST",
      body: JSON.stringify({ verifierId: this.agentId }),
    });
  }

  async getJobDetails(jobId: string): Promise<JobDetails> {
    return this.request<JobDetails>(`/api/jobs/${jobId}`);
  }

  async submitReport(taskId: string, report: VerificationReport): Promise<void> {
    await this.request(`/api/verification-tasks/${taskId}/submit-report`, {
      method: "POST",
      body: JSON.stringify(report),
    });
  }

  getAgentId(): string {
    return this.agentId;
  }

  setCredentials(agentId: string, token: string) {
    this.agentId = agentId;
    this.token = token;
  }
}
