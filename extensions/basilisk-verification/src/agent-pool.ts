import type { AgentType, PoolConfig } from "./types.js";

interface QueuedTask {
  taskId: string;
  jobId: string;
  agentType: AgentType;
  resolve: (slotId: string) => void;
}

export class AgentPool {
  private active: Map<string, { agentType: AgentType; startedAt: number }> = new Map();
  private queue: QueuedTask[] = [];
  private config: PoolConfig;

  constructor(config: PoolConfig) {
    this.config = config;
  }

  private countByType(agentType: AgentType): number {
    let count = 0;
    for (const [, slot] of this.active) {
      if (slot.agentType === agentType) count++;
    }
    return count;
  }

  async requestSlot(taskId: string, jobId: string, agentType: AgentType): Promise<string> {
    const typeCount = this.countByType(agentType);
    const typeMax = this.config.perAgentType[agentType].max;

    // If we have capacity for this agent type and total pool isn't full
    if (typeCount < typeMax && this.active.size < this.config.maxContainers) {
      const slotId = `${agentType}-${taskId}`;
      this.active.set(slotId, { agentType, startedAt: Date.now() });
      console.log(`[agent-pool] Assigned slot ${slotId} (${this.active.size}/${this.config.maxContainers} active)`);
      return slotId;
    }

    // Queue the task
    console.log(`[agent-pool] Pool full, queuing task ${taskId} (type: ${agentType})`);
    return new Promise<string>((resolve) => {
      this.queue.push({ taskId, jobId, agentType, resolve });
    });
  }

  releaseSlot(slotId: string) {
    this.active.delete(slotId);
    console.log(`[agent-pool] Released slot ${slotId} (${this.active.size}/${this.config.maxContainers} active)`);

    // Process queue
    if (this.queue.length > 0) {
      const next = this.queue.shift()!;
      const newSlotId = `${next.agentType}-${next.taskId}`;
      this.active.set(newSlotId, { agentType: next.agentType, startedAt: Date.now() });
      console.log(`[agent-pool] Dequeued task ${next.taskId}, assigned slot ${newSlotId}`);
      next.resolve(newSlotId);
    }
  }

  getStats() {
    return {
      active: this.active.size,
      maxContainers: this.config.maxContainers,
      queued: this.queue.length,
      byType: {
        code: this.countByType("code"),
        visual: this.countByType("visual"),
        docs: this.countByType("docs"),
      },
    };
  }
}
