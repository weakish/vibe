# jj vs git (agents as first-class)

**jj fits agent-heavy workflows better; git stays the interchange and ecosystem default.**

For this repo’s agent rules (multi-agent cwd, review → follow-up commit, message hygiene = report-only; human decides rewrite), jj removes a lot of ceremony agents get wrong — but does not erase the need for isolation and review policy.

## Where jj treats agents as first-class

| Concern | Git (status quo) | jj |
| --- | --- | --- |
| Working state | Index + working copy + stash; agents mishandle `add` / `stash` / `reset` | Working copy is always a commit (`@`); snapshot every command |
| Concurrent local editors | Lockfiles; AGENTS.md must say “don’t touch others’ files” | Operation log merges divergent ops; conflicts recorded, repo not corrupt |
| Conflicts | Block rebase/merge mid-flight | First-class in commits; work continues; resolve later |
| Undo agent mistakes | reflog / careful reset (this repo bans hard reset) | `jj undo` / `jj op log` / `jj op restore` as normal tools |
| Rewrite / squash | Scary; skills fence amend and message-only rewrite | Rewrites are routine; change identity is stable (`change_id`), commit id moves |
| Parallel agents | Worktrees or “same tree, stay in your lane” | Prefer **one workspace per agent**; still don’t share a working copy |

Agents like fewer states and fewer “interrupted operation” modes. jj’s model matches that; git’s staged / unstaged / detached / rebase-in-progress does not.

## Where git still wins (including for agents)

- **Ecosystem** — GitHub, `gh`, hooks, CI, blame UX, every agent’s default tools.
- **Human review contract** — `Assisted-by` / `Acked-by` / “review trailers certify that commit” map cleanly onto **immutable commit objects**. jj rewrites change commit ids constantly — agents must use **change ids** (and bookmarks), not SHAs, or review/trailers get confusing.
- **Intentional friction** — Review skill: message hygiene is report-only; human decides rewrite. That is policy on top of git’s cost of rewrite. jj makes rewrite cheap; agents will rewrite unless the skill is even stricter.
- **Colocated hybrid** — `jj` + `.git` works, but mixed mutating `git` + `jj` is a footgun; agents need “mutate with jj only.”

## Mapped to this repo’s agent habits

1. **Multi-agent cwd** — Git forces social rules; jj reduces *repo* corruption risk but **not** WC file races. Still one workspace (or worktree) per agent.
2. **Review → new commit** — In git, follow-up commits are the safe default. In jj, the natural move is often `jj squash` / edit `@` / split — closer to amend. Rephrase the skill as “new *change*” vs “edit current change,” and keep “don’t rewrite published bookmarks” as the hard line.
3. **Message hygiene** — Same policy either way: report; don’t auto-rewrite. jj just makes accidental rewrite more tempting.
4. **Interchange** — Stay colocated: agents can use jj locally; `master` / PRs stay git for GitHub.

## Verdict

- **Agent runtime / recovery / concurrency of repo metadata:** jj is clearly better.
- **Publication, GitHub, existing skills, trailer-per-commit semantics:** git (or jj colocated, git for push/PR) wins.
- **Practical path if agents come first:** colocated jj, one workspace per agent, bookmarks for publish points, rewrite skills rewritten around change ids + op log — not a wholesale drop of git.

Not worth migrating this dotfiles repo for agent comfort alone unless multi-agent git collisions are a daily fight. The win is larger for multi-agent *product* repos than for a single-human + occasional parallel agents setup.

## Further reading

- [Will agents like Git any more than we do? (Amplify Partners)](https://www.amplifypartners.com/blog-posts/will-agents-like-git-any-more-than-we-do)
- [jj concurrency](https://docs.jj-vcs.dev/latest/technical/concurrency/)
- [jj operation log](https://docs.jj-vcs.dev/latest/operation-log/)
- [jj git compatibility (colocated)](https://docs.jj-vcs.dev/latest/git-compatibility/)
