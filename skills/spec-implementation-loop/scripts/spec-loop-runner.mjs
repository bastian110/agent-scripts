#!/usr/bin/env node
import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { basename, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const STEPS = [
  "01-spec-intake",
  "02-implementation",
  "03-review",
  "04-fix",
  "05-simplification",
  "06-final-review",
];

const NEXT_STEP = Object.fromEntries(STEPS.map((step, index) => [step, STEPS[index + 1] ?? null]));
const LOCK_FILE = ".resume.lock";
// Leave room for the parent harness to record the timeout before its own 30-minute watchdog.
const DEFAULT_TIMEOUT_MS = 25 * 60 * 1000;
const CHILD_PID_GRACE_MS = 10 * 1000;
const RUNNER_VERSION = 3;

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  try {
    if (command === "start") return await start(parseArgs(rest));
    if (command === "resume") return await resume(parseArgs(rest));
    if (command === "status") return status(parseArgs(rest));
    if (command === "help" || command === "--help" || !command) return help();
    return printJson({ status: "failed", reason: "unknown_command", command, usage: usage() }, 2);
  } catch (error) {
    return printJson({ status: "failed", reason: "runner_exception", message: error?.message ?? String(error) }, 1);
  }
}

function usage() {
  return [
    "spec-loop start --spec <path|url|text> --base <git-ref> [--validation <cmd> ...] [--mode auto|checkpoints]",
    "spec-loop resume --run <run-dir> [--answer <text>] [--step <step>] [--fresh] [--continue]",
    "spec-loop status --run <run-dir> [--log-lines <n>]", 
  ].join("\n");
}

function help() {
  return printJson({ status: "help", usage: usage(), steps: STEPS }, 0);
}

