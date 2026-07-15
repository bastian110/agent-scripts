#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getBlockingFindings, normalizeChildResult, transitionAfterCompleted } from "./spec-loop-runner.mjs";

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

const invoke = (args, env = {}) => {
  const result = spawnSync(process.execPath, [runnerPath, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return {
    exitCode: result.status,
    output: JSON.parse(result.stdout),
  };
};

const invokeAsync = (args, env = {}) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [runnerPath, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.on("error", reject);
  child.on("close", (exitCode) => {
    try {
      resolve({ exitCode, output: JSON.parse(stdout), stderr });
    } catch (error) {
      reject(new Error(`Invalid runner output: ${stdout}\n${stderr}`, { cause: error }));
    }
  });
});

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

const createPiFixture = (
  scenario,
  activeStep = "06-final-review",
  mode = activeStep === "06-final-review" ? "auto" : "checkpoints",
) => {
  const runDir = mkdtempSync(join(tmpdir(), "spec-loop-runner-e2e-"));
  mkdirSync(join(runDir, "logs"));
  mkdirSync(join(runDir, "outputs"));
  const invocationPath = join(runDir, "invocations.jsonl");
  const piPath = join(runDir, "fake-pi.mjs");
  writeFileSync(piPath, `#!/usr/bin/env node
import { appendFileSync } from "node:fs";
const prompt = process.argv.at(-1) ?? "";
const step = prompt.match(/active step: ([^\\n]+)/)?.[1] ?? "unknown";
const cycle = Number(prompt.match(/- cycle: (\\d+)/)?.[1] ?? 0);
const invocation = { step, cycle, prompt };
appendFileSync(process.env.INVOCATIONS, JSON.stringify(invocation) + "\\n");
const emit = () => {
  if (process.env.SCENARIO === "invalid") {
    process.stdout.write("{invalid json");
    return;
  }
  let result;
  if (process.env.SCENARIO === "unknown") {
    result = { status: "mystery" };
  } else if (process.env.SCENARIO === "fail-fix" && step === "04-fix") {
    result = { status: "failed", reason: "fix_failed", summary: "fix failed" };
  } else if (step === "06-final-review" && cycle === 1) {
    result = {
      status: "completed",
      findings: ["cancel-active-regeneration"],
      blockingFindings: ["cancel-active-regeneration"],
      decisions: ["run correction cycle"],
      artifacts: ["review.json"],
      modifiedFiles: ["runner.mjs"],
      validationResults: [{ command: "node test", passed: false }],
    };
  } else {
    result = { status: "completed", summary: step };
  }
  process.stdout.write(JSON.stringify(result));
};
if (Number(process.env.SLEEP_MS ?? 0) > 0) setTimeout(emit, Number(process.env.SLEEP_MS));
else emit();
`, { mode: 0o755 });
  chmodSync(piPath, 0o755);

  const stateSteps = Object.fromEntries(steps.map((step) => [step, { status: "pending", attempt: 0 }]));
  if (activeStep === "06-final-review") {
    for (const step of steps.slice(0, 5)) stateSteps[step] = { status: "completed", attempt: 1 };
  }
  writeFileSync(join(runDir, "state.json"), JSON.stringify({
    version: 3,
    runId: basename(runDir),
    cwd: process.cwd(),
    runDir,
    spec: "test spec",
    base: "HEAD",
    validations: [],
    mode,
    piBin: piPath,
    approve: true,
    timeoutMs: 5000,
    cycle: 1,
    activeStep,
    currentStep: activeStep,
    resumeFrom: null,
    returnTo: null,
    reason: null,
    findings: [],
    revision: 0,
    status: "running",
    steps: stateSteps,
  }));
  return { runDir, invocationPath, scenario };
};

const readInvocations = (path) => readFileSync(path, "utf8")
  .trim()
  .split("\n")
  .filter(Boolean)
  .map((line) => JSON.parse(line));

const testCorrectionCycle = () => {
  const fixture = createPiFixture("correction");
  try {
    const result = invoke(["resume", "--run", fixture.runDir], {
      INVOCATIONS: fixture.invocationPath,
      SCENARIO: fixture.scenario,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.output.status, "completed");

    const state = JSON.parse(readFileSync(join(fixture.runDir, "state.json"), "utf8"));
    assert.equal(state.cycle, 2);
    assert.equal(state.activeStep, "06-final-review");
    assert.equal(state.resumeFrom, "06-final-review");
    assert.equal(state.returnTo, "06-final-review");
    assert.deepEqual(state.findings, []);
    assert.equal(state.steps["04-fix"].status, "completed");
    assert.equal(state.steps["05-simplification"].status, "completed");
    assert.equal(state.steps["06-final-review"].status, "completed");
    assert.equal(state.steps["04-fix"].attempt, 2);
    assert.equal(state.steps["05-simplification"].attempt, 2);
    assert.equal(state.steps["06-final-review"].attempt, 2);
    assert.ok(state.revision > 0);

    const invocations = readInvocations(fixture.invocationPath);
    assert.deepEqual(invocations.map(({ step, cycle }) => [step, cycle]), [
      ["06-final-review", 1],
      ["04-fix", 2],
      ["05-simplification", 2],
      ["06-final-review", 2],
    ]);
    assert.match(invocations[1].prompt, /cancel-active-regeneration/);
    assert.match(invocations[1].prompt, /"blockingFindings"/);
    assert.match(invocations[1].prompt, /Correction-cycle handoff/);
    assert.ok(state.steps["06-final-review"].logPath.endsWith("attempt-2.log"));
    assert.match(state.steps["06-final-review"].sessionId, /-c2-s06-final-review-a2$/);
    assert.ok(readFileSync(join(fixture.runDir, "outputs", "06-final-review.attempt-1.json")));
  } finally {
    rmSync(fixture.runDir, { recursive: true, force: true });
  }
};

const testCorrectionCheckpointPreservesHandoffState = () => {
  const fixture = createPiFixture("checkpoint-correction", "06-final-review", "checkpoints");
  try {
    const result = invoke(["resume", "--run", fixture.runDir], {
      INVOCATIONS: fixture.invocationPath,
      SCENARIO: fixture.scenario,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.output.status, "checkpoint");
    assert.equal(result.output.nextStep, "04-fix");

    const state = JSON.parse(readFileSync(join(fixture.runDir, "state.json"), "utf8"));
    assert.equal(state.cycle, 2);
    assert.equal(state.activeStep, "04-fix");
    assert.equal(state.reason, "blocking_findings");
    assert.deepEqual(state.findings, ["cancel-active-regeneration"]);
    assert.equal(state.steps["04-fix"].status, "pending");
    assert.equal(state.steps["05-simplification"].status, "pending");
    assert.equal(state.steps["06-final-review"].status, "pending");
  } finally {
    rmSync(fixture.runDir, { recursive: true, force: true });
  }
};

const testFailedFixKeepsLaterStepsPending = () => {
  const fixture = createPiFixture("fail-fix");
  try {
    const result = invoke(["resume", "--run", fixture.runDir], {
      INVOCATIONS: fixture.invocationPath,
      SCENARIO: fixture.scenario,
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.output.status, "failed");
    assert.equal(result.output.currentStep, "04-fix");

    const state = JSON.parse(readFileSync(join(fixture.runDir, "state.json"), "utf8"));
    assert.equal(state.activeStep, "04-fix");
    assert.equal(state.steps["04-fix"].status, "failed");
    assert.equal(state.steps["05-simplification"].status, "pending");
    assert.equal(state.steps["06-final-review"].status, "pending");
  } finally {
    rmSync(fixture.runDir, { recursive: true, force: true });
  }
};

const testUnknownChildStatusFailsSafely = () => {
  const fixture = createPiFixture("unknown", "01-spec-intake");
  try {
    const result = invoke(["resume", "--run", fixture.runDir], {
      INVOCATIONS: fixture.invocationPath,
      SCENARIO: fixture.scenario,
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.output.status, "failed");
    assert.equal(result.output.reason, "child_status_invalid");

    const state = JSON.parse(readFileSync(join(fixture.runDir, "state.json"), "utf8"));
    assert.equal(state.steps["01-spec-intake"].status, "failed");
    assert.equal(state.steps["01-spec-intake"].reason, "child_status_invalid");
    assert.equal(state.reason, "child_status_invalid");
  } finally {
    rmSync(fixture.runDir, { recursive: true, force: true });
  }
};

const testInvalidChildJsonFailsSafely = () => {
  const fixture = createPiFixture("invalid", "01-spec-intake");
  try {
    const result = invoke(["resume", "--run", fixture.runDir], {
      INVOCATIONS: fixture.invocationPath,
      SCENARIO: fixture.scenario,
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.output.status, "failed");
    assert.equal(result.output.reason, "child_json_parse_failed");
  } finally {
    rmSync(fixture.runDir, { recursive: true, force: true });
  }
};

const testManualStepRewindsLaterStatuses = () => {
  const fixture = createPiFixture("manual", "01-spec-intake");
  try {
    const statePath = join(fixture.runDir, "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    for (const step of steps.slice(1)) state.steps[step] = { status: "completed", attempt: 1 };
    writeFileSync(statePath, JSON.stringify(state));

    const result = invoke(["resume", "--run", fixture.runDir, "--step", "01-spec-intake"], {
      INVOCATIONS: fixture.invocationPath,
    });
    assert.equal(result.exitCode, 0);
    const updated = JSON.parse(readFileSync(statePath, "utf8"));
    for (const step of steps.slice(1)) assert.equal(updated.steps[step].status, "pending");
  } finally {
    rmSync(fixture.runDir, { recursive: true, force: true });
  }
};

const testStaleRunLockRecovers = () => {
  const fixture = createPiFixture("stale-lock", "01-spec-intake");
  try {
    writeFileSync(join(fixture.runDir, ".resume.lock"), JSON.stringify({ pid: 999_999, token: "dead" }));
    const result = invoke(["resume", "--run", fixture.runDir], {
      INVOCATIONS: fixture.invocationPath,
      SCENARIO: fixture.scenario,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.output.status, "checkpoint");
    assert.equal(existsSync(join(fixture.runDir, ".resume.lock")), false);
  } finally {
    rmSync(fixture.runDir, { recursive: true, force: true });
  }
};

const testConcurrentResumesUseOneChild = async () => {
  const fixture = createPiFixture("concurrent", "01-spec-intake");
  try {
    const env = { INVOCATIONS: fixture.invocationPath, SLEEP_MS: "400" };
    const first = invokeAsync(["resume", "--run", fixture.runDir], env);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = await invokeAsync(["resume", "--run", fixture.runDir], env);
    const firstResult = await first;

    assert.equal(second.exitCode, 1);
    assert.equal(second.output.status, "busy");
    assert.equal(firstResult.exitCode, 0);
    assert.equal(readInvocations(fixture.invocationPath).length, 1);
  } finally {
    rmSync(fixture.runDir, { recursive: true, force: true });
  }
};

const testTransitionSeamAndStatusValidation = () => {
  assert.equal(normalizeChildResult({ status: "mystery" }).valid, false);
  assert.deepEqual(getBlockingFindings({ findings: [{ id: "a", blocking: true }, { id: "b", blocking: false }] }), [
    { id: "a", blocking: true },
  ]);

  const fixture = createPiFixture("transition", "06-final-review");
  try {
    const state = JSON.parse(readFileSync(join(fixture.runDir, "state.json"), "utf8"));
    const transition = transitionAfterCompleted(state, "06-final-review", {
      findings: ["cancel-active-regeneration"],
      blockingFindings: ["cancel-active-regeneration"],
    });
    assert.equal(transition.nextStep, "04-fix");
    assert.equal(state.cycle, 2);
    assert.equal(state.activeStep, "04-fix");
  } finally {
    rmSync(fixture.runDir, { recursive: true, force: true });
  }
};

testStaleChild();
testUntrackedStaleChild();
testLiveChild();
testCorrectionCycle();
testCorrectionCheckpointPreservesHandoffState();
testFailedFixKeepsLaterStepsPending();
testUnknownChildStatusFailsSafely();
testInvalidChildJsonFailsSafely();
testManualStepRewindsLaterStatuses();
testTransitionSeamAndStatusValidation();
testStaleRunLockRecovers();
await testConcurrentResumesUseOneChild();
console.log("spec-loop runner tests passed");
