# The one walk: how to open it (for Martin)

> Set up 2026-11-10 by the lead, rebuilt 2026-11-11 on the merged line, refreshed 2026-11-18. Two addresses run side by side on this PC, each on its own branch, its own database and its own simulated POS, so nothing either of them does can reach the other — or your day-to-day setup on port 3000. Issue [#387](https://github.com/MartinKostadinov04/restro/issues/387).

## The two addresses

| | **The one walk** | **The menu designer** |
|---|---|---|
| Open | **http://localhost:3200** | **http://localhost:3100** |
| Branch | `or/foundation` | `st/foundation` |
| What you walk | ordering, paying **and reservations** | building and designing the menu |
| Its guide | this file | [the 2026-11-07 walk-through](2026-11-07-walkthrough-st-foundation.md) |
| Its findings | the agent pass ([#387](https://github.com/MartinKostadinov04/restro/issues/387)) | [#349](https://github.com/MartinKostadinov04/restro/issues/349) |
| Folder | `.claude/worktrees/walk-all` | `.claude/worktrees/walk-st` |
| Database | `restro_walk_all` | `restro_walk_st` |
| Worker health | 8182 | 8181 |
| Simulated POS | 4020 | 4010 |

## What is in the walk

Since 2026-11-11 the walk is **Club Biad Sofia**, not the old twelve-table Demo Bar: the real club, built by `pnpm db:seed:demo` ([#403](https://github.com/MartinKostadinov04/restro/pull/403)).

- **79 tables**, 76 of them with a QR code
- **118 places on the floor plan** across Горен салон, Бар 1 / 2, Бар 3, Сцена and Долен салон — booths 1 to 16, the merged 40/41, the split 53 А/Б, 55 А/Б, 59 А/Б
- **7 menu sections, 31 items**, on the simulated POS
- **a night already running**: 8 tables opened from phones, 3 bills, 4 rounds, two guests waiting on a waiter
- **7 bookings** across the night's states, one of them cancelled, plus a blocked date
- **6 staff to sign in as**, each with its own screens:

| Sign in as | Role |
|---|---|
| `owner@club-biad.test` | Собственик |
| `manager@club-biad.test` | Мениджър |
| `host@club-biad.test` | Хостеса |
| `waiter1@club-biad.test`, `waiter2@club-biad.test` | Сервитьор |
| `bar@club-biad.test` | Бар |

The password for all six is the local-only one in `.env.example` (`DEV_ADMIN_PASSWORD`); it exists nowhere but this PC.

## Starting and stopping

**The database first.** One embedded Postgres on port 54329 serves both walks and your own work. From `E:\Restro`:

```bash
pnpm db:local
```

It brings its own Postgres — **Docker is not needed for any of this**. `docker-compose.yml` is an optional alternative on the same port; run one or the other, never both. Leave the terminal open; `pnpm db:local:stop` shuts it down cleanly from another tab.

**Then the walk**, two tabs from `E:\Restro\.claude\worktrees\walk-all`:

```bash
pnpm sim:serve --scenario club-biad --port 4020
```

```bash
$env:PORT = '3200'; pnpm dev
```

The app takes about 70 seconds to say `Ready`. Ctrl-C in a tab stops that piece.

## Rebuilding it from scratch

Do this whenever `or/foundation` has moved since the walk was last seeded — otherwise you are accepting last week's code. From `E:\Restro\.claude\worktrees\walk-all`, with the branch pulled and `pnpm install` done:

```bash
set -a; . ./.env.local; set +a; pnpm db:migrate && pnpm db:roles && pnpm db:seed:demo
```

Three things that will bite whoever rebuilds it:

1. **Load `.env.local` first.** `pnpm db:migrate`, `pnpm db:roles` and the seed read the process environment only, so without the `set -a` line they all fail with "DATABASE_URL_OWNER is not set" however good your `.env.local` is.
2. **Quote the Cyrillic values** in `.env.local`. An unquoted `WORKER_PAYMENTS_SIM_ACCOUNT_NAME` breaks the line above with a command-not-found error.
3. **Making the database.** `pnpm db:seed:demo` does not create it. `CREATE DATABASE restro_walk_all` against `postgres://postgres:postgres@localhost:54329/postgres` first, then migrate.

The seed prints every address it made, including the guest menu and the QR sheet, and it is safe to run again — it rebuilds the club from nothing each time.

## Where the guest's phone goes

Each walk's `PUBLIC_BASE_URL` is this PC's address on your network with its own port, so a QR code from 3200 opens the 3200 app and one from 3100 opens the 3100 app. On this PC, use a narrow browser window of about 390 px on a table's address (Маси и QR › tap the code). The location check is in Настройки › Поръчки if it gets in the way.

## Known blemishes, as of 2026-11-18

Not faults in what you are walking — things to expect so they do not distract you.

- **The guest page opens in English.** The club is Bulgarian; the guest menu greets you with BOTTLES, COCKTAILS, SHOTS. Raised with Martin 11-11, no ruling yet.
- **Every item wears a NEW badge**, because the whole menu arrived in one sync.
- **Four bottles show "1 проблем"** — the simulated POS gives them no public name, so [D75](../decisions/D75.md)'s warning fires. Correct behaviour, noisy in a demo.
