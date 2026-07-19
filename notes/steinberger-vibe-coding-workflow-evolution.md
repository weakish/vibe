# From Plan Mode to Inference Speed: Peter Steinberger's Evolving Agentic Workflow

*An essay on how one prolific builder's approach to AI-assisted software changed between August and December 2025 — and what that shift says about the field.*

---

In the second half of 2025, Peter Steinberger published three workflow essays that read less like a static methodology and more like a time-lapse. The arc is not subtle. In August he was still centering Claude Code inside Ghostty, iterating plans with GPT-5 review, and pruning MCP servers. By October he had moved wholesale to OpenAI's Codex CLI, was running three to eight agents in parallel on `main`, and was arguing that most of the industry's scaffolding — plan mode, subagents, RAG harnesses, plugin marketplaces — amounted to "charades." By December he reported shipping at a pace bounded mainly by inference time, rarely reading the code his agents produced, and treating a five-hour Zig refactor as a routine Tuesday.

Taken together, these posts document something larger than one person's tool preferences. They trace how fast the ceiling moved for a skilled operator when models, harnesses, and habits co-evolved — and how the human role shifted from careful reviewer to systems architect, queue manager, and occasional steering wheel.

## The August Baseline: Claude, Ghostty, and Deliberate Frugality

Steinberger's [August workflow post](https://steipete.me/posts/2025/optimal-ai-development-workflow) ("My Current AI Dev Workflow") already assumed agentic development as normal. He had briefly gone all-in on VS Code, then returned to Ghostty as the primary surface because VS Code's terminal froze on large pastes and Zed's terminal aesthetics did not suit him. VS Code and Cursor/GPT-5 remained sidecars — lookup, review, occasional CLI work.

The stack was opinionated about *less*:

- **Parallelism, but bounded.** One or two agents for most work; roughly four for cleanup, tests, or UI — scaled to blast radius.
- **Plan mode as a first-class step.** Smaller tasks shipped immediately; larger ones went into a file and passed to GPT-5 for review before execution.
- **Worktrees rejected.** He had tried the worktree pattern and found it slowed him down; careful area selection on `main` was enough.
- **MCP minimalism.** He removed his last MCP because Claude would spin up Playwright unasked when reading code was faster and cheaper in context.
- **CLI-native services.** Vercel, `psql`, `gh`, Axiom — one-liners in `CLAUDE.md` beat bespoke integrations.

Claude was acknowledged as messy but excellent at refactoring; the loop was build mess, then clean mess. Testing happened in the *same context* as the feature — context was treated as precious, not to be squandered on a fresh session for tests alone.

Even here, the posture was skeptical of background agents: steering mattered, and drift was easier to catch when you watched the stream. GPT-5 in Cursor was praised for review but criticized for latency and opaque reasoning. Codex could not search the web effectively; "google best practices" beat hoping the model already knew.

August Steinberger was already a power user. He was also still, in a meaningful sense, *in* the code — reading it, reviewing plans, choosing when to parallelize, and treating Claude as the default agent with OpenAI models in supporting roles.

## October: "Just Talk To It" and the Codex Realignment

