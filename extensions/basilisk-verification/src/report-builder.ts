import type { CriterionResult, VerificationReport } from "./types.js";

export function buildReport(params: {
  verifierId: string;
  criteriaResults: CriterionResult[];
  summary: string;
  flags?: string[];
}): VerificationReport {
  const { verifierId, criteriaResults, summary, flags = [] } = params;

  const totalCriteria = criteriaResults.length;
  const passedCriteria = criteriaResults.filter((c) => c.passed).length;
  const overallPassed = passedCriteria === totalCriteria;
  const overallScore = totalCriteria > 0 ? Math.round((passedCriteria / totalCriteria) * 100) : 0;

  // Confidence based on how many criteria we could actually evaluate
  const evaluatedCount = criteriaResults.filter((c) => c.detail && c.detail.length > 10).length;
  const confidence = totalCriteria > 0 ? Math.round((evaluatedCount / totalCriteria) * 100) / 100 : 0;

  let recommendation: "approve" | "reject" | "needs-revision";
  if (overallScore >= 80 && overallPassed) {
    recommendation = "approve";
  } else if (overallScore >= 50) {
    recommendation = "needs-revision";
  } else {
    recommendation = "reject";
  }

  return {
    verifierId,
    report: {
      overallPassed,
      overallScore,
      confidence,
      summary,
      criteriaResults,
      flags,
      recommendation,
    },
  };
}
