Research for the lead, Martin 11-06: what Anthropic advises on choosing models. Sources: Anthropic's pages only, read 11-06.

Page ages: the docs pages below show no date but name the current family (Fable 5.1, Opus 5.5, Sonnet 5.5, Haiku 5.5). Two older pages are marked where used: the model-and-effort article (7 July 2026, names Fable 5 and Opus 4.8) and the multi-agent post (13 June 2025, Claude 4 models).

## What Anthropic advises

- Most work should start on Opus 5.5. Fable 5.1 is for "the highest available capability" (sessions that run for hours, deep research). Sonnet 5.5 is for everyday coding and agent work, and Haiku 5.5 for the lowest latency and price, "subagent tasks" included. https://platform.claude.com/docs/en/about-claude/models/choosing-a-model
- Move to Fable 5.1 only "if your evals at `xhigh` or `max` effort still fall short" on hard reasoning or long agentic work. "Tuning effort is often a better lever than switching models." (same page)
- Claude Code's aliases: `opus` for "complex reasoning", `sonnet` for "daily coding", `haiku` for "simple tasks", `fable` for "your hardest and longest-running tasks". `opusplan` uses Opus in plan mode and then Sonnet to carry out the plan. https://code.claude.com/docs/en/model-config
- What Fable is for: hand it ambiguous problems ("root-cause investigations, architecture decisions") and describe the outcome you want, not the steps. It is never the default model and may bill to usage credits. (same page)
- Effort levels: Opus, Sonnet and Haiku 5.5 default to `medium`, which fits "day-to-day engineering with a clear scope". Use `high` where checking matters, as in bug fixes in existing code. Use `max` for "hard problems, such as finding security vulnerabilities", though it "is prone to overthinking". Subagents can set their own `effort`. (same page)
- Effort clash: in Claude Code, Sonnet 5.5 defaults to `medium`. The API's choosing page says to start Sonnet 5.5 at `high`.
- Claude Code: "the default Opus 5.5 handles most coding well and Sonnet costs less on routine work". Haiku fits subagents doing simple jobs. https://code.claude.com/docs/en/best-practices
- Review: have the work reviewed "by someone who didn't write the code". `/code-review` runs in a fresh subagent that "isn't swayed by the reasoning that produced the code". A second session is "the easiest independent reviewer". Handing a task to a subagent does not make the answer better, but a fresh reviewer helps. Ask for correctness gaps and "skip style", because a reviewer always finds *something*. (same page; https://code.claude.com/docs/en/code-review-local)
- Choosing a model for an agent: a subagent's `model` can be an alias, a full model id or `inherit`. Without it, a subagent inherits the session's model, so switching the session to Opus moves those subagents to Opus too. To pin a subagent to a smaller model, set `model` in its definition. https://code.claude.com/docs/en/sub-agents
- When to use subagents: for verbose output, tool limits, or self-contained work that comes back as a summary. Keep work in the main session when it has many steps that share context, such as planning, building and testing. (same page)
- Two ways to combine models, measured on the current family. In the first, Opus 5.5 orchestrates Sonnet 5.5 workers: this matched Opus alone at `medium` for about a third less cost. In the second, Haiku 5.5 workers on coding cut cost 32% but lost about 4 points of pass rate. Fable 5.1 as the orchestrator cost 24% more for no gain. Haiku: "use with caution on coding". https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence
- 2026-07 article: pick a larger model for "subtle bugs, unfamiliar domains, and architecture decisions". Pick a smaller one for routine, precisely specified edits, because smaller models do better with exact instructions. Raise effort first when Claude skips files or tests. https://claude.com/resources/articles/claude-model-and-effort-level-in-claude-code
- 2025 post: a lead agent with subagents (Claude 4 models) pays off for wide, parallel research. It pays off less for "most coding tasks" and for work where agents share context. Save the plan outside the conversation, and start fresh subagents when context runs long. https://www.anthropic.com/engineering/multi-agent-research-system

## What it says about cost

- Unexpectedly high spend usually comes from "long sessions that were never cleared" or from "Opus left as the default model". Use `/clear` between unrelated tasks. Sonnet "costs less than Opus"; "Reserve Opus for complex architectural decisions or multi-step reasoning". https://code.claude.com/docs/en/costs
- Long sessions: each request resends the whole conversation, cache misses re-read it in full, and `/compact` is itself a large request. "When you want a fresh start instead of continuity, `/clear` costs nothing." (same page)
- Teams of agents: use Sonnet for teammates and keep teams small. Teams cost about 7x the tokens of a normal session when teammates run in plan mode. Shut teammates down when their work is done. (same page)
- Prompt caching: turn it on first. Cache reads cost about 0.05x the input price on Opus and Sonnet 5.5, and 0.025x on Fable 5.1. Changing effort or the system prompt mid-conversation breaks the cache. https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence
- Context length: compact a Haiku 5.5 conversation before it reaches 100K tokens, because tokens above that cost 5x. Output tokens cost 5x input tokens, so ask only for the answer you will read. (same page)
- Thinking tokens are billed as output. Lower effort to cut tokens; `max` costs the most. https://code.claude.com/docs/en/model-config
- Agents use about 4x the tokens of a chat, and multi-agent systems about 15x. This is worth it only for high-value tasks (2025, Claude 4 era). https://www.anthropic.com/engineering/multi-agent-research-system
- Fable 5.1 used alone cost 2.2 to 3.0 times as much as Opus 5.5 at `high`, and scored no higher on that test. https://platform.claude.com/docs/en/about-claude/models/optimizing-for-cost-and-intelligence

## Not found

- Which model a security review should run on. Anthropic advises an effort level (`max`), not a model.
- Which model a code reviewer should run on, or whether it should differ from the author's model.
- Any cap on how many Opus agents run at once.
- How long a lead session may live in days. The advice is per task (clear between unrelated tasks), not per day.
- Any advice on Haiku or Sonnet specifically for git, merging or ticket bookkeeping.
- When to choose `opusplan` (the docs say only what it does).

## How it maps onto Restro's draft rule

- Opus audits the risky areas → agrees: a larger model for subtle bugs. Anthropic adds that a higher effort (`high`/`max`) is often the better lever.
- Sonnet audits elsewhere → agrees on cost; Anthropic is silent on audits as such, and Claude Code's default is Opus 5.5 at `medium`.
- Opus fixes risky problems, Sonnet the rest → agrees ("Reserve Opus for complex … multi-step reasoning"; Sonnet for routine).
- A different agent from the fixer reviews every risky fix, on Opus → agrees on a fresh reviewer; Anthropic is silent on the reviewer's model.
- Merging, tickets, bookkeeping on Sonnet, or Haiku with exact steps → agrees: smaller models suit exact instructions; Haiku for simple jobs, with caution on coding.
- Fable plans risky decisions the owner has no view on → agrees on what Fable is for (ambiguous problems, architecture decisions), but Anthropic says to try Opus 5.5 at `xhigh`/`max` first. Measured as an orchestrator, Fable cost more for no gain.
- At most one Opus agent at a time → Anthropic is silent on a cap; its related advice (small teams, Sonnet teammates, multi-agent costs about 15x) points the same way.
- Restart a long-running lead session fresh rather than carry it for days → agrees: clear between tasks, long sessions cost more, and a fresh session costs less than compacting. Keep the plan outside the conversation.
