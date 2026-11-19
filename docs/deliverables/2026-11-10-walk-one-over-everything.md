# The one walk: how to open it (for Martin)

> Set up 2026-11-10 by the lead, rebuilt 2026-11-11 on the merged line, refreshed 2026-11-18 (twice: the commands are PowerShell now, which is what your terminal opens with), **rebuilt again 2026-11-19 on `or/foundation` at `4091b7a0`, and it is running now.** Two addresses run side by side on this PC, each on its own branch, its own database and its own simulated POS, so nothing either of them does can reach the other — or your day-to-day setup on port 3000. Issue [#387](https://github.com/MartinKostadinov04/restro/issues/387).

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
- **the guest page opens in Bulgarian.** Since 11-18 the venue's own language comes before the phone's, and a guest who switches language has that remembered for this club alone. That order was a default another lead chose while you were away, so it is worth a look rather than a glance.
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

Every block below runs in **PowerShell**, which is what the terminal here opens with. Where a block is anything else, it says so.

**The database first.** One embedded Postgres on port 54329 serves both walks and your own work. From `E:\Restro`:

```powershell
pnpm db:local
```

It brings its own Postgres — **Docker is not needed for any of this**. `docker-compose.yml` is an optional alternative on the same port; run one or the other, never both. Leave the terminal open; `pnpm db:local:stop` shuts it down cleanly from another tab.

**Then the walk**, two tabs from `E:\Restro\.claude\worktrees\walk-all`:

```powershell
pnpm sim:serve --scenario club-biad --port 4020
```

```powershell
$env:PORT = '3200'; pnpm dev
```

The app takes about 70 seconds to say `Ready`. Ctrl-C in a tab stops that piece.

## Rebuilding it from scratch

**It does not need this today.** It was rebuilt on 2026-11-19 at `4091b7a0`, which is the tip of `or/foundation` — 114 commits on from the old 9f46ef20 seeding, two new migrations among them (0055 and 0056), and the refund of an undeliverable paid line (D148) is in it. The night it holds is dated **2026-11-19**, so it is tonight's.

Run the four blocks below when the branch has moved on again and you want the walk to match it. All of them are **PowerShell**, from `E:\Restro\.claude\worktrees\walk-all`, with the branch pulled and `pnpm install` done. Stop the walk's `pnpm dev` first — it holds the database open.

**One.** Make the database. Nothing else creates it, and this throws away the old one, which is what a rebuild means. `psql` is installed but not on your path, so it needs its full name:

```powershell
& "C:/Program Files/PostgreSQL/17/bin/psql.exe" "postgres://postgres:postgres@localhost:54329/postgres" -c "DROP DATABASE IF EXISTS restro_walk_all" -c "CREATE DATABASE restro_walk_all"
```

**Two.** Load the walk's settings into this terminal:

```powershell
Get-Content .env.local | ForEach-Object { if ($_ -match '^\s*([^#=\s]+)\s*=\s*(.*)$') { Set-Item "env:$($matches[1])" $matches[2].Trim().Trim('"') } }
```

**Three.** Clear the published files, so the guest pages are rebuilt rather than reused:

```powershell
Remove-Item -Recurse -Force .local\cdn-walk -ErrorAction SilentlyContinue; New-Item -ItemType Directory .local\cdn-walk | Out-Null
```

**Four.** The three steps, in order:

```powershell
pnpm db:migrate; if ($?) { pnpm db:roles }; if ($?) { pnpm db:seed:demo }
```

Three things that will bite whoever rebuilds it:

1. **Block two is not optional.** `pnpm db:migrate` and `pnpm db:roles` read their settings from the terminal's own environment and nowhere else, so without it they both stop at "DATABASE_URL_OWNER is not set" however good your `.env.local` is. The seed is the exception — it loads the file itself — which is why the error only ever appears on the first two steps.
2. **`&&` does not work in this PowerShell.** `pnpm db:migrate && pnpm db:roles` fails outright on Windows PowerShell 5.1; that is what the `if ($?)` is for, and it also stops the chain when a step fails instead of seeding onto a half-migrated database.
3. **Quote the Cyrillic values** in `.env.local`. `WORKER_PAYMENTS_SIM_ACCOUNT_NAME` unquoted breaks the loader in block two.

The seed prints every address it made, including the guest menu and the QR sheet, and it is safe to run again — it rebuilds the club from nothing each time.

## Where the guest's phone goes

Each walk's `PUBLIC_BASE_URL` is this PC's address on your network with its own port, so a QR code from 3200 opens the 3200 app and one from 3100 opens the 3100 app. On this PC, use a narrow browser window of about 390 px on a table's address (Маси и QR › tap the code). The location check is in Настройки › Поръчки if it gets in the way.

## Known blemishes, as of 2026-11-18

Not faults in what you are walking — things to expect so they do not distract you. The English guest page that was here on 11-11 is gone: #422 put the venue's own language first, so a rebuilt walk opens in Bulgarian.

- **Every item wears a NEW badge**, because the whole menu arrived in one sync.
- **Four bottles show "1 проблем"** — the simulated POS gives them no public name, so [D75](../decisions/D75.md)'s warning fires. Correct behaviour, noisy in a demo.
