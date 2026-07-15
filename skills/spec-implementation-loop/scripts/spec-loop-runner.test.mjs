#!/usr/bin/env node
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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

const testDirectInvocationThroughSymlink = () => {
  const fixtureDir = mkdtempSync(join(tmpdir(), "spec-loop-symlink-test-"));
  const linkedScriptsDir = join(fixtureDir, "scripts");
  symlinkSync(scriptDir, linkedScriptsDir, "dir");

  try {
    const result = spawnSync(join(linkedScriptsDir, "spec-loop"), ["help"], { encoding: "utf8" });
    assert.equal(result.status, 0);
    assert.equal(JSON.parse(result.stdout).status, "help");
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true });
  }
};

const testStaleChild = () => {
  const runDir = createFixture(999_999);
  try {
    const result = invoke(["status", "--run", runDir]);
    assert.equal(result.exitCode, 0);
    assert.equal(result.output.status, "recoverable_error");
    assert.equal(result.output.recoverable, true);
    assert.equal(result.output.reason, "running_child_not_found");
    assert.match(result.output.resumeCommand, /--fresh/);

    const state = JSON.parse(readFileSync(join(runDir, "state.json"), "utf8"));
    assert.equal(state.status, "recoverable_error");
    assert.equal(state.steps["02-implementation"].status, "recoverable_error");

    const resume = invoke(["resume", "--run", runDir]);
    assert.equal(resume.exitCode, 0);
    assert.equal(resume.output.status, "recoverable_error");
    assert.match(resume.output.resumeCommand, /--fresh/);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
};

const testUntrackedStaleChild = () => {
  const runDir = createFixture(undefined);
  try {
    const result = invoke(["status", "--run", runDir]);
    assert.equal(result.exitCode, 0);
    assert.equal(result.output.status, "recoverable_error");
    assert.equal(result.output.recoverable, true);
    assert.equal(result.output.reason, "running_child_pid_missing");
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
};

const testMissingPidDuringStartupIsNotStale = () => {
  const runDir = createFixture(undefined);
  try {
    const statePath = join(runDir, "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.steps["02-implementation"].startedAt = new Date().toISOString();
    writeFileSync(statePath, JSON.stringify(state));
    const result = invoke(["status", "--run", runDir]);
    assert.equal(result.exitCode, 0);
    assert.equal(result.output.status, "running");
    assert.equal(result.output.recoverable, false);
    assert.equal(result.output.stepStatus, "running");
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
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
const prompt = process.argv.at(-1) ?? "";
const step = prompt.match(/active step: ([^\\n]+)/)?.[1] ?? "unknown";
const cycle = Number(prompt.match(/- cycle: (\\d+)/)?.[1] ?? 0);
const invocationCount = existsSync(process.env.INVOCATIONS)
  ? readFileSync(process.env.INVOCATIONS, "utf8")
    .split("\\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((invocation) => invocation.step === step)
    .length + 1
  : 1;
const invocation = { step, cycle, prompt };
appendFileSync(process.env.INVOCATIONS, JSON.stringify(invocation) + "\\n");
const emit = () => {
  const shouldRecoverablyFail = process.env.SCENARIO === "always-recoverable"
    || process.env.SCENARIO === "long-recoverable"
    || process.env.SCENARIO === "provider-recoverable"
    || (process.env.SCENARIO === "recoverable-once" && invocationCount === 1)
    || (process.env.SCENARIO === "recoverable-by-step"
      && ["02-implementation", "03-review"].includes(step)
      && invocationCount <= 2);
  if (shouldRecoverablyFail && (step === "02-implementation" || process.env.SCENARIO === "recoverable-by-step")) {
    if (process.env.WORKING_TREE_MARKER) writeFileSync(process.env.WORKING_TREE_MARKER, "useful modification");
    process.stderr.write(process.env.SCENARIO === "long-recoverable"
      ? "x".repeat(10_000)
      : process.env.SCENARIO === "provider-recoverable"
        ? "provider temporarily unavailable (503)\\n"
        : "child useful diagnostic\\n");
    process.exitCode = 1;
    return;
  }
  if (process.env.SCENARIO === "invalid") {
    process.stdout.write("{invalid json");
    return;
  }
  let result;
  if (process.env.SCENARIO === "unknown") {
    result = { status: "mystery" };
  } else if (process.env.SCENARIO === "invalid-result") {
    process.stdout.write("[]");
    return;
  } else if (process.env.SCENARIO === "needs-confirmation") {
    result = { status: "needs_confirmation", question: "confirm", summary: "confirmation needed" };
  } else if (process.env.SCENARIO === "provider-result") {
    result = { status: "failed", reason: "provider_temporary_error", summary: "provider unavailable" };
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
    assert.equal(state.steps["04-fix"].cycleAttempts, 1);
    assert.equal(state.steps["05-simplification"].cycleAttempts, 1);
    assert.equal(state.steps["06-final-review"].cycleAttempts, 1);
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
    assert.equal(result.output.recoverable, false);
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

const testRecoverableChildExitContract = () => {
  const fixture = createPiFixture("recoverable-once", "02-implementation");
  const markerPath = join(fixture.runDir, "working-tree-marker.txt");
  try {
    const result = invoke(["resume", "--run", fixture.runDir], {
      INVOCATIONS: fixture.invocationPath,
      SCENARIO: fixture.scenario,
      WORKING_TREE_MARKER: markerPath,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.output.status, "recoverable_error");
    assert.equal(result.output.recoverable, true);
    assert.equal(result.output.currentStep, "02-implementation");
    assert.equal(result.output.attempt, 1);
    assert.equal(result.output.reason, "child_exit_nonzero");
    assert.equal(result.output.childReason, "child_exit_nonzero");
    assert.equal(result.output.stderr, "child useful diagnostic\n");
    assert.match(result.output.diagnostic, /child useful diagnostic/);
    assert.ok(result.output.logPath);
    assert.equal(result.output.fullLogPath, result.output.logPath);
    assert.match(result.output.resumeCommand, /resume/);
    assert.match(result.output.resumeCommand, /02-implementation/);
    assert.equal(existsSync(markerPath), true);

    const state = JSON.parse(readFileSync(join(fixture.runDir, "state.json"), "utf8"));
    assert.equal(state.status, "recoverable_error");
    assert.equal(state.steps["02-implementation"].status, "recoverable_error");
    assert.equal(state.steps["02-implementation"].attempt, 1);
    assert.equal(state.steps["02-implementation"].reason, "child_exit_nonzero");
    assert.equal(JSON.parse(readFileSync(state.steps["02-implementation"].outputPath, "utf8")).status, "recoverable_error");

    const status = invoke(["status", "--run", fixture.runDir]);
    assert.equal(status.exitCode, 0);
    assert.equal(status.output.status, "recoverable_error");
    assert.equal(status.output.recoverable, true);
    assert.equal(status.output.currentStep, result.output.currentStep);
    assert.equal(status.output.attempt, result.output.attempt);
    assert.equal(status.output.reason, result.output.reason);
    assert.equal(status.output.diagnostic, result.output.diagnostic);
    assert.equal(status.output.stderr, result.output.stderr);
    assert.equal(status.output.resumeCommand, result.output.resumeCommand);
  } finally {
    rmSync(fixture.runDir, { recursive: true, force: true });
  }
};

const testRecoverableDiagnosticIsBounded = () => {
  const fixture = createPiFixture("long-recoverable", "02-implementation");
  try {
    const result = invoke(["resume", "--run", fixture.runDir], {
      INVOCATIONS: fixture.invocationPath,
      SCENARIO: fixture.scenario,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.output.status, "recoverable_error");
    assert.equal(result.output.diagnosticTruncated, true);
    assert.ok(result.output.diagnostic.length <= 4000);
    assert.ok(result.output.stderr.length <= 4000);
    assert.ok(readFileSync(result.output.fullLogPath, "utf8").length > 10_000);
  } finally {
    rmSync(fixture.runDir, { recursive: true, force: true });
  }
};

const testProviderFailuresAreRecoverable = () => {
  for (const scenario of ["provider-recoverable", "provider-result"]) {
    const fixture = createPiFixture(scenario, "02-implementation");
    try {
      const result = invoke(["resume", "--run", fixture.runDir], {
        INVOCATIONS: fixture.invocationPath,
        SCENARIO: fixture.scenario,
      });
      assert.equal(result.exitCode, 0);
      assert.equal(result.output.status, "recoverable_error");
      assert.equal(result.output.recoverable, true);
      assert.equal(result.output.reason, "provider_temporary_error");
    } finally {
      rmSync(fixture.runDir, { recursive: true, force: true });
    }
  }
};

const testInvalidResultsAreRecoverable = () => {
  for (const [scenario, reason] of [["invalid-result", "child_result_invalid"], ["unknown", "child_status_invalid"]]) {
    const fixture = createPiFixture(scenario, "01-spec-intake");
    try {
      const result = invoke(["resume", "--run", fixture.runDir], {
        INVOCATIONS: fixture.invocationPath,
        SCENARIO: fixture.scenario,
      });
      assert.equal(result.exitCode, 0);
      assert.equal(result.output.status, "recoverable_error");
      assert.equal(result.output.reason, reason);
      assert.equal(result.output.recoverable, true);
    } finally {
      rmSync(fixture.runDir, { recursive: true, force: true });
    }
  }
};

const testNeedsConfirmationDoesNotRetryAutomatically = () => {
  const fixture = createPiFixture("needs-confirmation", "02-implementation");
  try {
    const result = invoke(["resume", "--run", fixture.runDir], {
      INVOCATIONS: fixture.invocationPath,
      SCENARIO: fixture.scenario,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.output.status, "needs_confirmation");
    assert.equal(result.output.recoverable, false);
    assert.equal(readInvocations(fixture.invocationPath).length, 1);
  } finally {
    rmSync(fixture.runDir, { recursive: true, force: true });
  }
};

const testTimeoutIsRecoverableAfterChildStops = () => {
  const fixture = createPiFixture("timeout", "02-implementation");
  try {
    const timeoutResult = invoke(["resume", "--run", fixture.runDir, "--timeout-ms", "200"], {
      INVOCATIONS: fixture.invocationPath,
      SCENARIO: fixture.scenario,
      SLEEP_MS: "1000",
    });
    assert.equal(timeoutResult.exitCode, 0);
    assert.equal(timeoutResult.output.status, "recoverable_error");
    assert.equal(timeoutResult.output.reason, "timeout");
    assert.equal(timeoutResult.output.recoverable, true);
    assert.equal(timeoutResult.output.childPid, null);

    const retry = invoke(["resume", "--run", fixture.runDir, "--timeout-ms", "5000"], {
      INVOCATIONS: fixture.invocationPath,
      SCENARIO: fixture.scenario,
    });
    assert.equal(retry.exitCode, 0);
    assert.equal(retry.output.status, "checkpoint");
    assert.equal(retry.output.completedStep, "02-implementation");
    assert.equal(retry.output.nextStep, "03-review");
    assert.equal(readInvocations(fixture.invocationPath).length, 2);
  } finally {
    rmSync(fixture.runDir, { recursive: true, force: true });
  }
};

const testStaleRetryUsesNewAttempt = () => {
  const fixture = createPiFixture("stale-retry", "02-implementation");
  const statePath = join(fixture.runDir, "state.json");
  const staleLogPath = join(fixture.runDir, "logs", "02-implementation.attempt-1.log");
  const staleOutputPath = join(fixture.runDir, "outputs", "02-implementation.attempt-1.json");
  try {
    writeFileSync(staleLogPath, "# stale child log\\n");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.status = "running";
    state.steps["02-implementation"] = {
      status: "running",
      attempt: 1,
      sessionId: "old-session",
      childPid: 999_999,
      startedAt: "2026-07-13T12:00:00.000Z",
      logPath: staleLogPath,
      outputPath: staleOutputPath,
    };
    writeFileSync(statePath, JSON.stringify(state));

    const status = invoke(["status", "--run", fixture.runDir], { SCENARIO: fixture.scenario });
    assert.equal(status.exitCode, 0);
    assert.equal(status.output.status, "recoverable_error");
    assert.equal(status.output.reason, "running_child_not_found");
    assert.match(status.output.resumeCommand, /--fresh/);

    const retry = invoke(["resume", "--run", fixture.runDir, "--fresh"], {
      INVOCATIONS: fixture.invocationPath,
      SCENARIO: fixture.scenario,
    });
    assert.equal(retry.exitCode, 0);
    assert.equal(retry.output.status, "checkpoint");
    const retriedState = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(retriedState.steps["02-implementation"].attempt, 2);
    assert.notEqual(retriedState.steps["02-implementation"].sessionId, "old-session");
    assert.ok(existsSync(staleLogPath));
    assert.ok(existsSync(join(fixture.runDir, "logs", "02-implementation.attempt-2.log")));
    assert.ok(existsSync(staleOutputPath));
    assert.ok(existsSync(join(fixture.runDir, "outputs", "02-implementation.attempt-2.json")));
  } finally {
    rmSync(fixture.runDir, { recursive: true, force: true });
  }
};

const testInterruptedChildIsRecoverable = async () => {
  const fixture = createPiFixture("interrupted", "02-implementation");
  try {
    const child = spawn(process.execPath, [runnerPath, "resume", "--run", fixture.runDir], {
      encoding: "utf8",
      env: { ...process.env, INVOCATIONS: fixture.invocationPath, SCENARIO: fixture.scenario, SLEEP_MS: "1000" },
    });
    let stdout = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    const exitCode = await new Promise((resolve) => {
      const signalTimer = setTimeout(() => child.kill("SIGTERM"), 500);
      child.on("close", (code) => {
        clearTimeout(signalTimer);
        resolve(code);
      });
    });
    const result = JSON.parse(stdout);
    assert.equal(exitCode, 0);
    assert.equal(result.status, "recoverable_error");
    assert.equal(result.recoverable, true);
    assert.equal(result.reason, "interrupted");
  } finally {
    rmSync(fixture.runDir, { recursive: true, force: true });
  }
};

const testRecoverableRetryPreservesTreeAndStep = () => {
  const fixture = createPiFixture("recoverable-once", "02-implementation");
  const markerPath = join(fixture.runDir, "working-tree-marker.txt");
  try {
    const first = invoke(["resume", "--run", fixture.runDir], {
      INVOCATIONS: fixture.invocationPath,
      SCENARIO: fixture.scenario,
      WORKING_TREE_MARKER: markerPath,
    });
    assert.equal(first.exitCode, 0);
    assert.equal(first.output.status, "recoverable_error");

    const failedState = JSON.parse(readFileSync(join(fixture.runDir, "state.json"), "utf8"));
    const firstSession = failedState.steps["02-implementation"].sessionId;
    const second = invoke(["resume", "--run", fixture.runDir], {
      INVOCATIONS: fixture.invocationPath,
      SCENARIO: fixture.scenario,
      WORKING_TREE_MARKER: markerPath,
    });
    assert.equal(second.exitCode, 0);
    assert.equal(second.output.status, "checkpoint");
    assert.equal(second.output.completedStep, "02-implementation");
    assert.equal(second.output.nextStep, "03-review");

    const state = JSON.parse(readFileSync(join(fixture.runDir, "state.json"), "utf8"));
    assert.equal(state.steps["02-implementation"].status, "completed");
    assert.equal(state.steps["02-implementation"].attempt, 2);
    assert.notEqual(state.steps["02-implementation"].sessionId, firstSession);
    assert.equal(state.recovery, null);
    assert.equal(state.recoverableError, null);
    assert.equal(readFileSync(markerPath, "utf8"), "useful modification");

    const invocations = readInvocations(fixture.invocationPath);
    assert.deepEqual(invocations.map(({ step }) => step), ["02-implementation", "02-implementation"]);
    assert.match(invocations[1].prompt, /The previous attempt exited unexpectedly after modifying the working tree/);
    assert.match(invocations[1].prompt, /- Step: 02-implementation/);
    assert.match(invocations[1].prompt, /- Previous attempt: 1/);
    assert.match(invocations[1].prompt, /- Failure: child_exit_nonzero/);
    assert.match(invocations[1].prompt, /inspect the current working tree/);
    assert.match(invocations[1].prompt, /Preserve useful modifications/);
    assert.match(invocations[1].prompt, /same step from the latest verifiable state/);
    assert.match(invocations[1].prompt, /Do not restart the specification from scratch/);
    assert.match(invocations[1].prompt, /Do not advance to another step/);
    assert.ok(readFileSync(join(fixture.runDir, "logs", "02-implementation.attempt-1.log")));
    assert.ok(readFileSync(join(fixture.runDir, "logs", "02-implementation.attempt-2.log")));
    assert.ok(readFileSync(join(fixture.runDir, "outputs", "02-implementation.attempt-1.json")));
    assert.ok(readFileSync(join(fixture.runDir, "outputs", "02-implementation.attempt-2.json")));
  } finally {
    rmSync(fixture.runDir, { recursive: true, force: true });
  }
};

const testRecoverableAttemptBudgetRequestsConfirmation = () => {
  const fixture = createPiFixture("always-recoverable", "02-implementation");
  try {
    for (let retry = 0; retry < 3; retry++) {
      const result = invoke(["resume", "--run", fixture.runDir], {
        INVOCATIONS: fixture.invocationPath,
        SCENARIO: fixture.scenario,
      });
      assert.equal(result.exitCode, 0);
      assert.equal(result.output.status, retry === 2 ? "needs_confirmation" : "recoverable_error");
      if (retry === 2) {
        assert.equal(result.output.reason, "retry_limit_reached");
        assert.equal(result.output.currentStep, "02-implementation");
        assert.equal(result.output.attemptsConsumed, 3);
        assert.equal(result.output.attemptLimit, 3);
        assert.ok(result.output.logPath);
        assert.match(result.output.question, /Inspect the last diagnostic and log/);
      }
    }
    const state = JSON.parse(readFileSync(join(fixture.runDir, "state.json"), "utf8"));
    assert.equal(state.status, "needs_confirmation");
    assert.equal(state.reason, "retry_limit_reached");
    assert.equal(state.steps["02-implementation"].attempt, 3);
    assert.equal(readInvocations(fixture.invocationPath).length, 3);

    const blocked = invoke(["resume", "--run", fixture.runDir], {
      INVOCATIONS: fixture.invocationPath,
      SCENARIO: fixture.scenario,
    });
    assert.equal(blocked.exitCode, 0);
    assert.equal(blocked.output.status, "needs_confirmation");
    assert.equal(blocked.output.recoverable, false);
    assert.equal(blocked.output.reason, "retry_limit_reached");
    assert.equal(blocked.output.attemptsConsumed, 3);
    assert.equal(blocked.output.attemptLimit, 3);
    assert.match(blocked.output.resumeCommand, /--confirm/);
    assert.equal(readInvocations(fixture.invocationPath).length, 3);
  } finally {
    rmSync(fixture.runDir, { recursive: true, force: true });
  }
};

const testBudgetsAreIndependentPerStep = () => {
  const fixture = createPiFixture("recoverable-by-step", "02-implementation");
  const statePath = join(fixture.runDir, "state.json");
  try {
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.maxAttempts = 2;
    state.maxRecoverableRetries = 2;
    writeFileSync(statePath, JSON.stringify(state));

    assert.equal(invoke(["resume", "--run", fixture.runDir], {
      INVOCATIONS: fixture.invocationPath,
      SCENARIO: fixture.scenario,
    }).output.status, "recoverable_error");
    const exhausted = invoke(["resume", "--run", fixture.runDir], {
      INVOCATIONS: fixture.invocationPath,
      SCENARIO: fixture.scenario,
    });
    assert.equal(exhausted.output.status, "needs_confirmation");
    assert.equal(exhausted.output.attemptsConsumed, 2);

    const confirmed = invoke(["resume", "--run", fixture.runDir, "--confirm"], {
      INVOCATIONS: fixture.invocationPath,
      SCENARIO: fixture.scenario,
    });
    assert.equal(confirmed.output.status, "checkpoint");
    assert.equal(confirmed.output.nextStep, "03-review");

    assert.equal(invoke(["resume", "--run", fixture.runDir], {
      INVOCATIONS: fixture.invocationPath,
      SCENARIO: fixture.scenario,
    }).output.status, "recoverable_error");
    const otherStep = invoke(["resume", "--run", fixture.runDir], {
      INVOCATIONS: fixture.invocationPath,
      SCENARIO: fixture.scenario,
    });
    assert.equal(otherStep.output.status, "needs_confirmation");
    assert.equal(otherStep.output.currentStep, "03-review");
    assert.equal(otherStep.output.attemptsConsumed, 2);
    const invocations = readInvocations(fixture.invocationPath);
    assert.deepEqual(invocations.map(({ step }) => step), [
      "02-implementation", "02-implementation", "02-implementation",
      "03-review", "03-review",
    ]);
  } finally {
    rmSync(fixture.runDir, { recursive: true, force: true });
  }
};

const testHumanConfirmationAllowsManualAttempt = () => {
  const fixture = createPiFixture("always-recoverable", "02-implementation");
  const statePath = join(fixture.runDir, "state.json");
  try {
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.maxAttempts = 1;
    state.maxRecoverableRetries = 1;
    writeFileSync(statePath, JSON.stringify(state));
    const automatic = invoke(["resume", "--run", fixture.runDir], {
      INVOCATIONS: fixture.invocationPath,
      SCENARIO: fixture.scenario,
    });
    assert.equal(automatic.output.status, "needs_confirmation");
    assert.equal(readInvocations(fixture.invocationPath).length, 1);

    const manual = invoke(["resume", "--run", fixture.runDir, "--confirm", "--answer", "Confirm"], {
      INVOCATIONS: fixture.invocationPath,
      SCENARIO: fixture.scenario,
    });
    assert.equal(manual.exitCode, 0);
    assert.equal(manual.output.status, "needs_confirmation");
    assert.equal(readInvocations(fixture.invocationPath).length, 2);
    const finalState = JSON.parse(readFileSync(statePath, "utf8"));
    assert.equal(finalState.steps["02-implementation"].attempt, 2);
    assert.ok(existsSync(join(fixture.runDir, "logs", "02-implementation.attempt-1.log")));
    assert.ok(existsSync(join(fixture.runDir, "logs", "02-implementation.attempt-2.log")));
    assert.ok(existsSync(join(fixture.runDir, "outputs", "02-implementation.attempt-1.json")));
    assert.ok(existsSync(join(fixture.runDir, "outputs", "02-implementation.attempt-2.json")));
  } finally {
    rmSync(fixture.runDir, { recursive: true, force: true });
  }
};

const testRetryRefusesActiveChild = () => {
  const fixture = createPiFixture("recoverable-once", "02-implementation");
  try {
    invoke(["resume", "--run", fixture.runDir], {
      INVOCATIONS: fixture.invocationPath,
      SCENARIO: fixture.scenario,
    });
    const statePath = join(fixture.runDir, "state.json");
    const state = JSON.parse(readFileSync(statePath, "utf8"));
    state.steps["02-implementation"].childPid = process.pid;
    writeFileSync(statePath, JSON.stringify(state));

    const result = invoke(["resume", "--run", fixture.runDir], {
      INVOCATIONS: fixture.invocationPath,
      SCENARIO: fixture.scenario,
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.output.status, "busy");
    assert.equal(result.output.reason, "child_still_running");
    assert.equal(readInvocations(fixture.invocationPath).length, 1);
  } finally {
    rmSync(fixture.runDir, { recursive: true, force: true });
  }
};

const testInvalidInvocationIsNotRecoverable = () => {
  const result = invoke(["resume"]);
  assert.equal(result.exitCode, 2);
  assert.equal(result.output.status, "failed");
  assert.notEqual(result.output.recoverable, true);
};

const testChildSpawnErrorIsRecoverable = () => {
  const fixture = createPiFixture("internal", "02-implementation");
  try {
    const result = invoke(["resume", "--run", fixture.runDir, "--pi-bin", "/definitely/missing/pi-child"]);
    assert.equal(result.exitCode, 0);
    assert.equal(result.output.status, "recoverable_error");
    assert.equal(result.output.reason, "child_error");
    assert.equal(result.output.recoverable, true);
    assert.match(result.output.diagnostic, /ENOENT/);

    const state = JSON.parse(readFileSync(join(fixture.runDir, "state.json"), "utf8"));
    assert.equal(state.status, "recoverable_error");
    assert.equal(state.reason, "child_error");
    assert.equal(state.steps["02-implementation"].status, "recoverable_error");
    assert.equal(state.steps["02-implementation"].attempt, 0);
    assert.equal(state.steps["02-implementation"].launchAttempt, 1);
  } finally {
    rmSync(fixture.runDir, { recursive: true, force: true });
  }
};

const testUnreadableStateIsTerminal = () => {
  const runDir = mkdtempSync(join(tmpdir(), "spec-loop-invalid-state-test-"));
  try {
    writeFileSync(join(runDir, "state.json"), "{invalid");
    const result = invoke(["status", "--run", runDir]);
    assert.equal(result.exitCode, 1);
    assert.equal(result.output.status, "failed");
    assert.equal(result.output.reason, "runner_exception");
    assert.notEqual(result.output.recoverable, true);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
};

const testIncompatibleStateVersionIsTerminal = () => {
  const runDir = mkdtempSync(join(tmpdir(), "spec-loop-future-state-test-"));
  try {
    writeFileSync(join(runDir, "state.json"), JSON.stringify({ version: 999 }));
    const result = invoke(["status", "--run", runDir]);
    assert.equal(result.exitCode, 1);
    assert.equal(result.output.status, "failed");
    assert.match(result.output.message, /incompatible_state_version/);
    assert.notEqual(result.output.recoverable, true);
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
};

const testUnknownChildStatusFailsSafely = () => {
  const fixture = createPiFixture("unknown", "01-spec-intake");
  try {
    const result = invoke(["resume", "--run", fixture.runDir], {
      INVOCATIONS: fixture.invocationPath,
      SCENARIO: fixture.scenario,
    });
    assert.equal(result.exitCode, 0);
    assert.equal(result.output.status, "recoverable_error");
    assert.equal(result.output.recoverable, true);
    assert.equal(result.output.reason, "child_status_invalid");

    const state = JSON.parse(readFileSync(join(fixture.runDir, "state.json"), "utf8"));
    assert.equal(state.steps["01-spec-intake"].status, "recoverable_error");
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
    assert.equal(result.exitCode, 0);
    assert.equal(result.output.status, "recoverable_error");
    assert.equal(result.output.recoverable, true);
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

const testMalformedRunLockIsTerminal = () => {
  const fixture = createPiFixture("malformed-lock", "01-spec-intake");
  try {
    writeFileSync(join(fixture.runDir, ".resume.lock"), "not-json");
    const result = invoke(["resume", "--run", fixture.runDir], {
      INVOCATIONS: fixture.invocationPath,
      SCENARIO: fixture.scenario,
    });
    assert.equal(result.exitCode, 1);
    assert.equal(result.output.status, "busy");
    assert.equal(result.output.reason, "run_busy");
    assert.notEqual(result.output.recoverable, true);
    assert.equal(existsSync(fixture.invocationPath), false);
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

testDirectInvocationThroughSymlink();
testStaleChild();
testUntrackedStaleChild();
testMissingPidDuringStartupIsNotStale();
testLiveChild();
testCorrectionCycle();
testCorrectionCheckpointPreservesHandoffState();
testFailedFixKeepsLaterStepsPending();
testRecoverableChildExitContract();
testRecoverableDiagnosticIsBounded();
testTimeoutIsRecoverableAfterChildStops();
testStaleRetryUsesNewAttempt();
testProviderFailuresAreRecoverable();
testInvalidResultsAreRecoverable();
testNeedsConfirmationDoesNotRetryAutomatically();
testRecoverableRetryPreservesTreeAndStep();
testRecoverableAttemptBudgetRequestsConfirmation();
testBudgetsAreIndependentPerStep();
testHumanConfirmationAllowsManualAttempt();
testRetryRefusesActiveChild();
testInvalidInvocationIsNotRecoverable();
testChildSpawnErrorIsRecoverable();
testUnreadableStateIsTerminal();
testIncompatibleStateVersionIsTerminal();
testUnknownChildStatusFailsSafely();
testInvalidChildJsonFailsSafely();
testManualStepRewindsLaterStatuses();
testTransitionSeamAndStatusValidation();
testMalformedRunLockIsTerminal();
testStaleRunLockRecovers();
await testInterruptedChildIsRecoverable();
await testConcurrentResumesUseOneChild();
console.log("spec-loop runner tests passed");
