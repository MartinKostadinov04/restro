// The `<iframe>` a web designer pastes into the club's site (#581, D178): its attributes are quoted,
// so a `&` or `"` in the address or the title cannot end one early.
import { describe, expect, it } from 'vitest'

import { embedSnippet } from './reservations-embed'

describe('the embed snippet', () => {
  it('frames the address with a title, full width, without a border', () => {
    expect(embedSnippet('https://restro.example/book/night-group/club-night', 'Book a table')).toBe(
      '<iframe src="https://restro.example/book/night-group/club-night" title="Book a table" ' +
        'width="100%" height="800" style="border:0" loading="lazy"></iframe>',
    )
  })

  it('escapes & and " in the address and the title', () => {
    expect(embedSnippet('https://restro.example/book/a?x=1&lang="en"', 'Tom & "Jerry"')).toBe(
      '<iframe src="https://restro.example/book/a?x=1&amp;lang=&quot;en&quot;" ' +
        'title="Tom &amp; &quot;Jerry&quot;" width="100%" height="800" style="border:0" ' +
        'loading="lazy"></iframe>',
    )
  })
})
