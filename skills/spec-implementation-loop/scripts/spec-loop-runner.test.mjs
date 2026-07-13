#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const runnerPath = join(scriptDir, "spec-loop-runner.mjs");
const steps = [
  "01-spec-intake",
  "02-implementation",
  "03-review",
  "04-fix",
  "05-simplification",
  "06-final-review",
];

const createFixture = (childPid) => {
  const runDir = mkdtempSync(join(tmpdir(), "spec-loop-runner-test-"));
  const logDir = join(runDir, "logs");
  mkdirSync(logDir);
  const logPath = join(logDir, "02-implementation.attempt-1.log");
  writeFileSync(logPath, "# existing child log\n");

  const stateSteps = Object.fromEntries(steps.map((step) => [step, { status: "pending", attempt: 0 }]));
  stateSteps["02-implementation"] = {
    status: "running",
    attempt: 1,
    sessionId: "spec-loop-test-child",
    childPid,
    startedAt: "2026-07-13T12:00:00.000Z",
    logPath,
    outputPath: join(runDir, "outputs", "02-implementation.attempt-1.json"),
  };
  writeFileSync(join(runDir, "state.json"), JSON.stringify({
    version: 2,
    runId: basename(runDir),
    cwd: process.cwd(),
    runDir,
    spec: "test spec",
    base: "HEAD",
    validations: [],
    mode: "checkpoints",
    piBin: "pi",
    approve: true,
    timeoutMs: 25 * 60 * 1000,
    currentStep: "02-implementation",
    status: "running",
    steps: stateSteps,
  }));
  return runDir;
};

const invoke = (args) => {
  const result = spawnSync(process.execPath, [runnerPath, ...args], { encoding: "utf8" });
  return {
    exitCode: result.status,
    output: JSON.parse(result.stdout),
  };
};

const testStaleChild = () => {
  const runDir = createFixture(999_999);
  try {
    const result = invoke(["status", "--run", runDir]);
    assert.equal(result.exitCode, 0);
    assert.equal(result.output.status, "stale");
    assert.equal(result.output.reason, "running_child_not_found");
    assert.match(result.output.resumeCommand, /--fresh/);

    const state = JSON.parse(readFileSync(join(runDir, "state.json"), "utf8"));
    assert.equal(state.steps["02-implementation"].status, "stale");

    const resume = invoke(["resume", "--run", runDir]);
    assert.equal(resume.exitCode, 1);
    assert.equal(resume.output.status, "stale");
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
};

const testUntrackedStaleChild = () => {
  const runDir = createFixture(undefined);
  try {
    const result = invoke(["status", "--run", runDir]);
    assert.equal(result.exitCode, 0);
    assert.equal(result.output.status, "stale");
    assert.equal(result.output.reason, "running_child_pid_missing");
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
};

const testLiveChild = () => {
  const runDir = createFixture(process.pid);
  try {
    const result = invoke(["status", "--run", runDir]);
    assert.equal(result.exitCode, 0);
    assert.equal(result.output.status, "running");
    assert.equal(result.output.stepStatus, "running");
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
};

testStaleChild();
testUntrackedStaleChild();
testLiveChild();
console.log("spec-loop runner stale-child regression tests passed");
