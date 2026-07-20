---
name: git-commits
description: >-
  Repo commit message and trailer contract: 13 Short Gitmojis subjects;
  Assisted-by; Reported-by for user-reported bugs; Suggested-by for human
  ideas and approach. No human-review trailers (0% human review).
  Use when committing or writing a commit message.
---

# Git commits and trailers

Everyday agent rules live in [AGENTS.md](../../../AGENTS.md). **Read this skill before every commit** (AGENTS.md requires it).

## Commit messages

Use [13 Short Gitmojis](https://mmap.page/dive-into/gitmoji/). Prefer the emoji **code** (e.g. `:bug:`) over the glyph.

### Format

```
:<type>:[scope:] <summary>
```

- `<type>` — one of the 13 codes below (required)
- `scope` — optional; prefer the project directory name in this monorepo (e.g. `:new:foo: add CLI`)
- `<summary>` — short description; imperative mood preferred
- Keep the first line under **50 characters** when practical

### Body

- After the subject, add a short body when motivation is not obvious from the diff.
- Explain the problem or trigger, not a file list.
- Put trailers after the body.

Examples:

```
:new:foo: scaffold Deno CLI
:memo: document monorepo layout
:zzz: ignore .DS_Store
```

### Types

| code | usage |
|-----------|------------------|
| `:bug:` | bug fix |
| `:new:` | new feature |
| `:fire:` | remove feature |
| `:boom:` | breaking changes |
| `:lock:` | security fix |
| `:art:` | refactor |
| `:zap:` | performance |
| `:100:` | test |
| `:memo:` | doc |
| `:zzz:` | chore |
| `:tada:` | release |
| `:poop:` | dirty |
| `:egg:` | Easter eggs |

### Notes

- `:lock:` is for security issues (a special kind of bug)
- `:fire:` is for removing a feature / API surface, not only deleting files
- `:poop:` marks dirty hacks or workarounds that may need cleanup later
- Do not invent other gitmoji codes (including those from the full gitmoji.dev catalogue) for this repo

## Commit trailers

Trailers record attribution (`Assisted-by` per commit when an agent helped; squash before merge if you prefer). Git `Author` is always the human, for `git blame`.

This repo has **0% human review**. Never add `Acked-by`, `Reviewed-by`, or any other review-depth trailer.

Trailer order after the subject/body:

1. `Reported-by` (when the user reported a valid bug this commit fixes)
2. `Suggested-by` (when a human suggested the idea or approach this commit implements)
3. `Assisted-by` (when an agent helped)

`Reported-by` and `Suggested-by` name **humans** only — never an agent. Agent help (including when the user asks an agent to review code) belongs in `Assisted-by`.

### Author

- Git `Author` is always the human. Never set the agent as author (breaks blame and ownership).
- The human owns what lands on `master`.

### Assisted-by

Required on every commit an AI agent materially helped produce. Follows the [Linux kernel AI coding assistants guidance](https://docs.kernel.org/process/coding-assistants.html).

```
Assisted-by: AGENT_NAME:MODEL_VERSION [TOOL1] [TOOL2]
```

- `AGENT_NAME` — the AI tool or framework (e.g. `Cursor`, `Claude Code`, `Copilot`)
- `MODEL_VERSION` — the model for **this** commit (e.g. `gpt-5.6`, `cursor-grok-4.5`); take it from the current session identity, never from a previous commit
- `[TOOL1] [TOOL2]` — optional specialized analysis tools only (e.g. `coccinelle`, `sparse`, `clang-tidy`)

Do not list basic development tools (git, compilers, make, editors).

```
:new:foo: scaffold Deno CLI

Assisted-by: Cursor:cursor-grok-4.5
```

- Always write `Assisted-by` for **this** commit from the agent/model that helped. Do **not** copy an `Assisted-by` line from `git log`, prior commits, or examples — those often name a different model.

### Reported-by

- On a `:bug:` fix for a bug the **user** reported and you confirmed valid, add `Reported-by: Name <email>`.
- Use the reporter’s usual git identity (from `Author`, prior commits, or what they give you in session).
- Do **not** add it when you found the bug without a user report, or when you disagreed and did not fix it.

```
:bug:foo: handle empty argv

Reported-by: weakish <weakish@gmail.com>
Assisted-by: Cursor:composer-2.5
```

### Suggested-by

- When a **human** suggested the idea or approach this commit implements, add `Suggested-by: Name <email>`.
- Use their usual git identity (from `Author`, prior commits, or what they give you in session).
- Covers design direction, not only bug reports. Use `Reported-by` for a confirmed bug report; both may appear when a report also drove the approach.
- Do **not** add it for generic “please fix / please implement” without a substantive suggestion, or when you invented the approach alone.

```
:art:foo: validate helpers return errors

Suggested-by: weakish <weakish@gmail.com>
Assisted-by: Cursor:cursor-grok-4.5
```
