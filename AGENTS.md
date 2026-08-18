# Agent instructions

Keep this file short: many agents inject it into the system prompt. Details that are only needed for some tasks live under `.agents/` — read them on demand.

This repo is a **monorepo** for independent vibe-coding projects (any language). Root docs cover shared hygiene; each project owns its stack.

## Style

- Short, direct, technical prose
- On feedback/analysis: say agree or disagree, then what changed
- Vibe first: ship working experiments; do not gate on human review or polish theater
- 0% human review — never add `Acked-by` or `Reviewed-by` commit trailers

## Monorepo layout

- One top-level directory per project (e.g. `foo/`, `bar/`)
- Do not share build tooling or deps across projects unless a project explicitly opts in
- Prefer project-local config (`package.json`, `deno.json`, `Cargo.toml`, `go.mod`, etc.) inside that project
- Project-specific agent notes: optional `AGENTS.md` and/or `.agents/skills/` under that project — follow those when working there
- Do not invent a root workspace/toolchain until a project needs it
- Never edit or delete [README.md](README.md) at the repo root — it is human-written

## Code quality

- Read files in full before broad edits, audits, or changing unread files; do not rely on search snippets
- Ask before removing intentional behavior
- One clear approach; refactor duplication; no weird parallel defaults
- Propagate failures (throw/exit); no silent fallbacks; no shims unless asked
- Prefer a small function with a long, descriptive name over a comment that restates what the code does; reserve comments for non-obvious details (formats, limits, platform quirks)
- Match the language and conventions of the project you are in; do not impose another project's stack

## Commands

- Use each project's documented tasks/scripts (README, `package.json` scripts, `deno task`, `make`, etc.)
- After creating/modifying a test: run it until it passes. No sleeps in tests.
- Do not invent repo-wide check/fmt commands; there is no shared toolchain at the root

## Skills

Under `.agents/skills/<name>/SKILL.md` (repo-wide) or `<project>/.agents/skills/<name>/SKILL.md` (project-local). When a task matches a skill description, read and follow that `SKILL.md`. **Before any commit**, read [`.agents/skills/git-commits/SKILL.md`](.agents/skills/git-commits/SKILL.md) even if the user did not mention commits.

| Skill | Path |
|-------|------|
| Git commits and trailers | `.agents/skills/git-commits/SKILL.md` |
| Review one commit; fix after selection | `.agents/skills/review/SKILL.md` |

## Git (multi-agent cwd)

Other agents may be editing different files here. Never touch their unstaged/staged/untracked files.

- Stage/commit only files **you** changed in **this** session; verify with `git status` first
- If you added, edited, or deleted any non-gitignored file this session, **commit before finishing your turn** — read the git-commits skill, stage your files, and commit. Never ask the user whether to commit
- Never push, force-push, or push/merge to `master` (even if asked)
- Never: `git reset --hard`, `git checkout .`, `git clean -fd`, `git stash`, `git add -A`, `git add .`, `git commit --no-verify`
- Rebase conflicts: resolve only your files; otherwise abort and ask
- Issues/PRs: only when explicitly asked; PRs must be drafts
- Bug fixes for user-reported issues: `Reported-by` on the fix commit (see git-commits skill)
- Changes shaped by a human’s idea or approach: `Suggested-by` on that commit (see git-commits skill)