Three months later, [Just Talk To It](https://steipete.me/posts/just-talk-to-it) reads like a breakup letter to the Claude Code ecosystem — and a manifesto for conversational control over ceremonial harness features.

The headline numbers shifted:

| Dimension | August (Claude-centric) | October (Codex-centric) |
|-----------|-------------------------|-------------------------|
| Daily driver | Claude Code in Ghostty | Codex CLI |
| Parallel agents | 1–2 typical, ~4 for cleanup | 3–8 in a terminal grid |
| Branching model | `main`, worktrees rejected | `main`, agents commit atomically |
| Planning | Plan mode + GPT-5 file review | Conversation: "let's discuss," then build |
| Prompt style | Mix of small prompts and brainstorms | Often 1–2 sentences plus screenshots |
| Code reading | Implicit throughout | Agents write ~100% of code; he watches |

### Blast radius as the organizing metaphor

Steinberger borrowed **blast radius** — how many files a change touches, how hard it is to reset — as the mental model for parallelism. Many small bombs, or one large one plus satellites. If an agent ran longer than his internal estimate, he hit escape and asked for status. Mid-run interruption was not failure; agents resumed well.

This sat alongside a deliberate rejection of worktrees: one dev server, one OAuth callback domain, one place to click through overlapping changes. Speed beat isolation.

### Why Codex won

The technical case in October was concrete:

- **Read-before-write behavior.** Codex often spent ten to fifteen minutes reading silently before editing; Opus was eager, sometimes editing without reading whole files.
- **Context economics.** ~230k usable context, slower fill, less compulsive compaction than Claude Code.
- **Message queuing** vs Claude's steer-on-send behavior — queue when you want pipeline, escape when you want intervention.
- **Harness ergonomics.** Rust rewrite, less flicker in Ghostty, lower RAM, calmer tone — "the introverted engineer that chugs along."

Plan mode, in this framing, was not magic but a **crutch for models that needed edit tools taken away** so they would not thrash. Codex could be told to discuss first and wait for approval without a dedicated mode. Steinberger's widely misunderstood tweet about plan mode — referenced again in December — was really about that distinction: structure imposed by the harness vs discipline learned by the model.

### Against the plugin industrial complex

The October post coincided with Anthropic's [Claude Code plugins announcement](https://www.anthropic.com/news/claude-code-plugins) — slash commands, subagents, MCP servers, and hooks bundled for sharing. Steinberger's response was dismissive: patching model inefficiency with packaging. Subagents he replaced with **separate terminal panes** for visibility and control. Third-party harnesses (Amp, Factory, Cursor-as-primary) were thin wrappers doomed to converge with first-party CLIs. MCPs were "marketing checkboxes"; CLIs like `gh` won on zero context tax and self-documenting `--help`.

He kept one exception: `chrome-devtools-mcp` for closing the web loop, plus API keys that let agents hit endpoints with `curl`.

### Spec-driven development as the old way

June-style mega-specs, then hours of unattended building, were explicitly retired. The new loop: discuss with Codex, optionally export a spec for GPT-5 Pro review on chatgpt.com, paste back what mattered, build in the same context. For UI, he under-specified on purpose and iterated while watching the browser update — morphing chaos rather than reverting.

Twenty percent of time still went to **refactoring** — duplication (`jscpd`), dead code (`knip`), dependency upgrades, doc maintenance — all agent-driven, often on low-focus days. Fast iteration and debt paydown alternated by design.

### Simon Willison's parallel thread

Steinberger cited [Simon Willison's observation](https://simonwillison.net/2025/Oct/7/vibe-engineering/) that managing agents resembles managing engineers — a point Willison developed in ["Vibe engineering"](https://simonwillison.net/2025/Oct/7/vibe-engineering/), coined the same week to separate accountable professional use from loose "vibe coding." Willison emphasized tests, documentation, git hygiene, preview environments, and the exhausting cognitive load of parallel agents — themes Steinberger absorbed but interpreted differently: less ritualized review of every line, more trust in agent throughput plus architectural grip.

Willison's ["Embracing the parallel coding agent lifestyle"](https://simonwillison.net/2025/Oct/5/parallel-coding-agents/) had already named Steinberger's October post as required reading — research scouts, maintenance bots, carefully specified work — while still assuming the human reviews what lands. Steinberger was pushing further toward *orchestration without line-by-line ownership*.

## December: Shipping at Inference Speed

[Shipping at Inference-Speed](https://steipete.me/posts/2025/shipping-at-inference-speed) (December 2025) is the most radical installment — less a tool swap than a changed theory of what the human is for.

### Expectations crossed a threshold

In May, working code from a prompt was delightful surprise. By December it was **baseline**. Failure to one-shot was suspicious. He pushed back on the claim that you must hand-write code to feel bad architecture: after enough agent hours, you know how long tasks should take; when Codex struggles, the smell is timing and behavior, not absent muscle memory.

The bottleneck became **inference time and hard thinking** — and most software, he argued, is not hard thinking. It is data moved between forms, stored, displayed. Hence **CLI-first**: agents invoke, verify stdout, close the loop without screenshots or browser theater when possible.

### The model shift deepens: reading code vs reading the stream

GPT-5 was the "factory unlock"; GPT-5.2 compounded it. He reported **not reading most code anymore** — watching the stream, glancing at key parts, but relying on mental maps of components and system design. Language and dependency choices mattered more than line review: TypeScript for web, Go for CLIs (adopted because agents write it well and lint is fast), Swift for macOS without leaning on Xcode project files.

Codex vs Opus was reframed in industrial terms: Opus 4.0 "slop" cleaned by multi-hour Codex refactors running while he wrote the essay. Opus remained beloved for *personality* — Clawd, home automation, snark — while Codex was the factory floor.

### Oracle: a bridge tool obsoleted by progress

Steinberger built **oracle** — a CLI letting agents escalate to GPT-5 Pro with file uploads and async session retrieval — because stuck agents used to dump context into markdown for him to query manually. At peak, oracle fired multiple times per day. After GPT-5.2, that dropped to a few times per week. The tool was a successful loop-closer that also measured how fast the main model was catching up.

### VibeTunnel as a yardstick

[VibeTunnel](https://github.com/steipete/vibetunnel) — a terminal multiplexer for coding on the go — exemplified the May–December gap. A core rewrite away from TypeScript had stalled across Rust, Go, and Zig attempts. In December, a two-sentence Codex prompt produced a working Zig conversion over five hours and multiple compactions. The same person who once coded from his phone at dinner and quit for mental health reasons could now resurrect shelved work as a side quest for Clawd, his cross-machine AI assistant.

### Workflow refinements

December added texture without overturning October:

- **Queueing** as the orchestration layer — not email-driven task systems or multi-agent frameworks; he was the bottleneck.
- **No revert/checkpoint religion.** Wrong direction? Prompt again. Software as hiking around a mountain, not laser-straight ascent.
- **Long-lived sessions.** GPT-5.2 reduced need to restart per task; fuller context often sped file-heavy work — with caution because Codex lacks Claude's file-change system events.
- **Cross-project pointers.** `"look at ../vibetunnel and do the same"` scaffolded features cheaper than session archives.
- **Docs over session memory.** Per-project `docs/`, plus global `AGENTS.md` and scripts like `docs:list` — durable context engineering.
- **Skills over slash commands.** Domain registration, DNS, frontends — skills in global agent config; "commit/push" typed plain because it always works.
- **Two Macs via Jump Desktop** — Studio runs popups and long jobs; laptop for interaction; git reconciles `main` drift.
- **Ad-hoc refactor** when prompts slowed or ugly code scrolled past — dedicated refactor days dissolved into continuous hygiene.

Config details mattered at this stage: `gpt-5.2-codex` at `high` reasoning, raised `tool_output_token_limit`, tuned `model_auto_compact_token_limit`, `unified_exec` replacing tmux runners, web search and skills enabled — tuning the factory, not decorating it.

## What Actually Changed: A Synthesis

Steinberger's three posts are not a contradiction. They are three snapshots of the same philosophy compressing under better models.

### 1. From harness ceremony to conversation

August: plan files, plan mode, GPT-5 review, minimal MCP.  
October: "just talk to it" — discuss, optioneering, `build`.  
December: plan mode explicitly labeled a hack for weaker adherence; `write plan to docs/*.md and build` when needed.

The direction is consistent: **remove indirection as models comply better**. The industry's plugin packs and subagent menus move opposite when your model already waits for approval.

### 2. From reading code to reading behavior

August implied active engagement with output. October still claimed 100% agent-written code but described watching agents, screenshots, refactor days. December admits most code goes unread; expertise migrates to **architecture, dependency politics, timing intuition, and stream supervision**.

This is the sharpest break with mainstream "vibe engineering" advice. Willison's list — tests, docs, review culture — still applies in Steinberger's world, but **line review is partially replaced by probabilistic trust calibrated by experience**. When Codex returns slowly or wrong, suspicion triggers before diff inspection.

### 3. From Claude-first to Codex-first (without monoculture)

The model migration is pragmatic, not tribal. Opus remains for joy and certain automations; Codex for throughput. Benchmarks are distrusted; **post-training behavior** (read depth, pushback, knowledge cutoff) decides. GPT-5.2's August cutoff vs Opus stuck in March mattered for bleeding-edge stacks.

### 4. From parallel agents as technique to parallel agents as default

August: 1–2, sometimes 4.  
October: 3–8 grid, same folder, atomic agent commits.  
December: 3–8 projects, refactors queued while blogging, four two-hour jobs in flight.

Parallelism went from optimization to **ambient state** — matching Willison's October normalization, but with less emphasis on the human reviewing every landing.

### 5. From tooling accumulation to tooling subtraction

MCP count: down. Custom infra: up — but infra means **CLIs, skills, admin pages, and agent-readable docs**, not orchestration startups. Even oracle was a small CLI, not a platform.

The through-line from August's "less is more" to December's KISS config is intact. What changed is how little ceremony survives once the model carries more of the burden.

### 6. From guilt about slop to scheduled and triggered cleanup

"Slop-generator" ridicule became mainstream parallel agents. Technical debt did not disappear — **refactor work stayed ~20%**, but triggered by latency and visual ugliness in the stream, not calendar refactor days. Opus-era messes became Codex multi-hour un-slopping sessions.

## Tensions and Open Questions

Steinberger's arc is persuasive for a solo builder shipping many surfaces (his October stack: ~300k LOC TypeScript React, Chrome extension, CLI, Tauri, Expo). It is not a team playbook. Committing to `main`, overlapping agents, and skipped line review assume **single-writer sovereignty**.

The mental-health thread is real. He built VibeTunnel to code from his phone, then stopped because it consumed his life — yet December's throughput culture still risks addiction; Codex web is deliberately limited to idea capture on the go, not merge-from-the-bar.

Security and prompt injection barely appear in these posts; Willison's lethal trifecta looms larger for agents with email, messages, and home automation — exactly Clawd's surface area.

Whether "not reading code" remains viable as systems age without continuous refactor investment is the long bet. Steinberger bets on **agent-maintained docs, cross-project patterns, and refactor triggers**. Skeptics bet on compounding incomprehensibility.

## Conclusion

Peter Steinberger's 2025 workflow essays describe a narrowing path: fewer tools, longer sessions, shorter prompts, more queues, less plan-mode theater, and steadily less human reading of the artifacts themselves. The vibe changed from *coding with AI assistance* to **running inference pipelines you steer when they drift**.

The constant is not the model vendor or terminal emulator. It is an engineering mindset that treats agents as workers who need good repos, CLIs, blast-radius discipline, and honest feedback — while relentlessly deleting every layer that once compensated for weaker models.

In May, surprise that code worked was the thrill. By December, the thrill was **how much you could queue before lunch**. That is not a tweak. It is a different job — closer to architect and foreman than typist — and Steinberger's posts are among the clearest field notes we have for what that job looked like at the moment GPT-5.2 made oracle mostly optional and Zig refactors a background task.

---

## Sources

### Primary (Steinberger)

- [My Current AI Dev Workflow](https://steipete.me/posts/2025/optimal-ai-development-workflow) (August 2025)
- [Just Talk To It — the no-bs Way of Agentic Engineering](https://steipete.me/posts/just-talk-to-it) (October 2025)
- [Shipping at Inference-Speed](https://steipete.me/posts/2025/shipping-at-inference-speed) (December 2025)

### Cited and contextual

- [Simon Willison — Vibe engineering](https://simonwillison.net/2025/Oct/7/vibe-engineering/) (October 2025)
- [Simon Willison — Embracing the parallel coding agent lifestyle](https://simonwillison.net/2025/Oct/5/parallel-coding-agents/) (October 2025)
- [Anthropic — Customize Claude Code with plugins](https://www.anthropic.com/news/claude-code-plugins) (October 2025)
