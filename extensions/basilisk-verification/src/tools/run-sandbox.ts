import { execSync } from "node:child_process";
import { Type } from "@sinclair/typebox";

const json = (payload: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  details: payload,
});

export function createRunSandboxTool() {
  return {
    name: "run_code_sandbox",
    label: "Run Code Sandbox",
    description: "Execute code in an isolated Docker sandbox container. Runs test commands against deliverable code with network disabled, memory limited to 2GB, and 60s timeout.",
    parameters: Type.Object({
      codePath: Type.String({ description: "Local path to the code directory to mount" }),
      testCommands: Type.Array(Type.String(), { description: "Shell commands to execute in order" }),
      language: Type.Optional(Type.String({ description: "Primary language: node, python, go, rust" })),
      timeoutSec: Type.Optional(Type.Number({ description: "Timeout in seconds (default 60)" })),
    }),
    async execute(_id: string, params: Record<string, unknown>) {
      const codePath = String(params.codePath);
      const testCommands = params.testCommands as string[];
      const timeoutSec = typeof params.timeoutSec === "number" ? params.timeoutSec : 60;
      const results: Array<{ command: string; exitCode: number; stdout: string; stderr: string }> = [];
      let timedOut = false;

      const containerName = `basilisk-sandbox-${Date.now()}`;
      const timeoutMs = timeoutSec * 1000;

      for (const cmd of testCommands) {
        try {
          const dockerCmd = [
            "docker", "run",
            "--rm",
            `--name=${containerName}`,
            "--memory=2g",
            "--cpus=2",
            "--network=none",
            "--read-only",
            "--tmpfs=/tmp:rw,size=512m",
            `-v=${codePath}:/workspace:ro`,
            "-w=/workspace",
            "openclaw-sandbox:local",
            "bash", "-c", cmd,
          ].join(" ");

          const stdout = execSync(dockerCmd, {
            timeout: timeoutMs,
            encoding: "utf-8",
            maxBuffer: 10 * 1024 * 1024,
          });

          results.push({ command: cmd, exitCode: 0, stdout: stdout.slice(0, 5000), stderr: "" });
        } catch (err: unknown) {
          const execErr = err as { status?: number; stdout?: string; stderr?: string; killed?: boolean };
          if (execErr.killed) {
            timedOut = true;
            results.push({
              command: cmd,
              exitCode: -1,
              stdout: String(execErr.stdout || "").slice(0, 5000),
              stderr: `TIMEOUT: Command exceeded ${timeoutSec}s limit`,
            });
            try { execSync(`docker rm -f ${containerName}`, { encoding: "utf-8" }); } catch {}
            break;
          }

          results.push({
            command: cmd,
            exitCode: execErr.status ?? 1,
            stdout: String(execErr.stdout || "").slice(0, 5000),
            stderr: String(execErr.stderr || "").slice(0, 5000),
          });
        }
      }

      return json({ results, timedOut });
    },
  };
}