function parseArgs(argv) {
  const args = { validations: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = () => {
      if (i + 1 >= argv.length) throw new Error(`${arg} requires a value`);
      return argv[++i];
    };
    switch (arg) {
      case "--spec": args.spec = next(); break;
      case "--base": args.base = next(); break;
      case "--validation": args.validations.push(next()); break;
      case "--mode": args.mode = next(); break;
      case "--run-name": args.runName = next(); break;
      case "--timeout-ms": args.timeoutMs = Number(next()); break;
      case "--pi-bin": args.piBin = next(); break;
      case "--log-lines": args.logLines = Number(next()); break;
      case "--run": args.run = next(); break;
      case "--answer": args.answer = next(); break;
      case "--step": args.step = next(); break;
      case "--fresh": args.fresh = true; break;
      case "--continue": args.continue = true; break;
      case "--no-approve": args.approve = false; break;
      case "--approve": args.approve = true; break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

async function start(args) {
  if (!args.spec) return printJson({ status: "failed", reason: "missing_spec", usage: usage() }, 2);
  if (!args.base) return printJson({ status: "failed", reason: "missing_base", usage: usage() }, 2);

  const cwd = process.cwd();
  const runId = `${slugify(projectSlug(cwd))}-${randomUUID().slice(0, 8)}`;
  const runDir = join(cwd, ".pi", "spec-loop-runs", runId);
  mkdirSync(join(runDir, "logs"), { recursive: true });
  mkdirSync(join(runDir, "outputs"), { recursive: true });
  ensureGitignore(cwd);

  const state = {
    version: RUNNER_VERSION,
    runId,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cwd,
    runDir,
    spec: args.spec,
    base: args.base,
    validations: args.validations,
    mode: args.mode === "checkpoints" ? "checkpoints" : "auto",
    piBin: args.piBin || process.env.PI_BIN || "pi",
    approve: args.approve !== false,
    timeoutMs: Number.isFinite(args.timeoutMs) ? args.timeoutMs : DEFAULT_TIMEOUT_MS,
    git: gitSnapshot(cwd),
    cycle: 1,
    activeStep: STEPS[0],
    // Kept as a read-compatible projection for older operators and run directories.
    currentStep: STEPS[0],
    resumeFrom: null,
    returnTo: null,
    reason: null,
    findings: [],
    revision: 0,
    status: "running",
    steps: Object.fromEntries(STEPS.map((step) => [step, { status: "pending", attempt: 0 }])),
  };
  writeState(state);
  return await runStepAndMaybeContinue(state, STEPS[0]);
}

async function resume(args) {
  if (!args.run) return printJson({ status: "failed", reason: "missing_run", usage: usage() }, 2);

  const runDir = resolve(args.run);
  const lock = acquireRunLock(runDir);
  if (lock.busy) {
    return printJson({
      status: "busy",
      reason: "run_busy",
      runDir: relativeOrAbsolute(process.cwd(), runDir),
      lockPath: lock.path,
      ownerPid: lock.ownerPid,
      message: "Another resume is already executing this run.",
    }, 1);
  }

  try {
    return await resumeLocked(args, runDir);
  } finally {
    releaseRunLock(lock);
  }
}

async function resumeLocked(args, runDir) {
  const state = readState(runDir);
  if (args.timeoutMs !== undefined) state.timeoutMs = args.timeoutMs;
  if (args.piBin) state.piBin = args.piBin;
  if (args.approve !== undefined) state.approve = args.approve;

  const step = args.step || state.activeStep;
  if (!STEPS.includes(step)) return printJson({ status: "failed", reason: "unknown_step", step, steps: STEPS }, 2);
  const staleReason = markRunningStepStale(state, step);
  const stepState = state.steps[step];
  if ((staleReason || stepState?.status === "stale") && !args.fresh) {
    return printJson(staleSummary(state, step, staleReason ?? stepState.reason), 1);
  }
  if (stepState?.status === "running" && !staleReason) {
    return printJson({
      ...summary(state, { status: "busy", currentStep: step }),
      reason: "child_still_running",
      childPid: stepState.childPid,
      message: "The active child is still running; wait for it or recover it with --fresh after it exits.",
    }, 1);
  }

  // An explicit step is an operator-directed rewind. Invalidate every later
  // step so completed statuses can never survive a manual correction.
  if (args.step) resetStepsFrom(state, step);

  return await runStepAndMaybeContinue(state, step, {
    answer: args.answer,
    fresh: Boolean(args.fresh),
    forceContinue: Boolean(args.continue),
  });
}

function status(args) {
  if (!args.run) return printJson({ status: "failed", reason: "missing_run", usage: usage() }, 2);
  const state = readState(resolve(args.run));
  const currentStep = state.activeStep;
  const staleReason = isRunLocked(state.runDir) ? null : markRunningStepStale(state, currentStep);
  const stepState = state.steps?.[currentStep];
  const logPath = stepState?.logPath;
  const details = {
    status: staleReason ? "stale" : state.status,
    currentStep,
    activeStep: currentStep,
    cycle: state.cycle,
    stepStatus: stepState?.status,
    attempt: stepState?.attempt,
    sessionId: stepState?.sessionId,
    childPid: stepState?.childPid,
    reason: staleReason ?? state.reason ?? stepState?.reason,
    findings: state.findings,
    revision: state.revision,
    logPath,
    outputPath: stepState?.outputPath,
    lastLogLines: logPath && existsSync(logPath) ? tailLines(logPath, Number.isFinite(args.logLines) ? args.logLines : 40) : [],
  };
  if (staleReason) details.resumeCommand = resumeCommand(state, currentStep, { fresh: true });
  return printJson(summary(state, details), 0);
}

function markRunningStepStale(state, step) {
  const stepState = state.steps?.[step];
  if (stepState?.status !== "running") return null;

  let reason = null;
  if (!stepState.logPath || !existsSync(stepState.logPath)) {
    reason = "running_step_has_no_log";
  } else if (Number.isInteger(stepState.childPid) && stepState.childPid > 0) {
    if (!isProcessAlive(stepState.childPid)) reason = "running_child_not_found";
  } else {
    const startedAt = Date.parse(stepState.startedAt ?? "");
    if (!Number.isFinite(startedAt) || Date.now() - startedAt >= CHILD_PID_GRACE_MS) {
      reason = "running_child_pid_missing";
    }
  }

  if (!reason) return null;
  state.status = "stale";
  setActiveStep(state, step);
  state.steps[step] = { ...stepState, status: "stale", reason, staleAt: new Date().toISOString() };
  touchState(state);
  return reason;
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

function acquireRunLock(runDir) {
  const path = join(runDir, LOCK_FILE);
  const token = randomUUID();
  const lock = { pid: process.pid, token, acquiredAt: new Date().toISOString() };

  for (;;) {
    try {
      const descriptor = openSync(path, "wx");
      try {
        writeSync(descriptor, JSON.stringify(lock));
      } finally {
        closeSync(descriptor);
      }
      return { path, token, ownerPid: process.pid, busy: false };
    } catch (error) {
      if (error?.code !== "EEXIST") throw error;

      const owner = readLock(path);
      if (!owner || !Number.isInteger(owner.pid) || owner.pid <= 0) {
        return { path, busy: true, ownerPid: null };
      }
      if (isProcessAlive(owner.pid)) {
        return { path, busy: true, ownerPid: owner.pid };
      }
      try {
        unlinkSync(path);
      } catch (unlinkError) {
        if (unlinkError?.code !== "ENOENT") return { path, busy: true, ownerPid: owner.pid };
      }
    }
  }
}

function readLock(path) {
  try {
    const value = JSON.parse(readFileSync(path, "utf8"));
    return value && typeof value === "object" ? value : null;
  } catch {
    return null;
  }
}

function isRunLocked(runDir) {
  const owner = readLock(join(runDir, LOCK_FILE));
  return Boolean(owner && Number.isInteger(owner.pid) && isProcessAlive(owner.pid));
}

function releaseRunLock(lock) {
  if (!lock?.path || !lock.token) return;
  const owner = readLock(lock.path);
  if (owner?.token !== lock.token) return;
  try {
    unlinkSync(lock.path);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function setActiveStep(state, step) {
  state.activeStep = step;
  // Compatibility projection for run directories created before v3.
  state.currentStep = step;
}

function resetStepsFrom(state, step) {
  const startIndex = STEPS.indexOf(step);
  for (const laterStep of STEPS.slice(startIndex)) {
    const previous = state.steps[laterStep] ?? { status: "pending", attempt: 0 };
    state.steps[laterStep] = {
      ...previous,
      status: "pending",
      cycle: state.cycle,
      childPid: null,
      startedAt: undefined,
      finishedAt: undefined,
      reason: undefined,
      message: undefined,
      question: undefined,
      recommendedAnswer: undefined,
    };
  }
  state.status = "running";
  setActiveStep(state, step);
  state.reason = state.reason === "blocking_findings" ? state.reason : null;
  touchState(state);
}

function startCorrectionCycle(state, returnTo, findings) {
  state.cycle = (Number.isInteger(state.cycle) ? state.cycle : 1) + 1;
  state.resumeFrom = returnTo;
  state.returnTo = returnTo;
  state.reason = "blocking_findings";
  state.findings = findings;
  resetStepsFrom(state, "04-fix");
  setActiveStep(state, "04-fix");
  touchState(state);
}

function transitionAfterCompleted(state, step, result) {
  const blockingFindings = step === "06-final-review" ? getBlockingFindings(result) : [];
  if (blockingFindings.length > 0) {
    startCorrectionCycle(state, step, blockingFindings);
    return { kind: "correction", nextStep: "04-fix", blockingFindings };
  }

  if (step === "06-final-review") {
    state.findings = [];
    state.reason = null;
  }

  const nextStep = NEXT_STEP[step];
  if (!nextStep) {
    state.status = "completed";
    setActiveStep(state, step);
    touchState(state);
    return { kind: "completed", nextStep: null, blockingFindings: [] };
  }

  state.status = "running";
  setActiveStep(state, nextStep);
  touchState(state);
  return { kind: "next", nextStep, blockingFindings: [] };
}

function staleSummary(state, step, reason) {
  const stepState = state.steps[step];
  return summary(state, {
    status: "stale",
    currentStep: step,
    activeStep: step,
    cycle: state.cycle,
    reason,
    findings: state.findings,
    childPid: stepState?.childPid,
    logPath: stepState?.logPath,
    resumeCommand: resumeCommand(state, step, { fresh: true }),
  });
}

async function runStepAndMaybeContinue(state, step, options = {}) {
  const result = await runOneStep(state, step, options);
  if (result.status !== "completed") return printJson(result, result.status === "failed" ? 1 : 0);

  const transition = transitionAfterCompleted(state, step, result);
  if (transition.kind === "completed") {
    return printJson(summary(state, { status: "completed", completedStep: step, nextStep: null }), 0);
  }

  if (state.mode === "checkpoints" && !options.forceContinue) {
    state.status = "checkpoint";
    touchState(state);
    return printJson(summary(state, {
      status: "checkpoint",
      completedStep: step,
      nextStep: transition.nextStep,
      correctionCycle: transition.kind === "correction" ? state.cycle : undefined,
      resumeCommand: resumeCommand(state, transition.nextStep),
    }), 0);
  }

  return await runStepAndMaybeContinue(state, transition.nextStep);
}

async function runOneStep(state, step, options = {}) {
  const stepState = state.steps[step] ?? { status: "pending", attempt: 0 };
  // Every child invocation gets a new attempt so a retry or correction cycle
  // can never overwrite a previous log or JSON artifact.
  const attempt = stepState.attempt + 1;
  const sessionId = `spec-loop-${state.runId}-c${state.cycle}-s${step}-a${attempt}`;
  const logPath = join(state.runDir, "logs", `${step}.attempt-${attempt}.log`);
  const outputPath = join(state.runDir, "outputs", `${step}.attempt-${attempt}.json`);
  const latestPath = join(state.runDir, "outputs", `${step}.latest.json`);

  const startedAt = new Date().toISOString();
  state.status = "running";
  setActiveStep(state, step);
  state.steps[step] = {
    ...stepState,
    status: "running",
    attempt,
    sessionId,
    childPid: null,
    startedAt,
    logPath,
    outputPath,
  };
  touchState(state);

  const prompt = buildPrompt(state, step, { answer: options.answer });
  const piArgs = [];
  if (state.approve) piArgs.push("--approve");
  piArgs.push("--session-id", sessionId);
  piArgs.push("-p", prompt);

  writeFileSync(logPath, [
    `# ${step} attempt ${attempt}`,
    `status: running`,
    `startedAt: ${startedAt}`,
    `sessionId: ${sessionId}`,
    `command: ${state.piBin} ${piArgs.map(shellQuote).join(" ")}`,
    "\n## stdout\n",
  ].join("\n"));

  const child = await runChildStreaming({ state, step, attempt, sessionId, logPath, outputPath, command: state.piBin, args: piArgs });
  const finishedAt = new Date().toISOString();
  appendFileSync(logPath, `\n\nfinishedAt: ${finishedAt}\nexitCode: ${child.status ?? "null"}\nsignal: ${child.signal ?? "null"}\n`);

  if (child.timedOut) return failStep(state, step, attempt, "timeout", logPath, outputPath);
  if (child.error) return failStep(state, step, attempt, "child_error", logPath, outputPath, child.error.message);
  if (child.interrupted) return failStep(state, step, attempt, "interrupted", logPath, outputPath, child.signal || "interrupted");
  if (child.status !== 0) return failStep(state, step, attempt, "child_exit_nonzero", logPath, outputPath, `exit ${child.status}`);

  const parsed = extractJson(child.stdout || "");
  if (!parsed) return failStep(state, step, attempt, "child_json_parse_failed", logPath, outputPath);
  writeFileSync(outputPath, JSON.stringify(parsed, null, 2));
  copyFileSync(outputPath, latestPath);

  const normalized = normalizeChildResult(parsed);
  if (!normalized.valid) {
    return failStep(state, step, attempt, normalized.reason, logPath, outputPath);
  }
  // Older children used needs_confirmation for a review finding. A final
  // review's blocking facts still trigger the runner-owned correction cycle.
  if (step === "06-final-review" && normalized.status === "needs_confirmation" && normalized.blockingFindings.length > 0) {
    normalized.status = "completed";
  }

  state.steps[step] = {
    status: normalized.status,
    attempt,
    cycle: state.cycle,
    sessionId,
    logPath,
    outputPath,
    latestPath,
    childPid: child.childPid ?? state.steps[step]?.childPid ?? null,
    summary: normalized.summary,
    question: normalized.question,
    recommendedAnswer: normalized.recommendedAnswer,
    reason: normalized.reason,
    findings: normalized.findings,
    blockingFindings: normalized.blockingFindings,
    decisions: normalized.decisions,
    artifacts: normalized.artifacts,
    modifiedFiles: normalized.modifiedFiles,
    validationResults: normalized.validationResults,
    finishedAt,
  };
  state.status = normalized.status === "completed" ? "running" : normalized.status;
  if (normalized.status === "failed" && state.reason !== "blocking_findings") {
    state.reason = normalized.reason || "child_reported_failure";
  }
  touchState(state);

  if (normalized.status === "completed") {
    return summary(state, {
      status: "completed",
      completedStep: step,
      nextStep: NEXT_STEP[step],
      findings: normalized.findings,
      blockingFindings: normalized.blockingFindings,
      decisions: normalized.decisions,
      artifacts: normalized.artifacts,
      modifiedFiles: normalized.modifiedFiles,
      validationResults: normalized.validationResults,
    });
  }
  if (normalized.status === "needs_confirmation") {
    return summary(state, {
      status: "needs_confirmation",
      currentStep: step,
      question: normalized.question || "Child Pi requested confirmation.",
      recommendedAnswer: normalized.recommendedAnswer,
      findings: normalized.findings,
      blockingFindings: normalized.blockingFindings,
      logPath,
      outputPath,
      resumeCommand: resumeCommand(state, step),
    });
  }
  return summary(state, {
    status: "failed",
    currentStep: step,
    reason: normalized.reason || "child_reported_failure",
    findings: normalized.findings,
    blockingFindings: normalized.blockingFindings,
    logPath,
    outputPath,
    resumeCommand: resumeCommand(state, step),
  });
}

function failStep(state, step, attempt, reason, logPath, outputPath, message) {
  state.status = "failed";
  if (state.reason !== "blocking_findings") state.reason = reason;
  setActiveStep(state, step);
  state.steps[step] = {
    ...state.steps[step],
    status: "failed",
    attempt,
    cycle: state.cycle,
    reason,
    message,
    childPid: null,
    logPath,
    outputPath,
  };
  touchState(state);
  return summary(state, { status: "failed", currentStep: step, reason, message, logPath, resumeCommand: resumeCommand(state, step) });
}

function runChildStreaming({ state, step, attempt, sessionId, logPath, outputPath, command, args }) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let interrupted = false;
    let settled = false;
    let child;
    let timeout = null;

    const finish = (result) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ stdout, stderr, timedOut, interrupted, childPid: child?.pid ?? null, ...result });
    };

    const markInterrupted = (signal) => {
      interrupted = true;
      appendFileSync(logPath, `\n\n[runner] received ${signal}; marking step interrupted\n`);
      state.status = "interrupted";
      setActiveStep(state, step);
      state.steps[step] = {
        ...state.steps[step],
        status: "interrupted",
        attempt,
        reason: "runner_interrupted",
        message: signal,
        sessionId,
        logPath,
        outputPath,
      };
      touchState(state);
      try { child?.kill(signal); } catch {}
      setTimeout(() => process.exit(signal === "SIGINT" ? 130 : 143), 50).unref?.();
    };

    const onSigint = () => markInterrupted("SIGINT");
    const onSigterm = () => markInterrupted("SIGTERM");
    const cleanup = () => {
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
      if (timeout) clearTimeout(timeout);
    };

    process.on("SIGINT", onSigint);
    process.on("SIGTERM", onSigterm);

    try {
      child = spawn(command, args, { cwd: state.cwd, stdio: ["ignore", "pipe", "pipe"] });
      if (!child.pid) {
        finish({ error: new Error("child process did not expose a PID"), status: null, signal: null });
        return;
      }
      state.steps[step] = { ...state.steps[step], childPid: child.pid };
      touchState(state);
    } catch (error) {
      finish({ error, status: null, signal: null });
      return;
    }

    child.stdout?.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      appendFileSync(logPath, text);
    });
    child.stderr?.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      appendFileSync(logPath, `\n[stderr] ${text}`);
    });
    child.on("error", (error) => finish({ error, status: null, signal: null }));
    child.on("close", (status, signal) => finish({ status, signal }));

    timeout = state.timeoutMs === 0
      ? null
      : setTimeout(() => {
          timedOut = true;
          appendFileSync(logPath, `\n\n[runner] timeout after ${state.timeoutMs}ms; terminating child\n`);
          try { child.kill("SIGTERM"); } catch {}
          setTimeout(() => {
            if (!settled) {
              try { child.kill("SIGKILL"); } catch {}
            }
          }, 5000).unref?.();
        }, state.timeoutMs);
  });
}

function normalizeChildResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { valid: false, reason: "child_result_invalid" };
  }

  const validStatuses = new Set(["completed", "needs_confirmation", "failed"]);
  if (!validStatuses.has(value.status)) {
    return { valid: false, reason: "child_status_invalid" };
  }

  const findings = Array.isArray(value.findings) ? value.findings : [];
  const blockingFindings = getBlockingFindings(value);
  return {
    valid: true,
    status: value.status,
    summary: value.summary ?? value.message ?? "",
    question: value.question,
    recommendedAnswer: value.recommendedAnswer ?? value.recommended_answer,
    reason: value.reason,
    findings,
    blockingFindings,
    decisions: arrayOrEmpty(value.decisions),
    artifacts: arrayOrEmpty(value.artifacts),
    modifiedFiles: arrayOrEmpty(value.modifiedFiles ?? value.modified_files),
    validationResults: value.validationResults ?? value.validation_results ?? value.validations ?? [],
  };
}

function getBlockingFindings(value) {
  if (Array.isArray(value.blockingFindings)) return value.blockingFindings;
  if (!Array.isArray(value.findings)) return [];

  return value.findings.filter((finding) => {
    if (typeof finding === "string") return true;
    if (!finding || typeof finding !== "object") return false;
    if (typeof finding.blocking === "boolean") return finding.blocking;
    const severity = String(finding.severity ?? "").toLowerCase();
    return severity === "blocking" || severity === "critical";
  });
}

