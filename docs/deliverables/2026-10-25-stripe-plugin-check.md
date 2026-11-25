Made by: the ordering lead (Opus), 10-25, at Martin's request. For: Martin and whoever plans the Stripe work (#53, #61).

# Stripe's Claude plugin: D106's check

## Verdict

**Don't install the plugin as a whole.** Three of its skills can act in the world on their own trigger words: one sends money, one signs up for outside services and accepts their terms, and one takes over any "find a provider" request. Their triggers are words Restro's agents use every day ("I need a database", "set up auth", "pay", "find hosting"). A plugin installs for every project on the PC, so Martin's other projects would get them too.

**What to take instead:** the plain guidance text of `stripe-best-practices` (the skill and its payments, Connect and security references), copied into the repo at a pinned commit with a Restro overrides file, the way D106 took frontend-design. It matches D125 closely and runs nothing. That's an Upkeep ticket, and it waits for Martin's OK.

**For reading Stripe's docs** nothing needs installing: the `.md` pages and `llms.txt` already work (`2026-10-22-stripe-knowledge.md`, "Learning Stripe as an agent"). Stripe's MCP connector waits until Restro has its own Stripe account, and then is used only against a sandbox with a read-only agent key.

## What was checked (D106's gate)

| Check | Result |
|---|---|
| Provenance and licence | `github.com/stripe/ai`, folder `providers/claude/plugin`, MIT, © Stripe. Read at HEAD `8bbcc4b` (2026-10-25, version 0.11.29). Anthropic's directory pins `deae744`; the two differ in 22 skill files, all wording. |
| Every file it loads or runs | All 5 hook scripts and their 5 helpers, `.mcp.json`, the agent, both commands, and every `SKILL.md`. References: read in full for `stripe-best-practices` (payments, Connect, security headings); searched for commands, installs and file writes in the rest. |
| Conflict with the nine rules and CLAUDE.md | See "Conflicts" below. |
| Overlap with the repo | `stripe-best-practices` overlaps D125 and mostly agrees with it. `connect-recommend` repeats a choice D125 already made. |
| Triggers | Three skills trigger far outside Stripe work (below). |
| Cost | The hooks start Node on every prompt and every tool batch (5 s limit each, small). The session-start hook calls the npm registry. Skills load only when triggered; `connect-recommend` and the verification skill are about 25–30 KB each. |
| Trial | Not run: the verdict is reached without one. The pinned-text route gets its trial in the first Stripe ticket. |

## What the plugin contains

- **MCP server:** `https://mcp.stripe.com` (Stripe's hosted server; reads and **writes** to a Stripe account once signed in).
- **Hooks** (Node scripts, run on: session start, every prompt, after every tool batch, after a skill or subagent, after a failed Stripe tool):
  - **Session start:** runs `stripe --version`, `stripe whoami` and `npm view @stripe/cli version`, then nudges the agent to install the Stripe CLI globally and sign in.
  - **Feedback prompts:** 1% of prompts and 0.1% of tool batches that touched Stripe add a note asking the agent to send Stripe feedback. The note says to ask the user first.
  - **A failed Stripe tool call blocks the agent** with the same request to send feedback.
  - **Usage reporting:** after a Stripe skill, it runs `stripe agent report_usage` with the skill's name, and adds `STRIPE_API_KEY` if that variable is set. This does nothing while the CLI isn't installed.
  - **Transcript reads:** the prompt hook reads the local transcript backwards to the last human message, looking for the word "stripe". It sends nothing anywhere.
- **Skills:** `stripe-best-practices`, `connect-recommend`, `connect-required-verification-information`, `upgrade-stripe`, `stripe-docs`, `stripe-apps`, `metronome`, `stripe-directory`, `stripe-pay`, `stripe-projects`.
- **Commands:** `test-cards`, `explain-error` (text only).
- **Agent:** `company-researcher` (web research plus a scan of the repo's words).

## Conflicts

**Blocking (the reason not to install it whole):**
1. **`stripe-pay` sends money** to other Stripe businesses (`stripe pay`). A money transfer is never an agent's job here. Its own rules ask for confirmation, but the skill shouldn't be reachable at all.
2. **`stripe-projects` provisions outside services and runs `stripe projects init --accept-tos --yes`**, accepting terms with no person reading them. It triggers on "I need a database", "set up auth", "get credentials for X", "sign up for a service", and tells the agent not to send the user to sign up by hand. Conflicts:
   - CLAUDE.md: no dependency the ticket doesn't name;
   - no accounts or terms accepted on Martin's behalf;
   - Supabase is the database (stack).
3. **`stripe-directory` says it "MUST be used BEFORE web search" for any request to find, compare or engage a provider**, and installs the CLI with `brew` and more skills with `npx skills add`. It would take over vendor research (POS makers, lawyers, payment providers) and push Stripe's catalogue ahead of the research rule ("research how comparable software does it").

**Overridden if the guidance is copied in (the overrides file):**
- **CLI installs and sign-ins:**
  - `npm i -g @stripe/cli`, `stripe login` and `stripe sandbox create` are stop-and-ask: no global installs, and sandboxes are Martin's to create.
  - The MCP is used only with Martin's sandbox and a read-only agent key (D125 3.11, rule 7).
- **Feedback to Stripe:** never sent by an agent. A note for Stripe goes in the report to the lead.
- **Webhooks "are the source of truth":** D125 3.8 refines this. A notice is a trigger; Restro acts on the payment it reads back.
- **Onboarding:** the skill defaults to embedded onboarding components. D125 chose Stripe's hosted form; #61 may consider the `notification_banner` component.
- **Checkout Sessions vs Payment Intents:** see "For #53" below.

**Agrees with D125** (good to have in agents' hands):
- Accounts v2, never v1 `type:`;
- SaaS with direct charges: `dashboard: "full"`, Stripe collects fees and owns losses;
- check `configuration.merchant.capabilities.card_payments.status` before taking payments, never `charges_enabled`;
- restricted keys over secret keys;
- never `payment_method_types` (dynamic payment methods);
- signature-checked webhooks;
- one `StripeClient` instance, never a global key.

## For #53 (a point to settle, not a conflict yet)

The skill prefers backing the Payment Element with the **Checkout Sessions API** (`ui_mode: 'custom'`) over a raw PaymentIntent "where possible". D125 3.5 sized Restro's restricted key for **Payment Intents write**. With Checkout Sessions, the key would also need Checkout Sessions write, and manual capture goes through `payment_intent_data.capture_method`. #53 should pick one, check it against D122 §8's hold, move, capture order, and confirm in the sandbox (Open item 3 of the knowledge file) that the chosen key still can't refund.

## If Martin says yes: the Upkeep ticket

- Copy `skills/stripe-best-practices/` (`SKILL.md`, `references/payments.md`, `connect.md`, `security.md`) from `stripe/ai` at `8bbcc4b` into `.claude/skills/stripe-best-practices/`, verbatim, with the MIT notice.
- Add a `restro-overrides.md` that is read first, listing the overrides above.
- Leave out billing, tax, Treasury, Metronome, Apps, Directory, Pay and Projects.
- Optionally add `test-cards` as a command.
- Update only through an Upkeep ticket (D106).
