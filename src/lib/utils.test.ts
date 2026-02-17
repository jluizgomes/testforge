/**
 * Unit tests for utility functions.
 * Total: 3 tests
 */

import { describe, it, expect } from 'vitest'
import { formatDate, formatDuration, truncate } from './utils'

describe('formatDate', () => {
  it('formats an ISO date string to a locale date', () => {
    // Use a fixed UTC date string
    const result = formatDate('2026-02-17T10:00:00.000Z')
    // Should contain the year at minimum
    expect(result).toMatch(/2026/)
    // Should be a non-empty string
    expect(result.length).toBeGreaterThan(0)
  })
})

describe('formatDuration', () => {
  it('returns ms for durations under 1000ms', () => {
    expect(formatDuration(0)).toBe('0ms')
    expect(formatDuration(500)).toBe('500ms')
    expect(formatDuration(999)).toBe('999ms')
  })

  it('returns seconds for durations between 1000ms and 60000ms', () => {
    expect(formatDuration(1000)).toBe('1.0s')
    expect(formatDuration(1500)).toBe('1.5s')
    expect(formatDuration(59999)).toBe('60.0s')
  })

  it('returns minutes and seconds for durations >= 60000ms', () => {
    expect(formatDuration(60000)).toBe('1m 0s')
    expect(formatDuration(65000)).toBe('1m 5s')
    expect(formatDuration(125000)).toBe('2m 5s')
  })
})

describe('truncate', () => {
  it('returns the original string when shorter than limit', () => {
    expect(truncate('hello', 10)).toBe('hello')
    expect(truncate('hello', 5)).toBe('hello')
  })

  it('appends ellipsis when string exceeds the limit', () => {
    expect(truncate('hello world', 5)).toBe('hello...')
    expect(truncate('abcdefghij', 3)).toBe('abc...')
  })
})
