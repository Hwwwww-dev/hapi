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
        )!

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
        )!

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

    it('updates an existing native message when the parser recovers a better timestamp', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession(
            'native-import-update-created-at-session',
            { path: '/tmp/project', host: 'local' },
            null,
            'default'
        )!

        const first = store.messages.importNativeMessage(session.id, {
            content: { role: 'assistant', content: 'hello' },
            createdAt: 100,
            sourceProvider: 'codex',
            sourceSessionId: 'native-3',
            sourceKey: 'line:9'
        })
        const second = store.messages.importNativeMessage(session.id, {
            content: { role: 'assistant', content: 'hello' },
            createdAt: 200,
            sourceProvider: 'codex',
            sourceSessionId: 'native-3',
            sourceKey: 'line:9'
        })

        const [message] = store.messages.getMessages(session.id)

        expect(first.inserted).toBe(true)
        expect(first.updated).toBe(false)
        expect(second.inserted).toBe(false)
        expect(second.updated).toBe(true)
        expect(second.message.id).toBe(first.message.id)
        expect(second.message.seq).toBe(first.message.seq)
        expect(message?.createdAt).toBe(200)
    })

    it('updates an existing native message when normalized content changes', () => {
        const store = new Store(':memory:')
        const session = store.sessions.getOrCreateSession(
            'native-import-update-content-session',
            { path: '/tmp/project', host: 'local' },
            null,
            'default'
        )!

        const first = store.messages.importNativeMessage(session.id, {
            content: { role: 'assistant', content: 'stale' },
            createdAt: 100,
            sourceProvider: 'claude',
            sourceSessionId: 'native-4',
            sourceKey: 'line:12'
        })
        const second = store.messages.importNativeMessage(session.id, {
            content: { role: 'assistant', content: 'fresh' },
            createdAt: 100,
            sourceProvider: 'claude',
            sourceSessionId: 'native-4',
            sourceKey: 'line:12'
        })

        const [message] = store.messages.getMessages(session.id)

        expect(second.inserted).toBe(false)
        expect(second.updated).toBe(true)
        expect(second.message.id).toBe(first.message.id)
        expect(second.message.seq).toBe(first.message.seq)
        expect(message?.content).toEqual({ role: 'assistant', content: 'fresh' })
    })
})