function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function buildPrompt(state, step, { answer } = {}) {
  const specBody = specContent(state.spec, state.cwd);
  const previous = previousArtifacts(state, step);
  const handoff = step === "04-fix" && state.cycle > 1 ? correctionHandoff(state) : null;
  const validationsText = state.validations.length
    ? state.validations.map((v) => `"${v}"`).join(", ")
    : "not provided; inspect repo scripts if needed";
  const answerText = answer ? `\nUser/orchestrator answer for this resumed step:\n${answer}\n` : "";
  const handoffText = handoff
    ? `\nCorrection-cycle handoff (machine-readable facts only):\n${JSON.stringify(handoff)}\n`
    : "";
  const base = `You are a child Pi agent executing one step of a spec implementation loop.\n\nIMPORTANT OUTPUT CONTRACT:\n- Print exactly one JSON object to stdout and nothing else.\n- Valid statuses: "completed", "needs_confirmation", "failed". Unknown or missing statuses are invalid.\n- A completed result may include findings, blockingFindings, decisions, artifacts, modifiedFiles, and validationResults.\n- For needs_confirmation include: {"status":"needs_confirmation","question":"...","recommendedAnswer":"...","summary":"..."}.\n- For failed include: {"status":"failed","reason":"...","summary":"..."}.\n- Never choose a next step or emit nextAction; the runner owns transitions.\n\nRun context:\n- cwd: ${state.cwd}\n- runDir: ${state.runDir}\n- spec input: ${state.spec}\n- base review ref: ${state.base}\n- validation commands: ${validationsText}\n- cycle: ${state.cycle}\n- active step: ${step}\n${answerText}\nSpec content/reference:\n${specBody}\n\nPrevious step artifacts summary:\n${previous}\n${handoffText}`;

  const stepPrompt = {
    "01-spec-intake": `First load /skill:tdd. Ingest the existing spec only; do not generate a new spec. Extract observable behaviors, out-of-scope items, likely public/user-visible surfaces, validations to use, and assumptions. If ambiguity is blocking, return needs_confirmation. If ambiguity is non-blocking, continue and include assumptions in your artifact. Write a markdown or JSON artifact under ${state.runDir}/outputs/. Do not modify application code.`,
    "02-implementation": `First load /skill:implement, then /skill:tdd. If 01-spec-intake includes a user-interface change, also load the relevant Taste Skill before changing UI code: /skill:design-taste-frontend for a design-led landing page, portfolio, or redesign; /skill:redesign-existing-projects for focused improvements to an existing app or site. Apply it only to the planned UI scope. Implement the behaviors from 01-spec-intake as vertical TDD slices. Modify code/tests as needed. Run relevant validations yourself. Do not review or simplify beyond what is needed to pass the spec.`,
    "03-review": `First load /skill:code-review. Review the diff from ${state.base}...HEAD against the provided spec and previous artifacts. Do not modify code. Write findings under ${state.runDir}/outputs/. Return completed even if findings exist; summarize blocking spec findings clearly.`,
    "04-fix": `First load /skill:tdd. Fix every blocking finding in the machine-readable handoff test-first. Add or adjust behavior tests that expose findings, then fix implementation and run validations. Report decisions, artifacts, modifiedFiles, and validationResults as facts. If a finding should be rejected, return needs_confirmation with the reason.`,
    "05-simplification": `First load /skill:codebase-design and /skill:tdd. Simplify the implementation without behavior changes or regressions. Work only while tests are green, make small refactors, and run validations yourself. Report artifacts, modifiedFiles, and validationResults as facts.`,
    "06-final-review": `First load /skill:code-review. Run a final review from ${state.base}...HEAD against the same spec. Do not modify code. Report all findings and mark blocking ones in blockingFindings (or use findings objects with blocking=true). Do not ask for confirmation merely because blocking findings remain; the runner will schedule a correction cycle. Return completed with a final summary.`
  }[step];

  return `${base}\nStep instructions:\n${stepPrompt}`;
}

