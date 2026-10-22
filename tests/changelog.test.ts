import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { CHANGELOG, compareVersions, entriesSince, launchInfo } from '../src/shared/changelog'

describe('changelog', () => {
  it('has an entry for the version in package.json (add one before every release)', () => {
    const v = JSON.parse(readFileSync('package.json', 'utf8')).version
    expect(CHANGELOG.some((e) => e.version === v)).toBe(true)
  })
  it('is sorted newest first', () => {
    for (let i = 1; i < CHANGELOG.length; i++) expect(compareVersions(CHANGELOG[i - 1].version, CHANGELOG[i].version)).toBeGreaterThan(0)
  })
  it('compares versions numerically', () => {
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0)
    expect(compareVersions('1.0.0', '1.0.0')).toBe(0)
  })
  it('lists only entries after the old version, up to the current one', () => {
    expect(entriesSince('1.0.0', '1.0.0')).toEqual([])
    expect(entriesSince('0.9.0', '1.0.0').map((e) => e.version)).toEqual(['1.0.0'])
  })
  it('first run, updated, and normal launches', () => {
    expect(launchInfo(null, '1.0.0').kind).toBe('first-run')
    expect(launchInfo('0.2.1', '1.0.0').kind).toBe('updated')
    expect(launchInfo('1.0.0', '1.0.0').kind).toBe('normal')
    expect(launchInfo('1.0.0', '0.2.1').kind).toBe('normal') // downgrade: stay quiet
    expect(launchInfo('1.0.0', '1.0.1').kind).toBe('updated')
    expect(launchInfo('1.0.1', '9.9.9').kind).toBe('normal') // a version with no notes stays quiet
  })
})
