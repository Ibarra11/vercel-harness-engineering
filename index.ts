import { ToolLoopAgent, stepCountIs, tool } from "ai";
import { z } from "zod";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildSystemPrompt } from "./system.js";
import {
  createSandboxByEnv,
  SandboxLifecycle,
  type Sandbox,
} from "./sandbox.ts";

const cwd = resolve(process.argv[2] || process.cwd());

const agentsPath = join(cwd, "AGENTS.md");
const projectContext = existsSync(agentsPath)
  ? readFileSync(agentsPath, "utf-8")
  : undefined;

const SAFE_PREFIXES = [
  "ls",
  "cat",
  "echo",
  "pwd",
  "which",
  "find",
  "head",
  "tail",
  "wc",
  "git log",
  "git status",
  "git diff",
];

type ApprovalConfig =
  | { mode: "interactive" }
  | { mode: "background" }
  | { mode: "delegated"; trust: string[] };

function createApproval(config: ApprovalConfig) {
  return ({ command }: { command: string }) => {
    if (config.mode === "background") return false;

    if (config.mode === "delegated") {
      return !config.trust.some((p) => command.trim().startsWith(p));
    }

    return !SAFE_PREFIXES.some((p) => command.trim().startsWith(p));
  };
}

function createBashTool(
  sandbox: Sandbox,
  approvalFn: ReturnType<typeof createApproval>,
) {
  return tool({
    description: `Execute a shell command in the working directory.
 
WHEN TO USE: running build commands, installing packages, running tests,
  git operations, directory listings.
 
WHEN NOT TO USE: reading file contents (use read instead).
  Searching for patterns (use grep instead).
 
DO NOT USE FOR: reading files (use read), searching code (use grep).
 
USAGE: command is a single shell string. Commands not in the safe-prefix
  allowlist are blocked and return a clear error message.`,
    inputSchema: z.object({
      command: z.string().describe("Shell command to execute"),
    }),
    execute: async ({ command }) => {
      if (approvalFn({ command })) {
        return `Blocked: "${command}" requires approval.`;
      }
      const { stdout } = await sandbox.exec(command);
      return stdout || "(no output)";
    },
  });
}

// // Background: auto-approve everything (CI, automation)
// const bash = createBashTool(localOps, createApproval({ mode: "background" }));

// // Delegated: subagent inherits a trust slice from its parent
// const bash = createBashTool(
//   localOps,
//   createApproval({ mode: "delegated", trust: ["pwd", "find .", "git status"] }),
// );

const createReadTool = (sandbox: Sandbox) => {
  return tool({
    description: `Read a file from the project. Returns numbered lines.
 
WHEN TO USE: viewing file contents, checking configurations, reading source code,
  examining specific lines with offset/limit.
 
WHEN NOT TO USE: searching for patterns across files (use grep instead).
  Running commands (use bash instead).
 
DO NOT USE FOR: searching code (use grep), executing commands (use bash),
  modifying files (use edit or write).
 
USAGE: path is relative to working directory. offset and limit are optional.
  Output is capped at 500 lines.`,
    inputSchema: z.object({
      path: z.string().describe("File path relative to working directory"),
      offset: z.number().optional().describe("Start line (1-indexed)"),
      limit: z.number().optional().describe("Max lines to return"),
    }),
    execute: async ({ path: filePath, offset, limit }) => {
      const abs = resolve(cwd, filePath);
      const content = await sandbox.readFile(abs);
      let lines = content.split("\n");

      if (offset) lines = lines.slice(offset - 1);
      if (limit) lines = lines.slice(0, limit);

      const MAX_LINES = 500;
      const truncated = lines.length > MAX_LINES;
      if (truncated) lines = lines.slice(0, MAX_LINES);

      const numbered = lines.map((l, i) => `${(offset || 1) + i}: ${l}`);
      return truncated
        ? numbered.join("\n") + `\n... (truncated at ${MAX_LINES} lines)`
        : numbered.join("\n");
    },
  });
};

const createGrepTool = (sandbox: Sandbox) => {
  return tool({
    description: `Search file contents using regex. Returns matching lines with file paths.
 
WHEN TO USE: finding patterns across multiple files, locating function definitions,
  searching for imports, finding TODOs or error messages.
 
WHEN NOT TO USE: reading a known file (use read instead).
  Running commands (use bash instead).
 
DO NOT USE FOR: reading files (use read), listing directories (use bash),
  modifying files (use edit).
 
USAGE: pattern is a regex string. glob filters by file extension.
  Results are capped at 50 matches.
 
EXAMPLES:
  - Find all TODO comments: pattern "TODO" glob "*.ts"
  - Find function definitions: pattern "function \\w+" glob "*.ts"
  - Find imports of a package: pattern "from 'express'" glob "*.ts"`,
    inputSchema: z.object({
      pattern: z.string().describe("Regex pattern to search for"),
      path: z
        .string()
        .optional()
        .describe("Directory to search (default: working dir)"),
      glob: z.string().optional().describe("File glob filter, e.g. '*.ts'"),
    }),
    execute: async ({ pattern, path: searchPath, glob: globFilter }) => {
      const dir = resolve(sandbox.workingDirectory, searchPath || ".");
      const escapedPattern = pattern.replace(/'/g, `'\\''`);
      const escapedGlob = (globFilter || "*").replace(/'/g, `'\\''`);
      const cmd = `grep -rn --exclude-dir=node_modules --exclude-dir=.git --include='${escapedGlob}' -E '${escapedPattern}' '${dir}' 2>/dev/null`;

      try {
        const { stdout } = await sandbox.exec(cmd);
        const lines = stdout.trim().split("\\n").filter(Boolean);

        const MAX_MATCHES = 50;
        const truncated = lines.length > MAX_MATCHES;
        const result = truncated ? lines.slice(0, MAX_MATCHES) : lines;

        return truncated
          ? result.join("\\n") +
              `\\n... (${lines.length} total, showing first ${MAX_MATCHES})`
          : result.join("\\n") || "No matches found.";
      } catch (error: any) {
        const stdout = String(error?.stdout || "").trim();
        if (stdout) {
          const lines = stdout.split("\\n").filter(Boolean);
          const MAX_MATCHES = 50;
          const truncated = lines.length > MAX_MATCHES;
          const result = truncated ? lines.slice(0, MAX_MATCHES) : lines;
          return truncated
            ? result.join("\\n") +
                `\\n... (${lines.length} total, showing first ${MAX_MATCHES})`
            : result.join("\\n");
        }
        return "No matches found.";
      }
    },
  });
};

const sandbox = await createSandboxByEnv(cwd);

const lifecycle: SandboxLifecycle = {};

await lifecycle.afterStart?.(sandbox);

console.error(`Sandbox: ${sandbox.type}`);

const tools = {
  read: createReadTool(sandbox),
  grep: createGrepTool(sandbox),
  bash: createBashTool(sandbox, createApproval({ mode: "interactive" })),
};

const instructions = buildSystemPrompt({
  workingDirectory: cwd,
  toolNames: Object.keys(tools),
  sandboxType: "local",
  projectContext,
});

const agent = new ToolLoopAgent({
  model: "anthropic/claude-haiku-4-5",
  instructions,
  tools,
  stopWhen: stepCountIs(10),
});

const prompt = process.argv.slice(3).join(" ") || "Hello!";
const { text, steps } = await agent.generate({ prompt });
console.log(text);
console.log(`\n(${steps.length} steps)`);
