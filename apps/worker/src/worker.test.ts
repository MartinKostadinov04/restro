import { describe, expect, it } from 'vitest'

import { startWorker } from './worker'

describe('startWorker', () => {
  it('logs a startup line and a stop line', () => {
    const lines: string[] = []
    const worker = startWorker((line) => lines.push(line))
    expect(lines).toEqual(['worker started'])
    worker.stop()
    expect(lines).toEqual(['worker started', 'worker stopped'])
  })
})
