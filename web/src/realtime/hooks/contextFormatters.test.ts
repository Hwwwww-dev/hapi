import { describe, expect, it } from 'vitest'
import type { CanonicalRootBlock, Session } from '@/types/api'
import { formatNewMessages, formatSessionFull } from './contextFormatters'

function createRoot(
    id: string,
    kind: CanonicalRootBlock['kind'],
    createdAt: number,
    payload: Record<string, unknown>,
    children: CanonicalRootBlock['children'] = []
): CanonicalRootBlock {
    return {
        id,
        sessionId: 'session-1',
        timelineSeq: createdAt,
        siblingSeq: 0,
        parentBlockId: null,
        rootBlockId: id,
        depth: 0,
        kind,
        createdAt,
        updatedAt: createdAt,
        state: 'completed',
        payload,
        sourceRawEventIds: [`raw-${id}`],
        parserVersion: 1,
        generation: 1,
        children
    }
}

function createChild(
    parentId: string,
    id: string,
    kind: CanonicalRootBlock['children'][number]['kind'],
    createdAt: number,
    payload: Record<string, unknown>
): CanonicalRootBlock['children'][number] {
    return {
        id,
        sessionId: 'session-1',
        timelineSeq: createdAt,
        siblingSeq: 0,
        parentBlockId: parentId,
        rootBlockId: parentId,
        depth: 1,
        kind,
        createdAt,
        updatedAt: createdAt,
        state: 'completed',
        payload,
        sourceRawEventIds: [`raw-${id}`],
        parserVersion: 1,
        generation: 1,
        children: []
    }
}

function createSession(): Session {
    return {
        id: 'session-1',
        namespace: 'default',
        seq: 1,
        createdAt: 1,
        updatedAt: 2,
        active: true,
        activeAt: 2,
        metadata: {
            path: '/tmp/project',
            host: 'local',
            summary: { text: 'Investigate canonical-only renderer', updatedAt: 2 },
            flavor: 'codex'
        },
        metadataVersion: 1,
        agentState: null,
        agentStateVersion: 1,
        thinking: false,
        thinkingAt: 0
    }
}

describe('contextFormatters canonical inputs', () => {
    it('formats session context from canonical roots without legacy decrypted messages', () => {
        const summary = formatSessionFull(createSession(), [
            createRoot('user-1', 'user-text', 1, { text: 'please inspect the issue' }),
            createRoot('subagent-1', 'subagent-root', 2, { title: 'Worker A', description: 'Check logs' }, [
                createChild('subagent-1', 'subagent-child-1', 'agent-text', 3, { text: 'Found the regression' })
            ]),
            createRoot('fallback-1', 'fallback-raw', 4, {
                provider: 'codex',
                rawType: 'unknown_payload',
                summary: 'unsupported raw event',
                preview: { raw: true }
            })
        ])

        expect(summary).toContain('History of messages in session: session-1')
        expect(summary).toContain('please inspect the issue')
        expect(summary).toContain('Worker A')
        expect(summary).toContain('unsupported raw event')
    })

    it('formats incremental updates from canonical roots', () => {
        const update = formatNewMessages('session-1', [
            createRoot('agent-1', 'agent-text', 5, { text: 'Done.' })
        ])

        expect(update).toContain('New messages in session: session-1')
        expect(update).toContain('Done.')
    })
})
