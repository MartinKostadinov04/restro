// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Markdown, parseBlocks, renderInline, splitLanguages } from './markdown'

describe('the guide reader', () => {
  it('reads headings, paragraphs, lists, notes and code blocks', () => {
    const blocks = parseBlocks(
      [
        '# Title',
        '',
        'One line',
        'and another.',
        '',
        '1. First',
        '   continued',
        '2. Second',
        '',
        '- a',
        '- b',
        '',
        '> Note',
        '> more',
        '',
        '```',
        'code  line',
        '```',
        '### Small',
      ].join('\n'),
    )
    expect(blocks).toEqual([
      { type: 'heading', level: 1, text: 'Title' },
      { type: 'paragraph', text: 'One line and another.' },
      { type: 'list', ordered: true, items: ['First continued', 'Second'] },
      { type: 'list', ordered: false, items: ['a', 'b'] },
      { type: 'note', text: 'Note more' },
      { type: 'code', text: 'code  line' },
      { type: 'heading', level: 3, text: 'Small' },
    ])
  })

  it('draws bold and code inside text and never turns text into markup', () => {
    render(
      <Markdown
        source={'Use **this** and `{token}` <script>alert(1)</script> [x](http://x.test)'}
      />,
    )
    const body = screen.getByTestId('guide-body')
    expect(body.querySelector('strong')?.textContent).toBe('this')
    expect(body.querySelector('code')?.textContent).toBe('{token}')
    expect(body.querySelector('script')).toBeNull()
    expect(body.querySelector('a')).toBeNull()
    expect(body.textContent).toContain('<script>alert(1)</script>')
    expect(renderInline('plain')).toEqual(['plain'])
  })

  it('splits a file into its languages', () => {
    expect(splitLanguages('x\n<!-- lang:bg -->\nA\n<!-- lang:en -->\nB\n')).toEqual({
      bg: 'A',
      en: 'B',
    })
    expect(splitLanguages('no markers')).toEqual({})
  })
})
