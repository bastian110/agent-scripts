# Development Guidelines

Work style: min tokens, excellent orthograph and diverse vocabulary. if I ask you to explain me a point, explain me comprehensively.
When explain me a point, be sure i understood by giving me 3 simple exercices to incitate me to reflect on it.

## Core Rules

- ONLY use uv, NEVER pip

- Type hints required
- Public APIs: docstrings
- Small, focused functions
- Follow existing patterns

- Tests: uv run pytest
- Async tests: anyio, not asyncio
- Test edge cases, errors
- New features: tests
- Bug fixes: regression tests

## Agent Protocol

- “Make a note” => edit AGENTS.md (shortcut; not a blocker).
- No ./runner. Guardrails: use trash for deletes.
- Need upstream file: stage in /tmp/, then cherry-pick; never overwrite tracked.
- Bugs: add regression test when it fits.
- Keep files <~500 LOC; split/refactor as needed.
- Prefer end-to-end verify; if blocked, say what’s missing.
- Web: search early; quote exact errors; prefer 2024–2025 sources
- Use subagents to save context when it won't affect performance
- skip test driven development, unless there it is usefull

## Philosophy

- Simplicity: write simple code
- Readability: easy to understand
- Performance: not at cost of clarity
- Maintainability: easy to update
- Testability: testable code
- Reusability: reusable components
- Less code = less debt
- No over-engineering

## Best Practices

- Early returns, avoid nesting
- Descriptive names (handlers: handle_*)
- Prefer constants
- DRY: no repetition
- Functional style if not verbose
- Minimal changes per task
- Compose before components
- TODO: mark issues
- Simplicity > cleverness
- Build iteratively, verify
- Test frequently, realistic inputs
- Build test envs for hard-to-test
- Functional/stateless for clarity
- Core logic clean, details at edges
- File org: simple, scale-appropriate

## Formatting

- Ruff format: uv run ruff format .
- Ruff check: uv run ruff check .
- Ruff fix: uv run ruff check . --fix

## Error Resolution

- Line length: break strings, multi-line calls, split imports
- Types: add None checks, narrow types, match patterns

- Check git status before commit
- Run formatters before type checks
- Minimal changes
- Follow patterns
- Document public APIs
- Test thoroughly
- See readme.md or agent.md for project rules

## Critical Thinking

- Fix root cause (not band-aid).
- Unsure: read more code; if still stuck, ask w/ short options.
- Conflicts: call out; pick safer path.
- Unrecognized changes: assume other agent; keep going; focus your changes. If it causes issues, stop + ask user.
- Leave breadcrumb notes in thread.


## Tools

Read `~/Projects/agent-scripts/tools.md` for the full tool catalog if it exists.

### committer
- Commit helper (PATH). Stages only listed paths; required here. Repo may also ship `./scripts/committer`.

### trash
- Move files to Trash: `trash …` (system command).

### bin/docs-list / scripts/docs-list.ts
- Optional. Lists `docs/` + enforces front-matter. Ignore if `bin/docs-list` not installed. Rebuild: `bun build scripts/docs-list.ts --compile --outfile bin/docs-list`.

### bin/browser-tools / scripts/browser-tools.ts
- Chrome DevTools helper. Cmds: `start`, `nav`, `eval`, `screenshot`, `pick`, `cookies`, `inspect`, `kill`.
- Rebuild: `bun build scripts/browser-tools.ts --compile --target bun --outfile bin/browser-tools`.

### gh
- GitHub CLI for PRs/CI/releases. Given issue/PR URL (or `/pull/5`): use `gh`, not web search.
- Examples: `gh issue view <url> --comments -R owner/repo`, `gh pr view <url> --comments --files -R owner/repo`.

### Skills (Claude Code)
- Skills folder: `~/.claude/skills/`. Check before any task — invoke via `Skill` tool.
- Per-project skills: `.claude/skills/` in repo root.
- Always invoke relevant skill before responding; even 1% chance = invoke.

### Slash Commands
- Global: `~/.codex/prompts/`. Repo-local: `docs/slash-commands/`.
- Common: `/handoff`, `/pickup`.

### tg-send (scripts/tg-send)
- Send a file to Telegram: `tg-send [--caption "text"] <file>`.
- Requires env: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.
- One file at a time; uses `sendDocument` API.

### tmux
- Use only when you need persistence/interaction (debugger/server).
- Quick refs: `tmux new -d -s codex-shell`, `tmux attach -t codex-shell`, `tmux list-sessions`, `tmux kill-session -t codex-shell`.

<frontend_aesthetics>
Avoid “AI slop” UI. Be opinionated + distinctive.

Do:
- Typography: pick a real font; avoid Inter/Roboto/Arial/system defaults.
- Theme: commit to a palette; use CSS vars; bold accents > timid gradients.
- Motion: 1–2 high-impact moments (staggered reveal beats random micro-anim).
- Background: add depth (gradients/patterns), not flat default.

Avoid: purple-on-white clichés, generic component grids, predictable layouts.
</frontend_aesthetics>

