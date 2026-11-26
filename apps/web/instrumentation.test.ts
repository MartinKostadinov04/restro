// The server's start-up check (#581, D178): a bad BOOKING_FRAME_ANCESTORS stops the app before it
// answers anything, naming the variable and never its value.
import { afterEach, describe, expect, it, vi } from 'vitest'

import { register } from './instrumentation'

describe('the start-up check', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('passes with the setting unset, and with good origins', () => {
    vi.stubEnv('BOOKING_FRAME_ANCESTORS', '')
    expect(() => register()).not.toThrow()
    vi.stubEnv('BOOKING_FRAME_ANCESTORS', 'https://club.example')
    expect(() => register()).not.toThrow()
  })

  it('stops the app on a bad value, naming the variable and never the value', () => {
    vi.stubEnv('BOOKING_FRAME_ANCESTORS', 'http://staging-host.example/book')
    let message = ''
    try {
      register()
    } catch (error) {
      message = (error as Error).message
    }
    expect(message).toContain('BOOKING_FRAME_ANCESTORS')
    expect(message).not.toContain('staging-host')
  })
})
