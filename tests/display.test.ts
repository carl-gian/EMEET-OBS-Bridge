import { describe, it, expect } from 'vitest'
import { checkPrimaryDisplay } from '../src/core/display'

describe('primary display must be 1080p', () => {
  it('accepts 1920x1080 at 100%', () => expect(checkPrimaryDisplay({ width: 1920, height: 1080 }, 1).ok).toBe(true))
  it('accepts 1080p with 125% scaling', () => expect(checkPrimaryDisplay({ width: 1536, height: 864 }, 1.25).ok).toBe(true))
  it('rejects 4K at 200% (looks like 1080p scaled)', () => expect(checkPrimaryDisplay({ width: 1920, height: 1080 }, 2).ok).toBe(false))
  it('rejects 1440p', () => expect(checkPrimaryDisplay({ width: 2560, height: 1440 }, 1).ok).toBe(false))
  it('rejects 1366x768', () => expect(checkPrimaryDisplay({ width: 1366, height: 768 }, 1).ok).toBe(false))
})