function specContent(spec, cwd) {
  const maybePath = resolve(cwd, spec);
  if (existsSync(maybePath)) {
    const content = readFileSync(maybePath, "utf8");
    return `File: ${maybePath}\n---\n${content.slice(0, 60000)}${content.length > 60000 ? "\n...[truncated]" : ""}`;
  }
  return spec;
}

function previousArtifacts(state, step) {
  const index = STEPS.indexOf(step);
  const lines = [];
  for (const prior of STEPS.slice(0, index)) {
    const latest = state.steps[prior]?.latestPath;
    if (latest && existsSync(latest)) {
      const raw = readFileSync(latest, "utf8");
      lines.push(`## ${prior}\n${raw.slice(0, 12000)}${raw.length > 12000 ? "\n...[truncated]" : ""}`);
    }
  }
  return lines.join("\n\n") || "No previous artifacts.";
}

function correctionHandoff(state) {
  const reviewStep = state.steps[state.returnTo || "06-final-review"] ?? {};
  return {
    cycle: state.cycle,
    activeStep: state.activeStep,
    resumeFrom: state.resumeFrom,
    returnTo: state.returnTo,
    reason: state.reason,
    findings: state.findings,
    blockingFindings: state.findings,
    decisions: reviewStep.decisions ?? [],
    artifacts: reviewStep.artifacts ?? [],
    modifiedFiles: reviewStep.modifiedFiles ?? [],
    validationResults: reviewStep.validationResults ?? [],
  };
}

