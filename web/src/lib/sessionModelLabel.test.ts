import { describe, expect, it } from 'vitest'
import { getSessionModelLabel } from './sessionModelLabel'

describe('getSessionModelLabel', () => {
    it('prefers the explicit session model', () => {
        expect(getSessionModelLabel({ model: 'gpt-5.4', modelMode: 'default' })).toEqual({
            key: 'session.item.model',
            value: 'gpt-5.4'
        })
    })

    it('falls back to Claude model mode when no explicit model exists', () => {
        expect(getSessionModelLabel({ modelMode: 'opus' })).toEqual({
            key: 'session.item.modelMode',
            value: 'Opus'
        })
    })

    it('returns null when neither model nor mode is available', () => {
        expect(getSessionModelLabel({})).toBeNull()
    })
})
