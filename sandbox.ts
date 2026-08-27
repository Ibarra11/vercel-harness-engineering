import { createJustBashSandbox } from "./sandbox-just-bash.js";
import { createLocalSandbox } from "./sandbox-local.js";

export interface Sandbox {
  type: string;
  workingDirectory: string;
  readFile(path: string): Promise<string>;
  exec(command: string): Promise<{ stdout: string; exitCode: number }>;
  stop(): Promise<void>;
  expiresAt?: number;
  snapshot?(): Promise<{ snapshotId: string }>;
}

export interface SandboxLifecycle {
  afterStart?(sandbox: Sandbox): Promise<void>;
  beforeStop?(sandbox: Sandbox): Promise<void>;
  onTimeout?(sandbox: Sandbox): Promise<void>;
}

const sandboxType = process.env.SANDBOX || "local";

export async function createSandboxByEnv(cwd: string) {
  return sandboxType === "just-bash"
    ? await createJustBashSandbox(cwd)
    : createLocalSandbox(cwd);
}
