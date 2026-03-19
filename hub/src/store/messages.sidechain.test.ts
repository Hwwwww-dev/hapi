import { describe, expect, it } from 'bun:test'

import { Store } from './index'

function createStore() {
    const store = new Store(':memory:')
    const session = store.sessions.getOrCreateSession(
        'sidechain-test',
        { path: '/tmp/test', host: 'local' },
        null,
        'default'
    )
    return { store, sessionId: session.id }
}

const SIDECHAIN_DIRECT = {
    type: 'output',
    data: { type: 'assistant', isSidechain: true, content: [{ type: 'text', text: 'hi' }] }
}

const SIDECHAIN_WRAPPED = {
    role: 'agent',
    content: {
        type: 'output',
        data: { type: 'assistant', isSidechain: true, content: [] }
    }
}

const NO_SIDECHAIN_AGENT = {
    role: 'agent',
    content: { type: 'output', data: { type: 'assistant', content: [] } }
}

// Native event format: isSidechain at top level (as written by Claude Desktop JSONL)
const SIDECHAIN_NATIVE_EVENT = {
    type: 'assistant',
    isSidechain: true,
    uuid: 'native-uuid-1',
    parentUuid: 'parent-uuid-1',
    message: { role: 'assistant', content: [{ type: 'text', text: 'sidechain step' }] }
}

describe('extractIsSidechain (via addMessage)', () => {
    it('plain root message -> not sidechain', () => {
        const { store, sessionId } = createStore()
        store.messages.addMessage(sessionId, { role: 'user', content: 'hello' })

        const roots = store.messages.getRootMessages(sessionId, 10)
        expect(roots.length).toBe(1)

        const sidechains = store.messages.getSidechainMessagesInRange(sessionId, 1, 1)
        expect(sidechains.length).toBe(0)
    })

    it('direct format sidechain -> is_sidechain = 1', () => {
        const { store, sessionId } = createStore()
        store.messages.addMessage(sessionId, SIDECHAIN_DIRECT)

        const roots = store.messages.getRootMessages(sessionId, 10)
        expect(roots.length).toBe(0)

        const sidechains = store.messages.getSidechainMessagesInRange(sessionId, 1, 1)
        expect(sidechains.length).toBe(1)
    })

    it('role-wrapped sidechain -> is_sidechain = 1', () => {
        const { store, sessionId } = createStore()
        store.messages.addMessage(sessionId, SIDECHAIN_WRAPPED)

        const roots = store.messages.getRootMessages(sessionId, 10)
        expect(roots.length).toBe(0)

        const sidechains = store.messages.getSidechainMessagesInRange(sessionId, 1, 1)
        expect(sidechains.length).toBe(1)
    })

    it('agent message without isSidechain -> not sidechain', () => {
        const { store, sessionId } = createStore()
        store.messages.addMessage(sessionId, NO_SIDECHAIN_AGENT)

        const roots = store.messages.getRootMessages(sessionId, 10)
        expect(roots.length).toBe(1)

        const sidechains = store.messages.getSidechainMessagesInRange(sessionId, 1, 1)
        expect(sidechains.length).toBe(0)
    })

    it('native event format with top-level isSidechain -> is_sidechain = 1', () => {
        const { store, sessionId } = createStore()
        store.messages.addMessage(sessionId, SIDECHAIN_NATIVE_EVENT)

        const roots = store.messages.getRootMessages(sessionId, 10)
        expect(roots.length).toBe(0)

        const sidechains = store.messages.getSidechainMessagesInRange(sessionId, 1, 1)
        expect(sidechains.length).toBe(1)
    })
})

/**
 * Helper: insert 10 alternating root/sidechain messages.
 * seq 1=root, 2=sidechain, 3=root, ... 9=root, 10=sidechain
 */
function insertAlternating(store: Store['messages'], sessionId: string) {
    const msgs = []
    for (let i = 1; i <= 10; i++) {
        const content = i % 2 === 1
            ? { role: 'user', content: `root-${i}` }
            : SIDECHAIN_DIRECT
        msgs.push(store.addMessage(sessionId, content))
    }
    return msgs
}

describe('getRootMessages pagination', () => {
    it('returns only root messages', () => {
        const { store, sessionId } = createStore()
        insertAlternating(store.messages, sessionId)

        const roots = store.messages.getRootMessages(sessionId, 10)
        expect(roots.length).toBe(5)
        for (const r of roots) {
            expect((r.content as { role: string }).role).toBe('user')
        }
    })

    it('respects limit', () => {
        const { store, sessionId } = createStore()
        insertAlternating(store.messages, sessionId)

        const roots = store.messages.getRootMessages(sessionId, 3)
        expect(roots.length).toBe(3)
        // Should be the latest 3 root messages (seq 5, 7, 9)
        expect(roots.map(r => r.seq)).toEqual([5, 7, 9])
    })

    it('supports beforeSeq cursor', () => {
        const { store, sessionId } = createStore()
        const msgs = insertAlternating(store.messages, sessionId)

        // Get root messages before seq 7 (root at seq 7 excluded)
        const roots = store.messages.getRootMessages(sessionId, 3, 7)
        expect(roots.length).toBe(3)
        expect(roots.map(r => r.seq)).toEqual([1, 3, 5])
    })
})

