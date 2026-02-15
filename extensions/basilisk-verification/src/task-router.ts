import type { AgentType, JobDetails } from "./types.js";

const CODE_EXTENSIONS = [".zip", ".tar.gz", ".tgz", ".git", ".js", ".ts", ".py", ".go", ".rs", ".java", ".c", ".cpp"];
const VISUAL_EXTENSIONS = [".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".figma", ".psd", ".ai"];
const DOC_EXTENSIONS = [".md", ".pdf", ".docx", ".doc", ".txt", ".rst", ".html", ".yaml", ".yml", ".json"];

function getExtension(url: string): string {
  const pathname = new URL(url, "https://placeholder").pathname;
  const lastDot = pathname.lastIndexOf(".");
  return lastDot >= 0 ? pathname.slice(lastDot).toLowerCase() : "";
}

export function detectDeliverableType(job: any): AgentType {
  // If the job explicitly declares a type, use it
  const category = job.verificationContext?.parentJobCategory || job.category || job.deliverableType;
  if (category === "code" || category === "visual" || category === "docs") {
    return category;
  }

  // Try to get URL from various locations in the response
  const url = job.deliverableUrl
    || job.verificationContext?.deliverable?.url
    || "";

  if (url) {
    const ext = getExtension(url);

    // Check URL patterns
    if (url.includes("github.com") || url.includes("gitlab.com") || url.includes("bitbucket.org")) {
      return "code";
    }
    if (url.includes("figma.com") || url.includes("dribbble.com") || url.includes("behance.net")) {
      return "visual";
    }

    // Check file extension
    if (CODE_EXTENSIONS.some((e) => ext.endsWith(e))) return "code";
    if (VISUAL_EXTENSIONS.some((e) => ext === e)) return "visual";
    if (DOC_EXTENSIONS.some((e) => ext === e)) return "docs";
  }

  // Check criteria keywords
  const criteria = job.verificationContext?.acceptanceCriteria || job.acceptanceCriteria || [];
  if (criteria.length > 0) {
    const criteriaText = criteria.map((c: any) => (c.description || "").toLowerCase()).join(" ");
    if (criteriaText.includes("compile") || criteriaText.includes("test") || criteriaText.includes("build") || criteriaText.includes("code")) {
      return "code";
    }
    if (criteriaText.includes("design") || criteriaText.includes("ui") || criteriaText.includes("responsive") || criteriaText.includes("screenshot")) {
      return "visual";
    }
    if (criteriaText.includes("documentation") || criteriaText.includes("writing") || criteriaText.includes("content")) {
      return "docs";
    }
  }

  // Check description for hints
  const desc = (job.verificationContext?.parentJobDescription || job.description || "").toLowerCase();
  if (desc.includes("api") || desc.includes("code") || desc.includes("build") || desc.includes("typescript")) return "code";
  if (desc.includes("design") || desc.includes("ui") || desc.includes("figma")) return "visual";
  if (desc.includes("documentation") || desc.includes("writing")) return "docs";

  // Default to code — most capable agent
  return "code";
}

export function getAgentIdForType(agentType: AgentType): string {
  switch (agentType) {
    case "code":
      return "basilisk-validator-code";
    case "visual":
      return "basilisk-validator-visual";
    case "docs":
      return "basilisk-validator-docs";
  }
}
