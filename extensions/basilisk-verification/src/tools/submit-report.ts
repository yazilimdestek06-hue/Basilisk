import { Type } from "@sinclair/typebox";
import type { BasiliskApiClient } from "../basilisk-api.js";
import type { VerificationReport } from "../types.js";

const json = (payload: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  details: payload,
});

export function createSubmitReportTool(api: BasiliskApiClient) {
  return {
    name: "submit_report",
    label: "Submit Verification Report",
    description: "Submit a structured verification report to the Basilisk platform for a claimed task.",
    parameters: Type.Object({
      taskId: Type.String({ description: "The verification task ID" }),
      report: Type.Object({
        overallPassed: Type.Boolean(),
        overallScore: Type.Number(),
        confidence: Type.Number(),
        summary: Type.String(),
        criteriaResults: Type.Array(
          Type.Object({
            criterionId: Type.String(),
            passed: Type.Boolean(),
            detail: Type.String(),
          }),
        ),
        flags: Type.Optional(Type.Array(Type.String())),
        recommendation: Type.Unsafe<"approve" | "reject" | "needs-revision">({
          type: "string",
          enum: ["approve", "reject", "needs-revision"],
        }),
      }, { description: "The verification report object" }),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const taskId = String(params.taskId);
      const report = params.report as VerificationReport["report"];

      if (!report.criteriaResults || report.criteriaResults.length === 0) {
        return json({ success: false, error: "Report must include at least one criterion result" });
      }
      if (report.overallScore < 0 || report.overallScore > 100) {
        return json({ success: false, error: "Overall score must be between 0 and 100" });
      }
      if (report.confidence < 0 || report.confidence > 1) {
        return json({ success: false, error: "Confidence must be between 0 and 1" });
      }

      const fullReport: VerificationReport = {
        verifierId: api.getAgentId(),
        report,
      };

      await api.submitReport(taskId, fullReport);

      return json({
        success: true,
        taskId,
        recommendation: report.recommendation,
        score: report.overallScore,
      });
    },
  };
}
