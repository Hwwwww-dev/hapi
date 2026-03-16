import { describe, expect, it } from 'vitest'
import { resolveClaudePersistedModel, resolveClaudeSessionModelMode } from './modelMode'

describe('resolveClaudeSessionModelMode', () => {
    it('returns default when model is missing', () => {
        expect(resolveClaudeSessionModelMode()).toBe('default')
    })

    it('returns default for auto and unsupported models', () => {
        expect(resolveClaudeSessionModelMode('auto')).toBe('default')
        expect(resolveClaudeSessionModelMode('claude-sonnet-4-5')).toBe('default')
    })

    it('returns standard Claude session model modes', () => {
        expect(resolveClaudeSessionModelMode('sonnet')).toBe('sonnet')
        expect(resolveClaudeSessionModelMode('opus')).toBe('opus')
    })

    it('returns 1m Claude session model modes', () => {
        expect(resolveClaudeSessionModelMode('sonnet[1m]')).toBe('sonnet[1m]')
        expect(resolveClaudeSessionModelMode('opus[1m]')).toBe('opus[1m]')
    })
})

describe('resolveClaudePersistedModel', () => {
    it('skips missing, auto, default, and representable mode names', () => {
        expect(resolveClaudePersistedModel()).toBeUndefined()
        expect(resolveClaudePersistedModel('')).toBeUndefined()
        expect(resolveClaudePersistedModel('auto')).toBeUndefined()
        expect(resolveClaudePersistedModel('default')).toBeUndefined()
        expect(resolveClaudePersistedModel('sonnet')).toBeUndefined()
        expect(resolveClaudePersistedModel('opus[1m]')).toBeUndefined()
    })

    it('persists unsupported custom Claude model strings', () => {
        expect(resolveClaudePersistedModel('claude-3-7-sonnet-latest')).toBe('claude-3-7-sonnet-latest')
        expect(resolveClaudePersistedModel('  claude-opus-4-1-20250805  ')).toBe('claude-opus-4-1-20250805')
    })
})
