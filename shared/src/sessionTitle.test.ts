import { describe, expect, it } from 'vitest'

import {
    SESSION_TITLE_MAX_CHARS,
    createSessionTitleSummary,
    extractSessionTitleFromMessageContent,
    getExplicitSessionTitle,
    getSessionDisplayTitle,
    getSessionListFallbackTitle,
    getSessionPathFallbackTitle,
    truncateSessionTitle
} from './sessionTitle'

describe('sessionTitle helpers', () => {
    it('prefers metadata.name over summary text', () => {
        expect(getExplicitSessionTitle({
            name: 'Manual Title',
            summary: { text: 'Generated Title' }
        })).toBe('Manual Title')
    })

    it('truncates titles to at most 50 characters', () => {
        const title = truncateSessionTitle('1234567890'.repeat(6))
        expect(Array.from(title)).toHaveLength(SESSION_TITLE_MAX_CHARS)
    })

    it('extracts a fallback title from the first user text message', () => {
        expect(extractSessionTitleFromMessageContent({
            role: 'user',
            content: {
                type: 'text',
                text: '   hello   world   '
            }
        })).toBe('hello world')
    })

    it('builds list fallback from native provider and short session id', () => {
        expect(getSessionListFallbackTitle('session-1', {
            nativeProvider: 'codex',
            nativeSessionId: '1234567890abcdef'
        })).toBe('codex 12345678')
    })

    it('uses path basename for path fallback and does not crash on bad session ids', () => {
        expect(getSessionPathFallbackTitle('session-1', { path: '/tmp/project-title' })).toBe('project-title')
        expect(getSessionDisplayTitle({
            id: { bad: true },
            metadata: null
        })).toBe('unknown')
    })

    it('creates structured title summary payloads', () => {
        expect(createSessionTitleSummary('hello', 123, 'generated')).toEqual({
            text: 'hello',
            updatedAt: 123,
            source: 'generated'
        })
    })
})
