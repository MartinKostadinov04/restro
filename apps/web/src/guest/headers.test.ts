// The guest pages' Content-Security-Policy (#114, D127; design §11): the card form's script, frame
// and API hosts and what the page already used, and nothing more.

import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { cardFormHosts, guestContentSecurityPolicy, guestHeaders } from './headers'

const policy = (env: Record<string, string | undefined> = {}, development = false) =>
  guestContentSecurityPolicy(env, development)
const directive = (text: string, name: string) =>
  text
    .split('; ')
    .find((part) => part.startsWith(`${name} `))
    ?.slice(name.length + 1)
    .split(' ')

describe('the Content-Security-Policy of the guest pages', () => {
  it("allows the card form's script, frames and API, Turnstile and this site, and sets only those three directives", () => {
    const text = policy()
    expect(text.split('; ').map((part) => part.split(' ')[0])).toEqual([
      'script-src',
      'frame-src',
      'connect-src',
    ])
    expect(directive(text, 'script-src')).toEqual([
      "'self'",
      "'unsafe-inline'",
      'https://challenges.cloudflare.com',
      'https://js.stripe.com',
      'https://*.js.stripe.com',
    ])
    expect(directive(text, 'frame-src')).toEqual([
      'https://challenges.cloudflare.com',
      'https://js.stripe.com',
      'https://*.js.stripe.com',
      'https://hooks.stripe.com',
    ])
    expect(directive(text, 'connect-src')).toEqual(["'self'", 'https://api.stripe.com'])
  })

  it('adds the CDN of the published files when it is an absolute address, and nothing for /cdn', () => {
    expect(
      directive(
        policy({ NEXT_PUBLIC_CDN_BASE_URL: 'https://cdn.example.com/menus' }),
        'connect-src',
      ),
    ).toContain('https://cdn.example.com')
    expect(directive(policy({ NEXT_PUBLIC_CDN_BASE_URL: '/cdn' }), 'connect-src')).toEqual([
      "'self'",
      'https://api.stripe.com',
    ])
    expect(
      directive(policy({ NEXT_PUBLIC_CDN_BASE_URL: 'not a url' }), 'connect-src'),
    ).not.toContain('not a url')
  })

  it('allows eval and web sockets for the dev server only', () => {
    const dev = policy({}, true)
    expect(directive(dev, 'script-src')).toContain("'unsafe-eval'")
    expect(directive(dev, 'connect-src')).toContain('ws:')
    const live = policy({}, false)
    expect(live).not.toContain('unsafe-eval')
    expect(live).not.toContain('ws:')
    // The only wildcard is the card form's own subdomain host.
    expect(live.replaceAll('https://*.js.stripe.com', '')).not.toContain('*')
  })

  it("goes with the no-referrer policy on both of the guest's paths", () => {
    for (const rule of guestHeaders({})) {
      expect(rule.headers.map((header) => header.key)).toEqual([
        'Referrer-Policy',
        'Content-Security-Policy',
      ])
    }
  })
})

describe("the card forms' hosts", () => {
  it("reads each connector folder's card-form-hosts.json and keeps only https hosts", () => {
    const dir = mkdtempSync(join(tmpdir(), 'hosts-'))
    mkdirSync(join(dir, 'one'))
    mkdirSync(join(dir, 'two'))
    mkdirSync(join(dir, 'none'))
    writeFileSync(
      join(dir, 'one', 'card-form-hosts.json'),
      JSON.stringify({
        script: [
          'https://js.example.com',
          'http://insecure.example.com',
          "'unsafe-inline'",
          'https://a b',
        ],
        frame: ['https://*.example.com'],
        connect: 7,
      }),
    )
    writeFileSync(join(dir, 'two', 'card-form-hosts.json'), 'not json')
    expect(cardFormHosts(dir)).toEqual({
      script: ['https://js.example.com'],
      frame: ['https://*.example.com'],
      connect: [],
    })
  })
})
