export interface VerificationTask {
  id: string;
  jobId: string;
  status: "pending" | "claimed" | "completed" | "failed";
  verifierId?: string;
  createdAt: string;
}

export interface JobDetails {
  id: string;
  title: string;
  description: string;
  deliverableUrl: string;
  deliverableType?: "code" | "visual" | "docs" | "mixed";
  acceptanceCriteria: CriterionDef[];
  createdAt: string;
}

export interface CriterionDef {
  id: string;
  description: string;
  weight?: number;
}

export interface CriterionResult {
  criterionId: string;
  passed: boolean;
  detail: string;
  score?: number;
}

export interface VerificationReport {
  verifierId: string;
  report: {
    overallPassed: boolean;
    overallScore: number;
    confidence: number;
    summary: string;
    criteriaResults: CriterionResult[];
    flags: string[];
    recommendation: "approve" | "reject" | "needs-revision";
  };
}

export type AgentType = "code" | "visual" | "docs";

export interface PoolConfig {
  maxContainers: number;
  perAgentType: Record<AgentType, { min: number; max: number }>;
  idleTimeoutMs: number;
}
