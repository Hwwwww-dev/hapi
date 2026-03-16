import { describe, expect, it } from 'bun:test'

import { createSessionTitleSummary, truncateSessionTitle } from '@hapi/protocol'
import { Store } from '../store'
import { maybeApplyFirstMessageSessionTitle } from './sessionTitle'

describe('session title fallback', () => {
    it('stores the first real user message as a truncated fallback title', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('tag-1', {
            path: '/tmp/project',
            host: 'local'
        }, null, 'default')

        const updated = maybeApplyFirstMessageSessionTitle(store, session.id, {
            role: 'user',
            content: {
                type: 'text',
                text: '  这是第一条用户消息，它会被截断，而且最多只能保留前五十个字符用于标题展示，后面的都不要  '
            }
        }, 123)

        const refreshed = store.sessions.getSession(session.id)
        expect(updated).toBe(true)
        expect(refreshed?.metadata).toEqual(expect.objectContaining({
            summary: {
                text: truncateSessionTitle('这是第一条用户消息，它会被截断，而且最多只能保留前五十个字符用于标题展示，后面的都不要'),
                updatedAt: 123,
                source: 'first-message'
            }
        }))
    })

    it('does not overwrite an existing generated title with first-message fallback', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession('tag-2', {
            path: '/tmp/project',
            host: 'local',
            summary: createSessionTitleSummary('Generated Title', 200, 'generated')
        }, null, 'default')

        const updated = maybeApplyFirstMessageSessionTitle(store, session.id, {
            role: 'user',
            content: {
                type: 'text',
                text: 'hello from first message'
            }
        }, 300)

        const refreshed = store.sessions.getSession(session.id)
        expect(updated).toBe(false)
        expect(refreshed?.metadata).toEqual(expect.objectContaining({
            summary: {
                text: 'Generated Title',
                updatedAt: 200,
                source: 'generated'
            }
        }))
    })
})
