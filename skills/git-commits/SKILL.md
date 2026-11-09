---
name: git-commits
description: >-
  Agent commit extras on top of the vibe Contributing contract in
  AGENTS.md: Assisted-by format, amend union, message-only rewrite,
  no agent author. Use when committing or writing a commit message.
---

# Git commits and trailers

Message shape, gitmoji types, trailer names/order, and no agent
`Co-authored-by` are in the current project's `AGENTS.md` (Contributing
section from the vibe package). **Read that section and this skill before
every commit.** Everyday agent rules live in `AGENTS.md`.

## Author

- Git `Author` is always the human. Never set the agent as author (breaks blame
  and ownership).
- The human owns what lands on `master`.

## Assisted-by

Required on every commit an AI agent materially helped produce. Follows the
[Linux kernel AI coding assistants guidance](https://docs.kernel.org/process/coding-assistants.html).
Message-only rewrites do not qualify — see [Message-only rewrite](#message-only-rewrite).

```
Assisted-by: AGENT_NAME:MODEL_VERSION [TOOL1] [TOOL2]
```

- `AGENT_NAME` — the AI tool or framework (e.g. `Cursor`, `Claude Code`, `Copilot`)
- `MODEL_VERSION` — the model that helped **this** commit’s tree (e.g. `gpt-5.6`, `cursor-grok-4.5`). For a new commit, take it from the current session identity, not from a different commit. Message-only rewrite and amend union: see below.
- `[TOOL1] [TOOL2]` — optional specialized analysis tools only (e.g. `coccinelle`, `sparse`, `clang-tidy`)

Do not list basic development tools (git, compilers, make, editors).

```
:new:foo: scaffold Deno CLI

Assisted-by: Cursor:cursor-grok-4.5
```

- For a **new** commit this session produced: write `Assisted-by` from this session’s agent/model. Do **not** copy a line from `git log`, a different commit, or examples — those often name a different model.
- [Message-only rewrite](#message-only-rewrite) (same tree): keep the existing lines; do not add this session if absent.
- When **amending** a commit to add tree this session produced: union this session’s `AGENT_NAME:MODEL_VERSION` with that commit’s existing `Assisted-by` lines (one line per pair; dedupe exact duplicates). Do not drop the original model.

`Reported-by` and `Suggested-by` name **humans** only — never an agent. Agent
help (including when the user asks an agent to review code) belongs in
`Assisted-by`.

- `Reported-by`: on a `:bug:` fix for a bug the **user** reported and you confirmed valid. Use the reporter’s usual git identity. Do **not** add it when you found the bug without a user report, or when you disagreed and did not fix it.
- `Suggested-by`: when a **human** suggested the idea or approach. Use their usual git identity. Do **not** add it for generic “please fix / please implement” without a substantive suggestion, or when you invented the approach alone.

Never add `Co-authored-by` (or `Co-Authored-By`) naming an agent or bot, e.g.
`Cursor <cursoragent@cursor.com>`. Leave legitimate human `Co-authored-by`
untouched.

This repo's Cursor hook `.cursor/hooks/strip-agent-coauthor.py`
(`.cursor/hooks.json`, `preToolUse` and `postToolUse`) strips injected Cursor
agent `Co-authored-by` trailers (`cursoragent@cursor.com`). After changing the
hook or its tests, run `python3 -B .cursor/hooks/test_strip_agent_coauthor.py`.

## Message-only rewrite

Same tree, new commit object — polish message or strip bad trailers. The diff to
the parent must stay identical; do not fold staged or working-tree path changes
into the rewrite. No pathspec, so the index is ignored:

```
git commit --amend --only -m "$(cat <<'EOF'
…message…
EOF
)"
```

- Keep existing `Assisted-by` line(s). Do **not** replace with the rewriting session’s model.
- Do **not** add `Assisted-by` for the rewriter when absent — rewriting the message is not producing the diff.
- Strip agent/bot `Co-authored-by`; leave legitimate human `Co-authored-by` untouched.
- Do not drop `Reported-by` / `Suggested-by` when they still apply; correct them when hygiene requires it (see above).
