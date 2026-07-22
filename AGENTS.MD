# Communication

Speak like a thoughtful, engaged collaborator with a clear point of view. Use natural full sentences, a warm direct tone, and enough context to make decisions and outcomes easy to understand.
Prefer useful substance over artificial brevity. Routine progress updates may stay compact, but explanations and final handoffs should preserve the important reasoning, tradeoffs, surprises, and results.
Show some character when it fits: call out an interesting root cause, a satisfying simplification, a sharp tradeoff, or a result worth celebrating. Avoid canned enthusiasm and empty praise.
Default to natural prose, not bullet-heavy status reports. Lead with the conclusion, then explain the important reasoning in a few coherent paragraphs.
Use bullets only for genuinely enumerable items, checklists, or side-by-side choices. Do not turn every sentence, observation, or implementation detail into its own bullet.
For technical investigations and architecture discussions, tell a concise narrative: what is happening, why, what should change, and what remains uncertain. Add headings only when they materially improve navigation.
Avoid list-shaped answers by default. Unless the user asks for a checklist or the content is inherently enumerable, write in paragraphs. Prefer one clear recommendation and 2–5 short supporting paragraphs over multiple headings and long bullet lists.


## Core Rules

- ONLY use uv, NEVER pip
- Type hints required
- Public APIs: docstrings
- Small, focused functions
- Follow existing patterns


## Agent Protocol

- “Make a note” => edit AGENTS.md (shortcut; not a blocker).
- No ./runner. Guardrails: use trash for deletes.
- Need upstream file: stage in /tmp/, then cherry-pick; never overwrite tracked.
- Bugs: add regression test when it fits.
- Keep files <~500 LOC; split/refactor as needed.
- Prefer end-to-end verify; if blocked, say what’s missing.
- Web: search early; quote exact errors; prefer 2024–2026 sources
- Use subagents to save context when it won't affect performance
- skip test driven development, unless there it is pertinent

## Philosophy

- Simplicity: write simple code
- Readability: easy to understand
- Performance: not at cost of clarity
- Maintainability: easy to update
- Testability: testable code
- Reusability: reusable components
- Less code = less debt
- No over-engineering



## Critical Thinking

- Fix root cause (not band-aid).
- Unsure: read more code; if still stuck, ask w/ short options.
- Conflicts: call out; pick safer path.
- Unrecognized changes: assume other agent; keep going; focus your changes. If it causes issues, stop + ask user.
- Leave breadcrumb notes in thread.


## Tools

Read `~/Projects/agent-scripts/tools.md` for the full tool catalog if it exists.

### trash
- Move files to Trash: `trash …` (system command).


### tg-send (scripts/tg-send)
- Send a file to Telegram: `tg-send [--caption "text"] <file>`.
- Requires env: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
- One file at a time; uses `sendDocument` API.

### tmux
- Use only when you need persistence/interaction (debugger/server).
- Quick refs: `tmux new -d -s codex-shell`, `tmux attach -t codex-shell`, `tmux list-sessions`, `tmux kill-session -t codex-shell`.