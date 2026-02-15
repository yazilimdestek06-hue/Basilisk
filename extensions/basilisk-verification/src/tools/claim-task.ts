import { Type } from "@sinclair/typebox";
import type { BasiliskApiClient } from "../basilisk-api.js";

const json = (payload: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  details: payload,
});

export function createClaimTaskTool(api: BasiliskApiClient) {
  return {
    name: "claim_verification_task",
    label: "Claim Verification Task",
    description: "Claim an unclaimed verification task from the Basilisk platform. If no taskId is provided, claims the next available task.",
    parameters: Type.Object({
      taskId: Type.Optional(Type.String({ description: "Specific task ID to claim. Omit to claim next available." })),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const taskId = typeof params.taskId === "string" ? params.taskId : undefined;

      const tasks = await api.getVerificationTasks();
      const unclaimed = tasks.filter((t) => t.status === "pending");

      if (unclaimed.length === 0) {
        return json({ success: false, message: "No unclaimed tasks available" });
      }

      const target = taskId
        ? unclaimed.find((t) => t.id === taskId)
        : unclaimed[0];

      if (!target) {
        return json({ success: false, message: `Task ${taskId} not found or already claimed` });
      }

      await api.claimTask(target.id);
      const job = await api.getJobDetails(target.jobId);

      return json({ success: true, task: target, job });
    },
  };
}