function extractJson(text) {
  const trimmed = text.trim();
  if (!trimmed) return null;
  try { return JSON.parse(trimmed); } catch {}
  const fenced = [...trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/g)].pop();
  if (fenced) {
    try { return JSON.parse(fenced[1].trim()); } catch {}
  }
  const starts = [];
  for (let i = 0; i < trimmed.length; i++) {
    if (trimmed[i] === "{") starts.push(i);
  }
  for (const start of starts) {
    for (let end = trimmed.length; end > start; end--) {
      const candidate = trimmed.slice(start, end).trim();
      if (!candidate.endsWith("}")) continue;
      try { return JSON.parse(candidate); } catch {}
    }
  }
  return null;
}

function tailLines(path, count) {
  const content = readFileSync(path, "utf8");
  return content.split(/\r?\n/).slice(-count);
}

function readState(runDir) {
  const statePath = join(runDir, "state.json");
  if (!existsSync(statePath)) throw new Error(`state.json not found in ${runDir}`);
  return normalizeState(JSON.parse(readFileSync(statePath, "utf8")));
}

function normalizeState(state) {
  state.version = Math.max(Number.isInteger(state.version) ? state.version : 0, RUNNER_VERSION);
  const activeStep = state.activeStep ?? state.currentStep ?? STEPS[0];
  state.activeStep = STEPS.includes(activeStep) ? activeStep : STEPS[0];
  state.currentStep = state.activeStep;
  state.cycle = Number.isInteger(state.cycle) && state.cycle > 0 ? state.cycle : 1;
  state.resumeFrom ??= null;
  state.returnTo ??= null;
  state.reason ??= null;
  state.findings = Array.isArray(state.findings) ? state.findings : [];
  state.revision = Number.isInteger(state.revision) && state.revision >= 0 ? state.revision : 0;
  state.steps ??= {};
  for (const step of STEPS) state.steps[step] ??= { status: "pending", attempt: 0 };
  return state;
}

