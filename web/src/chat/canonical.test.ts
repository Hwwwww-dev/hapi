import { describe, expect, it } from 'vitest'
import type { CanonicalChildBlock, CanonicalRootBlock } from '@hapi/protocol'

import { canonicalRootsToRenderBlocks } from './canonical'

function createCanonicalChild(overrides: Partial<CanonicalChildBlock> = {}): CanonicalChildBlock {
    return {
        id: 'child-1',
        sessionId: 'session-1',
        timelineSeq: 1,
        siblingSeq: 0,
        parentBlockId: 'root-1',
        rootBlockId: 'root-1',
        depth: 1,
        kind: 'agent-text',
        createdAt: 2,
        updatedAt: 3,
        state: 'complete',
        payload: { text: 'child text' },
        sourceRawEventIds: ['raw-child-1'],
        parserVersion: 1,
        generation: 7,
        children: [],
        ...overrides
    }
}

function createCanonicalRoot(overrides: Partial<CanonicalRootBlock> = {}): CanonicalRootBlock {
    const id = typeof overrides.id === 'string' ? overrides.id : 'root-1'

    return {
        id,
        sessionId: 'session-1',
        timelineSeq: 1,
        siblingSeq: 0,
        parentBlockId: null,
        rootBlockId: id,
        depth: 0,
        kind: 'agent-text',
        createdAt: 1,
        updatedAt: 2,
        state: 'complete',
        payload: { text: 'root text' },
        sourceRawEventIds: ['raw-root-1'],
        parserVersion: 1,
        generation: 7,
        children: [],
        ...overrides
    }
}

describe('canonicalRootsToRenderBlocks', () => {
    it('maps canonical kinds into dedicated render blocks without dropping orphan results or fallback raws', () => {
        const roots: CanonicalRootBlock[] = [
            createCanonicalRoot({
                id: 'reasoning-root',
                timelineSeq: 1,
                kind: 'reasoning',
                state: 'streaming',
                payload: { text: '先检查 parser state' }
            }),
            createCanonicalRoot({
                id: 'tool-root',
                timelineSeq: 2,
                kind: 'tool-call',
                payload: {
                    toolCallId: 'tool-1',
                    toolName: 'Bash',
                    input: { command: 'git status --short' },
                    result: { stdout: 'M web/src/chat/canonical.ts' },
                    state: 'completed',
                    description: 'Inspect git status'
                }
            }),
            createCanonicalRoot({
                id: 'subagent-root',
                timelineSeq: 3,
                kind: 'subagent-root',
                state: 'running',
                payload: {
                    title: 'Planner',
                    description: 'Checks canonical tree',
                    childAgentId: 'agent-42'
                },
                children: [
                    createCanonicalChild({
                        id: 'subagent-reasoning',
                        parentBlockId: 'subagent-root',
                        rootBlockId: 'subagent-root',
                        kind: 'reasoning',
                        state: 'streaming',
                        payload: { text: '先看 root kind' }
                    }),
                    createCanonicalChild({
                        id: 'subagent-fallback',
                        parentBlockId: 'subagent-root',
                        rootBlockId: 'subagent-root',
                        siblingSeq: 1,
                        kind: 'fallback-raw',
                        payload: {
                            provider: 'codex',
                            rawType: 'event_msg',
                            preview: { type: 'event_msg', raw: true },
                            summary: 'Unsupported event'
                        }
                    })
                ]
            }),
            createCanonicalRoot({
                id: 'fallback-root',
                timelineSeq: 4,
                kind: 'fallback-raw',
                payload: {
                    provider: 'claude',
                    rawType: 'assistant-unknown',
                    preview: { foo: 'bar' },
                    summary: 'Unknown assistant payload'
                }
            }),
            createCanonicalRoot({
                id: 'orphan-result-root',
                timelineSeq: 5,
                kind: 'tool-result',
                payload: {
                    toolCallId: 'orphan-tool',
                    toolName: 'Read',
                    result: { content: 'README' },
                    isError: false
                }
            })
        ]

        const blocks = canonicalRootsToRenderBlocks(roots)

        expect(blocks.map((block) => block.kind)).toEqual([
            'reasoning',
            'tool-call',
            'subagent-root',
            'fallback-raw',
            'tool-result'
        ])

        expect(blocks[0]).toMatchObject({
            kind: 'reasoning',
            text: '先检查 parser state',
            state: 'streaming'
        })

        expect(blocks[1]).toMatchObject({
            kind: 'tool-call',
            tool: {
                id: 'tool-1',
                name: 'Bash',
                state: 'completed',
                input: { command: 'git status --short' },
                result: { stdout: 'M web/src/chat/canonical.ts' },
                description: 'Inspect git status'
            }
        })

        expect(blocks[2]).toMatchObject({
            kind: 'subagent-root',
            title: 'Planner',
            description: 'Checks canonical tree',
            subagentId: 'agent-42'
        })
        expect(blocks[2]?.children.map((child) => child.kind)).toEqual(['reasoning', 'fallback-raw'])

        expect(blocks[3]).toMatchObject({
            kind: 'fallback-raw',
            provider: 'claude',
            rawType: 'assistant-unknown',
            preview: { foo: 'bar' }
        })

        expect(blocks[4]).toMatchObject({
            kind: 'tool-result',
            tool: {
                id: 'orphan-tool',
                name: 'Read',
                result: { content: 'README' },
                state: 'completed'
            }
        })
    })
})
