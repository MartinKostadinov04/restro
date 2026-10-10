// Entry point of `pnpm barsy:record`. Run by Node itself (native TypeScript support), which is
// why every relative import in this package spells out its `.ts` extension.
//
//   pnpm barsy:record -- --method Misc_ping_user
//
// The root package.json script loads .env.local with `node --env-file-if-exists`; this file reads
// nothing from disk except through the recorder.

import { pino } from 'pino'

import { FIXTURES_ROOT } from '../fixture-files.ts'
import { runRecorder } from './run.ts'

// The client's call log (method, bid, request id, duration) goes to stderr; stdout stays for results.
const logger = pino({ name: '@restro/barsy:record', level: 'info' }, pino.destination(2))

process.exitCode = await runRecorder(process.argv.slice(2), {
  env: process.env,
  fixturesRoot: FIXTURES_ROOT,
  now: () => new Date(),
  stdout: (line) => console.log(line),
  stderr: (line) => console.error(line),
  logger,
})