function writeState(state) {
  mkdirSync(state.runDir, { recursive: true });
  const statePath = join(state.runDir, "state.json");
  const temporaryPath = `${statePath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporaryPath, JSON.stringify(state, null, 2));
    renameSync(temporaryPath, statePath);
  } catch (error) {
    try { unlinkSync(temporaryPath); } catch {}
    throw error;
  }
}

function touchState(state) {
  state.updatedAt = new Date().toISOString();
  state.revision = (Number.isInteger(state.revision) ? state.revision : 0) + 1;
  setActiveStep(state, state.activeStep ?? state.currentStep ?? STEPS[0]);
  writeState(state);
}

function summary(state, extra = {}) {
  return {
    status: extra.status ?? state.status,
    runDir: relativeOrAbsolute(process.cwd(), state.runDir),
    runId: state.runId,
    currentStep: extra.currentStep ?? state.activeStep,
    activeStep: extra.activeStep ?? extra.currentStep ?? state.activeStep,
    cycle: state.cycle,
    resumeFrom: state.resumeFrom,
    returnTo: state.returnTo,
    reason: extra.reason ?? state.reason,
    findings: extra.findings ?? state.findings,
    revision: state.revision,
    ...extra,
    statePath: relativeOrAbsolute(process.cwd(), join(state.runDir, "state.json")),
  };
}

function resumeCommand(state, step, { continueFlag = false, fresh = false } = {}) {
  const script = process.argv[1];
  return `node ${shellQuote(script)} resume --run ${shellQuote(relativeOrAbsolute(process.cwd(), state.runDir))} --step ${shellQuote(step)}${continueFlag ? " --continue" : ""}${fresh ? " --fresh" : ""} --answer ${shellQuote("<answer>")}`;
}


function ensureGitignore(cwd) {
  const path = join(cwd, ".gitignore");
  const line = ".pi/spec-loop-runs/";
  const current = existsSync(path) ? readFileSync(path, "utf8") : "";
  if (!current.split(/\r?\n/).includes(line)) {
    appendFileSync(path, `${current.endsWith("\n") || current.length === 0 ? "" : "\n"}${line}\n`);
  }
}

function gitSnapshot(cwd) {
  return {
    root: runGit(cwd, ["rev-parse", "--show-toplevel"]),
    initialHead: runGit(cwd, ["rev-parse", "HEAD"]),
    initialStatus: runGit(cwd, ["status", "--short"]),
  };
}

function runGit(cwd, args) {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  return r.status === 0 ? r.stdout.trim() : null;
}

function projectSlug(cwd) {
  const root = runGit(cwd, ["rev-parse", "--show-toplevel"]);
  return basename(root || cwd);
}

function slugify(value) {
  return String(value).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "project";
}

function relativeOrAbsolute(from, target) {
  const rel = relative(from, target);
  return rel && !rel.startsWith("..") ? rel : target;
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function printJson(value, exitCode = 0) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  process.exitCode = exitCode;
}

export { getBlockingFindings, normalizeChildResult, startCorrectionCycle, transitionAfterCompleted };

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    printJson({ status: "failed", reason: "runner_exception", message: error?.message ?? String(error) }, 1);
  });
}
