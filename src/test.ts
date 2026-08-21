import test from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt, PromptContext } from "./system.js";

const BASE_SYSTEM_PROMPT: PromptContext = {
  toolNames: ["test1", "test2", "test3"],
  sandboxType: "local",
  workingDirectory: "./test",
};

test("SYSTEM-PROMPT: sets the current branch", () => {
  const prompt = buildSystemPrompt({
    ...BASE_SYSTEM_PROMPT,
    gitBranch: "main",
  });
  assert(prompt.includes("Current branch: main"));
});

test("SYSTEM-PROMPT: does not set the current branch", () => {
  const prompt = buildSystemPrompt({
    ...BASE_SYSTEM_PROMPT,
  });
  assert(!prompt.includes("Current branch: main"));
});
