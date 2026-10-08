import { describe, expect, it } from 'vitest'

import { formatFileSize } from './media'

const en = 'en-US'

describe('formatFileSize', () => {
  it('shows exact bytes below 1 KiB, including zero', () => {
    expect(formatFileSize(0, en)).toBe('0 byte')
    expect(formatFileSize(1023, en)).toBe('1,023 byte')
  })

  it('rounds KiB and MiB to one decimal', () => {
    expect(formatFileSize(1536, en)).toBe('1.5 kB')
    expect(formatFileSize(182044, en)).toBe('177.8 kB')
    expect(formatFileSize(5 * 1024 * 1024, en)).toBe('5 MB')
  })
})
