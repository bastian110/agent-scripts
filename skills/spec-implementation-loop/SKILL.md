---
name: spec-implementation-loop
description: "Implement a written spec through independently launchable general-purpose Pi subagents: clarify behavior, implement vertical slices, review and fix, simplify safely, and run a fresh final review. Use for feature specs, issues, PRDs, and review-fix-review implementation work."
---
 
# Spec Implementation Loop
 
Implement a written spec correctly, then simplify without changing behavior. The parent session owns decisions and delegates execution to Pi subagents to preserve its context.
 
## Core policy
 
1. Correctness before simplification.
2. Observable behavior before implementation details.
3. One vertical slice and one active writer at a time.
4. Never refactor while tests or required validations fail.
5. Review the complete workspace, including untracked files.
6. Preserve unrelated user changes; never discard the working tree.
 
## Delegation
 
Load `pi-subagents` and list available agents before launching any. Use the general-purpose `delegate` for every phase and prefer asynchronous runs. Do not create specialized agent definitions: specialize each child at launch with its mission, compact context, and only the skills it needs.
 
```ts
subagent({
  agent: "delegate",
  task: "Mission, context, success criteria, validation, and report expected...",
  context: "fresh",
  skill: ["relevant-skill"],
  async: true,
})
```
 
Every phase below is independently launchable. Do not make the workflow depend on an indivisible chain. Give each child a compact handoff containing:
 
- spec source and confirmed behavior plan;
- review base and initial `git status --short`;
- scope, exclusions, and accepted assumptions;
- validation commands;
- the phase goal, success criteria, and expected report.
 
Pass referenced spec or plan files through the mission or `reads`, and pass selected skills through `skill`; do not expose the whole skill catalog by default. Start each phase in a fresh child session. Preserve continuity only when useful—for example, across implementation slices or review/fix rounds—with `subagent({ action: "resume", id: "...", message: "..." })`; keep only the relevant run ID. Simplification and each final review always get separate fresh sessions. A child must inspect the real workspace and must not launch subagents. Never let the parent or another child edit while a writer is active.
 
## 1. Establish the contract
 
The parent identifies the spec source, review base, validations, and exclusions. If the spec or base is missing, ask for it. If validations are unclear, inspect the repository and propose them. Verify the base, record the initial workspace status, and produce:
 
```md
## Behaviors
1. ...
## Out of scope
- ...
## Public behavior or interface
- ...
## Validation
- `...`
## Assumptions
- ...
```
 
Ask the user to confirm unless autonomous execution was explicitly requested. Ask only about ambiguities that materially affect behavior, scope, compatibility, data, or safety; record reasonable non-blocking assumptions and continue.
 
## 2. Implement
 
Launch a fresh `delegate` as the sole writer, with any implementation skill required by the task. It implements one smallest complete vertical slice at a time through the public or user-visible interface, adds useful behavior or regression tests, and runs the narrowest relevant validation after each slice. Continue only when the slice is green. Resume the same child for later slices when its context remains useful. After all slices, run the full agreed validation suite.
 
Do not add speculative behavior or unrelated refactors. Load a relevant design skill for planned UI work without expanding visual scope.
 
## 3. Review and fix
 
Launch a fresh `delegate` with a review-and-fix mission and permission to edit. It reviews both:
 
- **Spec:** missing or partial behavior, wrong behavior, specified edge cases, scope creep.
- **Standards:** repository rules, correctness, error handling, security, compatibility, maintainability, tests coupled to implementation details, duplication, complexity, and module seams.
 
Its scope is the review base versus the complete workspace: committed, staged, unstaged, and relevant untracked files. It must not rely exclusively on a committed diff. It fixes blocking findings, adds or adjusts useful tests, runs targeted validation, then full validation. Resume this same session and repeat review/fix until no blocking spec finding remains. If rejecting a finding, explain why and ask the user to confirm the tradeoff.
 
A fix is also an independent phase: launch a fresh `delegate` with the contract and accepted findings whenever another phase—especially final review—requests changes. Ask the user before fixes requiring an unapproved product, scope, or architecture decision.
 
## 4. Simplify
 
Only after full validation passes and no blocking spec finding remains, launch a separate fresh `delegate` with `skill: "codebase-design"` when available. It removes unnecessary duplication, branching, pass-throughs, misplaced seams, leaked caller knowledge, and unsupported abstractions.
 
Make small behavior-preserving changes, validate each, and finish with full validation. Prefer deletion and concentration of complexity over new abstraction.
 
## 5. Final review
 
Launch a separate fresh `delegate` with an explicit read-only final-review mission. It checks the same contract, review base, complete workspace, validations, scope, and simplification result.
 
If it finds a blocking issue, launch the independent fix phase, validate, then run another fresh final-review session. Exit only when requirements are complete, no blocking spec finding or scope creep remains, full validation passes, simplification preserved behavior, and accepted tradeoffs are documented.
 
## Final response
 
Report implemented behavior, review base, findings fixed, simplifications, validation commands and results, remaining tradeoffs, and any residual risk. If work stops early, name the phase, blocker, and exact user decision or input required.