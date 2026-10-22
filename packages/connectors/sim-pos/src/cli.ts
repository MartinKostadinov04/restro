// The simulator's command line (#71): `pnpm sim:serve` starts the standalone server, and
// `pnpm sim-pos waiter <op> --name value …` acts as a waiter on a running one through its control
// calls (the engine's state lives in the server process). The control token comes from
// SIM_POS_CONTROL_TOKEN, the same variable the server reads. Developer tooling: it prints plain
// text, never data of a venue.
//
//   pnpm sim:serve [--scenario quiet-night] [--port 4010] [--host 127.0.0.1]
//   pnpm sim-pos waiter add-round --table 7 --items 2001:2,2502
//   pnpm sim-pos waiter close-bill --table 7 --kind card
//   pnpm sim-pos scenario busy-friday          load a scenario on the running server
//   pnpm sim-pos scenarios                     list the scenario files
//   pnpm sim-pos ops                           list the waiter operations

import { parseFlags } from './control/flags'
import { WAITER_OPS } from './control/ops'
import { createSimServer, DEFAULT_PORT, TOKEN_HEADER } from './control/server'
import { DEFAULT_SCENARIO_NAME, listScenarioNames } from './scenario-file'

const USAGE = `usage:
  sim-pos serve [--scenario <name>] [--port <n>] [--host <host>]
  sim-pos waiter <operation> [--<argument> <value> …]
  sim-pos scenario <name>       load a scenario on the running server
  sim-pos scenarios             list the scenario files
  sim-pos ops                   list the waiter operations

environment: SIM_POS_URL (default http://127.0.0.1:${DEFAULT_PORT}), SIM_POS_CONTROL_TOKEN`

function baseUrl(): string {
  return (process.env.SIM_POS_URL ?? `http://127.0.0.1:${DEFAULT_PORT}`).replace(/\/$/, '')
}

async function control(path: string, body: unknown): Promise<unknown> {
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const token = process.env.SIM_POS_CONTROL_TOKEN
  if (token) headers[TOKEN_HEADER] = token
  let response: Response
  try {
    response = await fetch(`${baseUrl()}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error(`no simulator at ${baseUrl()}: start it with pnpm sim:serve`)
  }
  const data = (await response.json().catch(() => ({}))) as { error?: string }
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`)
  return data
}

async function main(argv: readonly string[]): Promise<void> {
  const [command, ...rest] = argv
  switch (command) {
    case 'serve': {
      const flags = parseFlags(rest)
      const port = Number(flags.port ?? process.env.SIM_POS_PORT ?? DEFAULT_PORT)
      const hostname = flags.host ?? process.env.SIM_POS_HOST ?? '127.0.0.1'
      const sim = createSimServer({
        scenario: flags.scenario ?? process.env.SIM_POS_SCENARIO ?? DEFAULT_SCENARIO_NAME,
        token: process.env.SIM_POS_CONTROL_TOKEN ?? null,
      })
      const bound = await sim.listen(port, hostname)
      console.info(
        `sim-pos serving scenario "${sim.host.scenario.name}" at http://${hostname}:${bound}  ` +
          `(wire: /api/, control page: /control${process.env.SIM_POS_CONTROL_TOKEN ? ', token required' : ''})`,
      )
      return
    }
    case 'waiter': {
      const [op, ...flagArgs] = rest
      if (op === undefined)
        throw new Error(`name an operation (${WAITER_OPS.map((o) => o.name).join(', ')})`)
      const result = (await control(`/control/api/waiter/${op}`, parseFlags(flagArgs))) as {
        result: unknown
      }
      console.info(JSON.stringify(result.result))
      return
    }
    case 'scenario': {
      const [name] = rest
      if (name === undefined) throw new Error('name a scenario')
      await control('/control/api/scenario', { name })
      console.info(`loaded ${name}`)
      return
    }
    case 'scenarios':
      console.info(listScenarioNames().join('\n'))
      return
    case 'ops':
      for (const op of WAITER_OPS) {
        const params = op.params
          .map((p) => (p.required ? `--${p.name}` : `[--${p.name}]`))
          .join(' ')
        console.info(`${op.name} ${params}\n    ${op.summary}`)
      }
      return
    default:
      console.info(USAGE)
      if (command !== undefined && command !== 'help') process.exitCode = 2
  }
}

main(process.argv.slice(2)).catch((error: unknown) => {
  console.error(`sim-pos: ${error instanceof Error ? error.message : String(error)}`)
  process.exitCode = 1
})