describe('getSidechainMessagesInRange', () => {
    it('returns sidechain messages within range', () => {
        const { store, sessionId } = createStore()
        insertAlternating(store.messages, sessionId)

        // Range seq 1..6 should include sidechain at seq 2, 4, 6
        const sc = store.messages.getSidechainMessagesInRange(sessionId, 1, 6)
        expect(sc.length).toBe(3)
        expect(sc.map(m => m.seq)).toEqual([2, 4, 6])
    })

    it('excludes sidechain messages outside range', () => {
        const { store, sessionId } = createStore()
        insertAlternating(store.messages, sessionId)

        // Range seq 3..4 should include only sidechain at seq 4
        const sc = store.messages.getSidechainMessagesInRange(sessionId, 3, 4)
        expect(sc.length).toBe(1)
        expect(sc[0].seq).toBe(4)
    })

    it('returns empty when no sidechain in range', () => {
        const { store, sessionId } = createStore()
        insertAlternating(store.messages, sessionId)

        // seq 1 is root, seq 3 is root -> no sidechain between 1..1
        const sc = store.messages.getSidechainMessagesInRange(sessionId, 1, 1)
        expect(sc.length).toBe(0)
    })
})

describe('countRootMessages vs countMessages', () => {
    it('countMessages returns total, countRootMessages returns only root', () => {
        const { store, sessionId } = createStore()
        insertAlternating(store.messages, sessionId)

        expect(store.messages.countMessages(sessionId)).toBe(10)
        expect(store.messages.countRootMessages(sessionId)).toBe(5)
    })
})

describe('importNativeMessage sidechain extraction', () => {
    it('imported sidechain message is correctly flagged', () => {
        const { store, sessionId } = createStore()

        store.messages.importNativeMessage(sessionId, {
            content: SIDECHAIN_DIRECT,
            createdAt: 100,
            sourceProvider: 'claude',
            sourceSessionId: 'native-sc',
            sourceKey: 'line:1'
        })

        const roots = store.messages.getRootMessages(sessionId, 10)
        expect(roots.length).toBe(0)

        const sc = store.messages.getSidechainMessagesInRange(sessionId, 1, 1)
        expect(sc.length).toBe(1)
    })

    it('imported native event with top-level isSidechain is correctly flagged', () => {
        const { store, sessionId } = createStore()

        store.messages.importNativeMessage(sessionId, {
            content: SIDECHAIN_NATIVE_EVENT,
            createdAt: 100,
            sourceProvider: 'claude',
            sourceSessionId: 'native-event-sc',
            sourceKey: 'line:10'
        })

        const roots = store.messages.getRootMessages(sessionId, 10)
        expect(roots.length).toBe(0)

        const sc = store.messages.getSidechainMessagesInRange(sessionId, 1, 1)
        expect(sc.length).toBe(1)
    })

    it('imported non-sidechain message is root', () => {
        const { store, sessionId } = createStore()

        store.messages.importNativeMessage(sessionId, {
            content: { role: 'assistant', content: 'normal' },
            createdAt: 100,
            sourceProvider: 'claude',
            sourceSessionId: 'native-sc',
            sourceKey: 'line:2'
        })

        const roots = store.messages.getRootMessages(sessionId, 10)
        expect(roots.length).toBe(1)

        const sc = store.messages.getSidechainMessagesInRange(sessionId, 1, 1)
        expect(sc.length).toBe(0)
    })

    it('update preserves sidechain flag when content changes', () => {
        const { store, sessionId } = createStore()

        // First import: non-sidechain
        store.messages.importNativeMessage(sessionId, {
            content: { role: 'assistant', content: 'v1' },
            createdAt: 100,
            sourceProvider: 'claude',
            sourceSessionId: 'native-sc',
            sourceKey: 'line:3'
        })
        expect(store.messages.countRootMessages(sessionId)).toBe(1)

        // Second import same key: now sidechain content
        store.messages.importNativeMessage(sessionId, {
            content: SIDECHAIN_DIRECT,
            createdAt: 200,
            sourceProvider: 'claude',
            sourceSessionId: 'native-sc',
            sourceKey: 'line:3'
        })

        // Should now be sidechain
        expect(store.messages.countRootMessages(sessionId)).toBe(0)
        const sc = store.messages.getSidechainMessagesInRange(sessionId, 1, 1)
        expect(sc.length).toBe(1)
    })
})
