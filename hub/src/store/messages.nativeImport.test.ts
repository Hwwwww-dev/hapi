import { describe, expect, it } from 'bun:test'

import { Store } from './index'

describe('MessageStore native import', () => {
    it('deduplicates repeated native messages by source identity', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession(
            'native-import-session',
            { path: '/tmp/project', host: 'local' },
            null,
            'default'
        )

        const first = store.messages.importNativeMessage(session.id, {
            content: { role: 'assistant', content: 'hello' },
            createdAt: 1,
            sourceProvider: 'claude',
            sourceSessionId: 'native-1',
            sourceKey: 'line:1'
        })
        const second = store.messages.importNativeMessage(session.id, {
            content: { role: 'assistant', content: 'hello' },
            createdAt: 1,
            sourceProvider: 'claude',
            sourceSessionId: 'native-1',
            sourceKey: 'line:1'
        })

        expect(first.inserted).toBe(true)
        expect(second.inserted).toBe(false)
        expect(first.message.id).toBe(second.message.id)
        expect(store.messages.getMessages(session.id).length).toBe(1)
    })

    it('preserves import order for distinct native source keys', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession(
            'native-import-order-session',
            { path: '/tmp/project', host: 'local' },
            null,
            'default'
        )

        const first = store.messages.importNativeMessage(session.id, {
            content: { role: 'assistant', content: 'first' },
            createdAt: 10,
            sourceProvider: 'codex',
            sourceSessionId: 'native-2',
            sourceKey: 'line:1'
        })
        const second = store.messages.importNativeMessage(session.id, {
            content: { role: 'assistant', content: 'second' },
            createdAt: 20,
            sourceProvider: 'codex',
            sourceSessionId: 'native-2',
            sourceKey: 'line:2'
        })

        const messages = store.messages.getMessages(session.id)

        expect(messages.map((message) => message.id)).toEqual([
            first.message.id,
            second.message.id
        ])
        expect(messages.map((message) => message.seq)).toEqual([1, 2])
        expect(messages.map((message) => message.createdAt)).toEqual([10, 20])
    })
})
