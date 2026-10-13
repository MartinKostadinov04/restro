import { describe, expect, it } from 'vitest'

import { parseBarsyHost } from './host'

describe('parseBarsyHost', () => {
  it.each([
    ['https://demo.barsyonline.com', 'demo.barsyonline.com'],
    ['https://demo.barsyonline.com/', 'demo.barsyonline.com'],
    ['  HTTPS://Club.BarsyOnline.com  ', 'club.barsyonline.com'],
    ['club.barsyonline.com', 'club.barsyonline.com'],
    ['a-b.c-d.example.bg', 'a-b.c-d.example.bg'],
  ])('reduces %j to the bare host %j', (input, host) => {
    expect(parseBarsyHost(input)).toEqual({ ok: true, host })
  })

  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['http://demo.barsyonline.com', 'not_https'],
    ['ftp://demo.barsyonline.com', 'not_https'],
    ['https://demo.barsyonline.com:8443', 'not_a_bare_host'],
    ['https://user:secret@demo.barsyonline.com', 'not_a_bare_host'],
    ['https://demo.barsyonline.com/endpoints/res', 'not_a_bare_host'],
    ['https://demo.barsyonline.com/?bid=1', 'not_a_bare_host'],
    ['https://demo.barsyonline.com?', 'not_a_bare_host'],
    ['https://demo.barsyonline.com/#x', 'not_a_bare_host'],
    ['demo.barsyonline.com/path', 'not_a_bare_host'],
    ['demo barsyonline com', 'not_a_bare_host'],
    ['https://demo.barsyonline.com\\evil.test', 'not_a_bare_host'],
    ['localhost', 'not_a_host_name'],
    ['not a url at all', 'not_a_bare_host'],
    ['https://-bad-.example.com', 'not_a_host_name'],
    ['https://', 'not_a_host_name'],
  ])('refuses %j (%s)', (input, problem) => {
    expect(parseBarsyHost(input)).toEqual({ ok: false, problem })
  })

  it('never lets a host carry anything the seal context would refuse', () => {
    // The sealed envelope binds the host; the seal context accepts [a-z0-9.-] only.
    const parsed = parseBarsyHost('https://Demo.Barsyonline.com')
    expect(parsed.ok && /^[a-z0-9.-]+$/.test(parsed.host)).toBe(true)
  })
})
