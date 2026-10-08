# Brief S1-04: barsy read client skeleton, fixture recorder, MSW harness

- **Model:** Sonnet 5.5
- **Branch:** your worktree branch, based on `s1/ground` after the scaffold (S1-01) is merged
- **Read first:** `CLAUDE.md` (rules 3, 7, 8, 9 and "barsy calls"); `docs/architecture/data-architecture.md` → "Collection path C" (onboarding steps, full pull) and "Corrections from the official docs"; `docs/tracker.md` → Research facts → "barsy API — verified against the official docs"

## Goal
A small, typed, **read-only** barsy client that later sync jobs build on, plus a CLI that records real barsy responses as test fixtures and an MSW harness that replays them in tests. Only the two ping methods are implemented now; the transport, error handling, lossless number parsing and recording must already be production-grade.

## Facts verified by the lead in the official docs (2026-10-08) — do not go beyond them
- **Single call:** `POST https://<host>/endpoints/json/<Method>?bid=<venueId>` with HTTP Basic auth, header `Content-Type: application/json`, body = a JSON object of the method's parameters (`[]` or `{}` when there are none). `bid` is optional; without it barsy uses the user's default venue. Source: https://docs.lukanet.com/barsy.api/usage/raw.html and every method page's "CURL + JSON" tab.
- **Multi-method call:** `POST https://<host>/endpoints/json/?bid=<venueId>` with body `{ "<Method>": { …params }, "<Method2>": { … } }`; the response is an object keyed by method name. Source: usage/raw.html.
- **Parameter style seen in examples:** flags and numbers are often sent as strings (`"extra_properties": {"common": "1", "categories": "1"}`, `"length": "1000"`); `extra_properties` is an **object of flags**, not an array. Source: https://docs.lukanet.com/barsy.api/methods/articles/getlist.html.
- **`Misc_ping`** — anonymous heartbeat, no authorisation needed; returns `1`. Source: https://docs.lukanet.com/barsy.api/methods/misc/ping.html
- **`Misc_ping_user`** — checks the API is reachable and the user's credentials are valid; returns `1`; invalid credentials return "a standard authorisation error" (shape not documented — record it, don't guess). Source: https://docs.lukanet.com/barsy.api/methods/misc/ping_user.html
- **Time limit:** every call is limited to 30 seconds server-side. Source: integrations/20-articles.html.
- **Request id:** every response carries the header `BARSY_REQUEST_ID` (e.g. `1:108914`); Lukanet support needs it. Log it on every call. Source: https://docs.lukanet.com/barsy.api/helpme/index.html
- **Numbers:** prices come as JSON numbers with decimals (`"actual_price": 2.40`); they must never pass through a JS float.
- **Demo installation:** `demo.barsyonline.com`, user `demo`, password from Martin (`.env.local`, never committed).

## Done when
- [ ] `packages/barsy` exposes `createBarsyClient(config)` with `call(method, params?, { bid? })`, `callMany(calls, { bid? })`, and typed wrappers `ping()` and `pingUser()`
- [ ] Lossless JSON parsing: implement `parseBarsyJson(text)` using the `JSON.parse` reviver **source-text access** (Node 24: the reviver's third argument `{ source }`): integers within the safe range → `number`; any number with a fraction or exponent, or outside the safe range → a branded `DecimalString` (the exact source text). Unit + fast-check property tests prove `2.40`, `0.1`, `1e2`, `12345678901234567890` survive as exact text
- [ ] Errors are typed: `BarsyHttpError` (status, requestId), `BarsyTimeoutError` (30 s, via `AbortSignal.timeout`), `BarsyAuthError` (401/403 or the auth error payload, once recorded), `BarsyResponseError` (Zod validation failure). Every error and every success log line (pino) carries `method`, `bid`, `requestId`, `durationMs` — never the password or the Authorization header
- [ ] Host guard (rule 9): `assertHostAllowed(host, env)` — `env` is `development | test | staging | production`; outside `production` the host must be in `BARSY_ALLOWED_HOSTS` (comma-separated) or be `demo.barsyonline.com`; production requires an explicit allowlist too. Tests cover it
- [ ] `packages/barsy/src/write/index.ts` still exports nothing; add a test that fails if it ever exports anything (rule 7 guard)
- [ ] Recorder CLI `pnpm barsy:record -- --method Misc_ping_user [--bid 1] [--params '{…}'] [--name <fixture-name>]`: reads `BARSY_HOST`, `BARSY_USER`, `BARSY_PASSWORD`, `BARSY_ENV` from `.env.local` (load with Node's `--env-file-if-exists` or `process.loadEnvFile`, no dotenv dependency), refuses methods not on a **read allowlist** constant (for now `Misc_ping`, `Misc_ping_user`; later the read methods of Collection path C), saves `packages/barsy/fixtures/<host-label>/<name>.json` as `{ method, params, bid, recordedAt, status, requestId, body /* raw text */ }`. The host label is `demo` for the demo host and `pilot-<n>` otherwise. Never write credentials or headers other than `BARSY_REQUEST_ID`
- [ ] MSW harness (`msw` v2, node): `createBarsyMockServer(fixtures)` serving recorded bodies by method name for both single and multi-method calls; tests run the client against it. Until real recordings exist, hand-write fixtures `fixtures/handmade/ping-ok.json` (body `1`) and `ping-user-unauthorised.json` (status 401, body empty) clearly marked handmade
- [ ] `.env.example` gains `BARSY_HOST`, `BARSY_USER`, `BARSY_PASSWORD`, `BARSY_ENV`, `BARSY_ALLOWED_HOSTS` with comments
- [ ] `pnpm lint && pnpm typecheck && pnpm deps:check && pnpm test && pnpm build` pass

## Allowed dependencies
`zod`, `pino`, `msw` (dev), `fast-check` (dev, already in repo). Native `fetch`. Nothing else without asking.

## Out of scope / never do
- No other barsy methods, no sync jobs, no database, no worker changes.
- Never call any barsy write method; never add anything to `write/`.
- Never commit `.env.local` or real recordings that contain personal data (ping responses contain none; future recordings will be reviewed by the lead).
- Do not edit CLAUDE.md, the tracker or architecture docs. Nothing from CLAUDE.md "Never". Commit on your branch only (end commit messages with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`).

## Stop and ask if
- `JSON.parse` source-text access is unavailable on Node 24.21 (then propose `lossless-json`)
- you believe a fact above is wrong — do not "fix" it by guessing; report it

## Report back
CLAUDE.md report format, plus the exact command Martin or the lead runs to record the first real fixture once the demo password exists.
