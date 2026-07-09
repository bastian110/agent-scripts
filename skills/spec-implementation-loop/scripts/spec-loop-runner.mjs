#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, appendFileSync } from "node:fs";
import { basename, join, resolve, relative } from "node:path";
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
const SESSION_GROUP = {
  "01-spec-intake": "01-spec-intake",
  "02-implementation": "02-implementation",
  "03-review": "03-review-fix",
  "04-fix": "03-review-fix",
  "05-simplification": "05-simplification",
  "06-final-review": "06-final-review",
};
const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;
const RUNNER_VERSION = 1;

function main() {
  const [command, ...rest] = process.argv.slice(2);
  try {
    if (command === "start") return start(parseArgs(rest));
    if (command === "resume") return resume(parseArgs(rest));
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

function start(args) {
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
    currentStep: STEPS[0],
    status: "running",
    steps: Object.fromEntries(STEPS.map((step) => [step, { status: "pending", attempt: 0 }])),
  };
  writeState(state);
  return runStepAndMaybeContinue(state, STEPS[0]);
}

function resume(args) {
  if (!args.run) return printJson({ status: "failed", reason: "missing_run", usage: usage() }, 2);
  const state = readState(resolve(args.run));
  if (args.timeoutMs !== undefined) state.timeoutMs = args.timeoutMs;
  if (args.piBin) state.piBin = args.piBin;
  if (args.approve !== undefined) state.approve = args.approve;

  const step = args.step || state.currentStep;
  if (!STEPS.includes(step)) return printJson({ status: "failed", reason: "unknown_step", step, steps: STEPS }, 2);
  return runStepAndMaybeContinue(state, step, {
    answer: args.answer,
    fresh: Boolean(args.fresh),
    forceContinue: Boolean(args.continue),
  });
}

function runStepAndMaybeContinue(state, step, options = {}) {
  const result = runOneStep(state, step, options);
  if (result.status !== "completed") return printJson(result, result.status === "failed" ? 1 : 0);

  const nextStep = NEXT_STEP[step];
  if (!nextStep) {
    state.status = "completed";
    state.currentStep = step;
    touchState(state);
    return printJson(summary(state, { status: "completed", completedStep: step, nextStep: null }), 0);
  }

  if (state.mode === "checkpoints" && !options.forceContinue) {
    state.status = "checkpoint";
    state.currentStep = nextStep;
    touchState(state);
    return printJson(summary(state, {
      status: "checkpoint",
      completedStep: step,
      nextStep,
      resumeCommand: resumeCommand(state, nextStep, { continueFlag: true }),
    }), 0);
  }

  return runStepAndMaybeContinue(state, nextStep);
}

function runOneStep(state, step, options = {}) {
  const stepState = state.steps[step] ?? { status: "pending", attempt: 0 };
  const attempt = options.fresh || stepState.attempt === 0 ? stepState.attempt + 1 : stepState.attempt;
  const sessionId = `spec-loop-${state.runId}-${SESSION_GROUP[step] ?? step}-a${attempt}`;
  const logPath = join(state.runDir, "logs", `${step}.attempt-${attempt}.log`);
  const outputPath = join(state.runDir, "outputs", `${step}.attempt-${attempt}.json`);
  const latestPath = join(state.runDir, "outputs", `${step}.latest.json`);

  state.status = "running";
  state.currentStep = step;
  state.steps[step] = { ...stepState, status: "running", attempt, sessionId, logPath, outputPath };
  touchState(state);

  const prompt = buildPrompt(state, step, { answer: options.answer });
  const piArgs = [];
  if (state.approve) piArgs.push("--approve");
  piArgs.push("--session-id", sessionId);
  piArgs.push("-p", prompt);

  const startedAt = new Date().toISOString();
  const child = spawnSync(state.piBin, piArgs, {
    cwd: state.cwd,
    encoding: "utf8",
    timeout: state.timeoutMs === 0 ? undefined : state.timeoutMs,
    maxBuffer: 50 * 1024 * 1024,
  });
  const finishedAt = new Date().toISOString();
  const combinedLog = [
    `# ${step} attempt ${attempt}`,
    `startedAt: ${startedAt}`,
    `finishedAt: ${finishedAt}`,
    `sessionId: ${sessionId}`,
    `command: ${state.piBin} ${piArgs.map(shellQuote).join(" ")}`,
    "\n## stdout\n",
    child.stdout || "",
    "\n## stderr\n",
    child.stderr || "",
  ].join("\n");
  writeFileSync(logPath, combinedLog);

  if (child.error?.code === "ETIMEDOUT") return failStep(state, step, attempt, "timeout", logPath, outputPath);
  if (child.error) return failStep(state, step, attempt, "child_error", logPath, outputPath, child.error.message);
  if (child.status !== 0) return failStep(state, step, attempt, "child_exit_nonzero", logPath, outputPath, `exit ${child.status}`);

  const parsed = extractJson(child.stdout || "");
  if (!parsed) return failStep(state, step, attempt, "child_json_parse_failed", logPath, outputPath);
  writeFileSync(outputPath, JSON.stringify(parsed, null, 2));
  copyFileSync(outputPath, latestPath);

  const normalized = normalizeChildResult(parsed);
  state.steps[step] = {
    status: normalized.status,
    attempt,
    sessionId,
    logPath,
    outputPath,
    latestPath,
    summary: normalized.summary,
    question: normalized.question,
    recommendedAnswer: normalized.recommendedAnswer,
    finishedAt,
  };
  state.status = normalized.status === "completed" ? "running" : normalized.status;
  touchState(state);

  if (normalized.status === "completed") return summary(state, { status: "completed", completedStep: step, nextStep: NEXT_STEP[step] });
  if (normalized.status === "needs_confirmation") {
    return summary(state, {
      status: "needs_confirmation",
      currentStep: step,
      question: normalized.question || "Child Pi requested confirmation.",
      recommendedAnswer: normalized.recommendedAnswer,
      logPath,
      outputPath,
      resumeCommand: resumeCommand(state, step),
    });
  }
  return summary(state, {
    status: "failed",
    currentStep: step,
    reason: normalized.reason || "child_reported_failure",
    logPath,
    outputPath,
    resumeCommand: resumeCommand(state, step),
  });
}

function failStep(state, step, attempt, reason, logPath, outputPath, message) {
  state.status = "failed";
  state.currentStep = step;
  state.steps[step] = { ...state.steps[step], status: "failed", attempt, reason, message, logPath, outputPath };
  touchState(state);
  return summary(state, { status: "failed", currentStep: step, reason, message, logPath, resumeCommand: resumeCommand(state, step) });
}

function normalizeChildResult(value) {
  const status = value.status === "needs_confirmation" || value.needsConfirmation === true
    ? "needs_confirmation"
    : value.status === "failed"
      ? "failed"
      : "completed";
  return {
    status,
    summary: value.summary ?? value.message ?? "",
    question: value.question,
    recommendedAnswer: value.recommendedAnswer ?? value.recommended_answer,
    reason: value.reason,
  };
}

function buildPrompt(state, step, { answer } = {}) {
  const specBody = specContent(state.spec, state.cwd);
  const previous = previousArtifacts(state, step);
  const validationsText = state.validations.length
    ? state.validations.map((v) => `"${v}"`).join(", ")
    : "not provided; inspect repo scripts if needed";
  const answerText = answer ? `\nUser/orchestrator answer for this resumed step:\n${answer}\n` : "";
  const base = `You are a child Pi agent executing one step of a spec implementation loop.\n\nIMPORTANT OUTPUT CONTRACT:\n- Print exactly one JSON object to stdout and nothing else.\n- Valid statuses: "completed", "needs_confirmation", "failed".\n- For completed include: {"status":"completed","summary":"...","artifacts":["..."]}.\n- For needs_confirmation include: {"status":"needs_confirmation","question":"...","recommendedAnswer":"...","summary":"..."}.\n- For failed include: {"status":"failed","reason":"...","summary":"..."}.\n\nRun context:\n- cwd: ${state.cwd}\n- runDir: ${state.runDir}\n- spec input: ${state.spec}\n- base review ref: ${state.base}\n- validation commands: ${validationsText}\n- current step: ${step}\n${answerText}\nSpec content/reference:\n${specBody}\n\nPrevious step artifacts summary:\n${previous}\n`;

  const stepPrompt = {
    "01-spec-intake": `First load /skill:tdd. Ingest the existing spec only; do not generate a new spec. Extract observable behaviors, out-of-scope items, likely public/user-visible surfaces, validations to use, and assumptions. If ambiguity is blocking, return needs_confirmation. If ambiguity is non-blocking, continue and include assumptions in your artifact. Write a markdown or JSON artifact under ${state.runDir}/outputs/. Do not modify application code.`,
    "02-implementation": `First load /skill:tdd. Implement the behaviors from 01-spec-intake as vertical TDD slices. Modify code/tests as needed. Run relevant validations yourself. Do not review or simplify beyond what is needed to pass the spec.`,
    "03-review": `First load /skill:review. Review the diff from ${state.base}...HEAD against the provided spec and previous artifacts. Do not modify code. Write findings under ${state.runDir}/outputs/. Return completed even if findings exist; summarize blocking spec findings clearly.`,
    "04-fix": `First load /skill:tdd. Fix the review findings test-first. Add or adjust behavior tests that expose findings, then fix implementation and run validations. If a finding should be rejected, return needs_confirmation with the reason.`,
    "05-simplification": `First load /skill:codebase-design and /skill:tdd. Simplify the implementation without behavior changes or regressions. Work only while tests are green, make small refactors, and run validations yourself.`,
    "06-final-review": `First load /skill:review. Run a final review from ${state.base}...HEAD against the same spec. Do not modify code. If blocking findings remain, return needs_confirmation asking whether to run another review-fix cycle; otherwise return completed with final summary.`,
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

function readState(runDir) {
  const statePath = join(runDir, "state.json");
  if (!existsSync(statePath)) throw new Error(`state.json not found in ${runDir}`);
  return JSON.parse(readFileSync(statePath, "utf8"));
}

function writeState(state) {
  mkdirSync(state.runDir, { recursive: true });
  writeFileSync(join(state.runDir, "state.json"), JSON.stringify(state, null, 2));
}

function touchState(state) {
  state.updatedAt = new Date().toISOString();
  writeState(state);
}

function summary(state, extra = {}) {
  return {
    status: extra.status ?? state.status,
    runDir: relativeOrAbsolute(process.cwd(), state.runDir),
    runId: state.runId,
    currentStep: extra.currentStep ?? state.currentStep,
    ...extra,
    statePath: relativeOrAbsolute(process.cwd(), join(state.runDir, "state.json")),
  };
}

function resumeCommand(state, step, { continueFlag = false } = {}) {
  const script = process.argv[1];
  return `node ${shellQuote(script)} resume --run ${shellQuote(relativeOrAbsolute(process.cwd(), state.runDir))} --step ${shellQuote(step)}${continueFlag ? " --continue" : ""} --answer ${shellQuote("<answer>")}`;
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

main();
