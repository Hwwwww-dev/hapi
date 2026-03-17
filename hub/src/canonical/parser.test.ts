import { beforeAll, describe, expect, it } from 'bun:test'

import type { CanonicalBlock, CanonicalRootBlock, RawEventEnvelope } from '@hapi/protocol'

type ParseSessionRawEvents = (input: {
    sessionId: string
    parserVersion: number
    rawEvents: RawEventEnvelope[]
    previousState?: unknown | null
}) => {
    roots: CanonicalRootBlock[]
    nextState: unknown
    emittedOps: Array<{
        op: 'append' | 'replace'
        root: CanonicalRootBlock
    }>
    rebuildRequired: boolean
}

const SESSION_ID = 'hapi-session-parser-fixture'
const PARSER_VERSION = 1

let parseSessionRawEvents: ParseSessionRawEvents | null = null

beforeAll(async () => {
    const parserModule = await import('./parser')

    if (typeof parserModule.parseSessionRawEvents !== 'function') {
        throw new Error('Missing parseSessionRawEvents export from ./parser')
    }

    parseSessionRawEvents = parserModule.parseSessionRawEvents as ParseSessionRawEvents
})

function parseFixture(input: {
    rawEvents: RawEventEnvelope[]
    previousState?: unknown | null
}): ReturnType<ParseSessionRawEvents> {
    if (!parseSessionRawEvents) {
        throw new Error('parseSessionRawEvents is not loaded')
    }

    return parseSessionRawEvents({
        sessionId: SESSION_ID,
        parserVersion: PARSER_VERSION,
        rawEvents: input.rawEvents,
        previousState: input.previousState
    })
}

function rawEvent(overrides: Partial<RawEventEnvelope> & {
    id: string
    provider: RawEventEnvelope['provider']
    rawType: string
    payload: unknown
}): RawEventEnvelope {
    return {
        id: overrides.id,
        sessionId: SESSION_ID,
        provider: overrides.provider,
        source: overrides.source ?? 'native',
        sourceSessionId: overrides.sourceSessionId ?? `${overrides.provider}-session-1`,
        sourceKey: overrides.sourceKey ?? overrides.id,
        observationKey: overrides.observationKey ?? null,
        channel: overrides.channel ?? `${overrides.provider}:events`,
        sourceOrder: overrides.sourceOrder ?? 0,
        occurredAt: overrides.occurredAt ?? 1_000,
        ingestedAt: overrides.ingestedAt ?? (overrides.occurredAt ?? 1_000),
        rawType: overrides.rawType,
        payload: overrides.payload,
        ingestSchemaVersion: overrides.ingestSchemaVersion ?? 1
    }
}

function flattenBlocks(roots: CanonicalRootBlock[]): CanonicalBlock[] {
    const blocks: CanonicalBlock[] = []

    function visit(block: CanonicalBlock) {
        blocks.push(block)
        for (const child of block.children) {
            visit(child)
        }
    }

    for (const root of roots) {
        visit(root)
    }

    return blocks
}

function readString(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null
}

function readText(block: CanonicalBlock | null | undefined): string | null {
    if (!block) {
        return null
    }

    return readString(block.payload.text)
        ?? readString(block.payload.message)
        ?? readString(block.payload.content)
        ?? null
}

function readToolIdentity(block: CanonicalBlock | null | undefined): string | null {
    if (!block) {
        return null
    }

    return readString(block.payload.toolUseId)
        ?? readString(block.payload.tool_use_id)
        ?? readString(block.payload.toolId)
        ?? readString(block.payload.callId)
        ?? readString(block.payload.call_id)
        ?? readString(block.payload.toolCallId)
        ?? readString(block.payload.id)
        ?? null
}

function readToolState(block: CanonicalBlock | null | undefined): string | null {
    if (!block) {
        return null
    }

    return readString(block.payload.state) ?? readString(block.state) ?? null
}

function findRoot(roots: CanonicalRootBlock[], kind: CanonicalRootBlock['kind']): CanonicalRootBlock | undefined {
    return roots.find((root) => root.kind === kind)
}

function findBlocksByKind(roots: CanonicalRootBlock[], kind: CanonicalBlock['kind']): CanonicalBlock[] {
    return flattenBlocks(roots).filter((block) => block.kind === kind)
}

function findTool(roots: CanonicalRootBlock[], toolIdentity: string): CanonicalBlock | undefined {
    return findBlocksByKind(roots, 'tool-call').find((block) => readToolIdentity(block) === toolIdentity)
}

function findToolResult(roots: CanonicalRootBlock[], toolIdentity: string): CanonicalBlock | undefined {
    return findBlocksByKind(roots, 'tool-result').find((block) => readToolIdentity(block) === toolIdentity)
}

function findEvent(roots: CanonicalRootBlock[], subtype: string): CanonicalBlock | undefined {
    return findBlocksByKind(roots, 'event').find((block) => block.payload.subtype === subtype)
}

function findFallback(roots: CanonicalRootBlock[], rawType: string): CanonicalBlock | undefined {
    return findBlocksByKind(roots, 'fallback-raw').find((block) => block.payload.rawType === rawType)
}

function sortedRawIds(block: CanonicalBlock | null | undefined): string[] {
    if (!block) {
        return []
    }

    return [...block.sourceRawEventIds].sort()
}

describe('parseSessionRawEvents fixtures', () => {
    it('parses Claude user/reasoning/agent/tool/subagent fixtures with explicit child linkage', () => {
        const result = parseFixture({
            rawEvents: [
                rawEvent({
                    id: 'claude-user-1',
                    provider: 'claude',
                    sourceSessionId: 'claude-parent-session',
                    channel: 'claude:file:main',
                    sourceOrder: 0,
                    occurredAt: 1_000,
                    rawType: 'user',
                    payload: {
                        type: 'user',
                        uuid: 'claude-user-uuid-1',
                        message: {
                            role: 'user',
                            content: 'Inspect the unified parser.'
                        }
                    }
                }),
                rawEvent({
                    id: 'claude-assistant-1',
                    provider: 'claude',
                    sourceSessionId: 'claude-parent-session',
                    channel: 'claude:file:main',
                    sourceOrder: 1,
                    occurredAt: 1_001,
                    rawType: 'assistant',
                    payload: {
                        type: 'assistant',
                        uuid: 'claude-assistant-uuid-1',
                        message: {
                            role: 'assistant',
                            content: [
                                {
                                    type: 'text',
                                    text: '<thinking>Need a child agent</thinking>Launching one now.'
                                },
                                {
                                    type: 'tool_use',
                                    id: 'toolu_task_1',
                                    name: 'Task',
                                    input: {
                                        prompt: 'Inspect parser state',
                                        description: 'Check canonical state transitions'
                                    }
                                }
                            ]
                        }
                    }
                }),
                rawEvent({
                    id: 'claude-tool-result-1',
                    provider: 'claude',
                    sourceSessionId: 'claude-parent-session',
                    channel: 'claude:file:main',
                    sourceOrder: 2,
                    occurredAt: 1_002,
                    rawType: 'user',
                    payload: {
                        type: 'user',
                        uuid: 'claude-tool-result-uuid-1',
                        toolUseResult: {
                            agentId: 'agent-42',
                            title: 'Parser child'
                        },
                        message: {
                            role: 'user',
                            content: [
                                {
                                    type: 'tool_result',
                                    tool_use_id: 'toolu_task_1',
                                    content: 'spawned child agent-42'
                                }
                            ]
                        }
                    }
                }),
                rawEvent({
                    id: 'claude-child-assistant-1',
                    provider: 'claude',
                    sourceSessionId: 'agent-42',
                    channel: 'claude:file:child',
                    sourceOrder: 0,
                    occurredAt: 1_003,
                    rawType: 'assistant',
                    payload: {
                        type: 'assistant',
                        uuid: 'claude-child-assistant-uuid-1',
                        isSidechain: true,
                        message: {
                            role: 'assistant',
                            content: [
                                { type: 'thinking', thinking: 'Inspecting parser state' },
                                { type: 'text', text: 'Child finished inspection.' }
                            ]
                        }
                    }
                })
            ]
        })

        expect(result.roots.map((root) => root.kind)).toEqual([
            'user-text',
            'reasoning',
            'agent-text',
            'tool-call',
            'subagent-root'
        ])
        expect(readText(findRoot(result.roots, 'user-text'))).toBe('Inspect the unified parser.')
        expect(readText(findRoot(result.roots, 'reasoning'))).toContain('Need a child agent')
        expect(readText(findRoot(result.roots, 'agent-text'))).toContain('Launching one now.')

        const taskTool = findTool(result.roots, 'toolu_task_1')
        expect(taskTool).toBeDefined()
        expect(readToolState(taskTool)).toBe('completed')
        expect(findToolResult(result.roots, 'toolu_task_1')).toBeUndefined()

        const subagentRoot = findRoot(result.roots, 'subagent-root')
        expect(subagentRoot).toBeDefined()
        expect(subagentRoot?.children.map((child) => child.kind)).toEqual(['reasoning', 'agent-text'])
        expect(readText(subagentRoot?.children[1])).toContain('Child finished inspection.')
        expect(result.nextState).toBeTruthy()
        expect(result.rebuildRequired).toBe(false)
    })

    it('ignores Claude metadata rows like last-prompt instead of surfacing fallback raw cards', () => {
        const result = parseFixture({
            rawEvents: [
                rawEvent({
                    id: 'claude-last-prompt-1',
                    provider: 'claude',
                    sourceSessionId: 'claude-session-meta-1',
                    channel: 'claude:file:2026-03-16',
                    sourceOrder: 1,
                    occurredAt: 1_500,
                    rawType: 'last-prompt',
                    payload: {
                        type: 'last-prompt',
                        lastPrompt: '从代码上看具体改了什么？',
                        sessionId: 'claude-session-meta-1'
                    }
                })
            ]
        })

        expect(result.roots).toEqual([])
        expect(result.rebuildRequired).toBe(false)
    })

    it('parses Codex reasoning delta merge, tool pairing, token-count, and plan-updated fixtures', () => {
        const result = parseFixture({
            rawEvents: [
                rawEvent({
                    id: 'codex-user-1',
                    provider: 'codex',
                    sourceSessionId: 'codex-thread-1',
                    channel: 'codex:file:2026-03-16',
                    sourceOrder: 20,
                    occurredAt: 2_000,
                    rawType: 'event_msg',
                    payload: {
                        type: 'user_message',
                        message: 'Ship the parser fixtures.'
                    }
                }),
                rawEvent({
                    id: 'codex-reasoning-1',
                    provider: 'codex',
                    sourceSessionId: 'codex-thread-1',
                    channel: 'codex:file:2026-03-16',
                    sourceOrder: 21,
                    occurredAt: 2_001,
                    rawType: 'event_msg',
                    payload: {
                        type: 'agent_reasoning',
                        text: 'Check parser state'
                    }
                }),
                rawEvent({
                    id: 'codex-reasoning-2',
                    provider: 'codex',
                    sourceSessionId: 'codex-thread-1',
                    channel: 'codex:file:2026-03-16',
                    sourceOrder: 22,
                    occurredAt: 2_002,
                    rawType: 'event_msg',
                    payload: {
                        type: 'agent_reasoning_delta',
                        delta: ' before rebuild'
                    }
                }),
                rawEvent({
                    id: 'codex-call-1',
                    provider: 'codex',
                    sourceSessionId: 'codex-thread-1',
                    channel: 'codex:file:2026-03-16',
                    sourceOrder: 23,
                    occurredAt: 2_003,
                    rawType: 'response_item',
                    payload: {
                        type: 'function_call',
                        name: 'shell',
                        call_id: 'call-1',
                        arguments: '{"cmd":"pwd"}'
                    }
                }),
                rawEvent({
                    id: 'codex-call-output-1',
                    provider: 'codex',
                    sourceSessionId: 'codex-thread-1',
                    channel: 'codex:file:2026-03-16',
                    sourceOrder: 24,
                    occurredAt: 2_004,
                    rawType: 'response_item',
                    payload: {
                        type: 'function_call_output',
                        call_id: 'call-1',
                        output: {
                            stdout: '/tmp/project',
                            exit_code: 0
                        }
                    }
                }),
                rawEvent({
                    id: 'codex-token-1',
                    provider: 'codex',
                    sourceSessionId: 'codex-thread-1',
                    channel: 'codex:file:2026-03-16',
                    sourceOrder: 25,
                    occurredAt: 2_005,
                    rawType: 'event_msg',
                    payload: {
                        type: 'token_count',
                        info: {
                            input_tokens: 12,
                            output_tokens: 4
                        }
                    }
                }),
                rawEvent({
                    id: 'codex-plan-1',
                    provider: 'codex',
                    sourceSessionId: 'codex-thread-1',
                    channel: 'codex:file:2026-03-16',
                    sourceOrder: 26,
                    occurredAt: 2_006,
                    rawType: 'event_msg',
                    payload: {
                        type: 'plan_updated',
                        entries: [
                            { content: 'write parser fixtures', status: 'in_progress' }
                        ]
                    }
                }),
                rawEvent({
                    id: 'codex-message-1',
                    provider: 'codex',
                    sourceSessionId: 'codex-thread-1',
                    channel: 'codex:file:2026-03-16',
                    sourceOrder: 27,
                    occurredAt: 2_007,
                    rawType: 'event_msg',
                    payload: {
                        type: 'agent_message',
                        message: 'Done.'
                    }
                })
            ]
        })

        expect(result.roots.map((root) => root.kind)).toEqual([
            'user-text',
            'reasoning',
            'tool-call',
            'event',
            'event',
            'agent-text'
        ])

        const reasoningRoots = result.roots.filter((root) => root.kind === 'reasoning')
        expect(reasoningRoots).toHaveLength(1)
        expect(readText(reasoningRoots[0])).toBe('Check parser state before rebuild')

        const tool = findTool(result.roots, 'call-1')
        expect(tool).toBeDefined()
        expect(readToolState(tool)).toBe('completed')
        expect(findToolResult(result.roots, 'call-1')).toBeUndefined()

        const tokenCountEvent = findEvent(result.roots, 'token-count')
        expect(tokenCountEvent).toBeDefined()
        expect(JSON.stringify(tokenCountEvent?.payload)).toContain('input_tokens')

        const planUpdatedEvent = findEvent(result.roots, 'plan-updated')
        expect(planUpdatedEvent).toBeDefined()
        expect(JSON.stringify(planUpdatedEvent?.payload)).toContain('write parser fixtures')
        expect(result.rebuildRequired).toBe(false)
    })

    it('unwraps native Codex envelopes and suppresses duplicate response_item chat mirrors', () => {
        const result = parseFixture({
            rawEvents: [
                rawEvent({
                    id: 'codex-native-user-event',
                    provider: 'codex',
                    sourceSessionId: 'codex-thread-native-1',
                    channel: 'codex:file:2026-03-16',
                    sourceOrder: 100,
                    occurredAt: 10_000,
                    rawType: 'event_msg',
                    payload: {
                        timestamp: '2026-03-16T11:39:20.313Z',
                        type: 'event_msg',
                        payload: {
                            type: 'user_message',
                            message: '关于覆盖范围，这套新解析架构首期要吃哪些入口？'
                        }
                    }
                }),
                rawEvent({
                    id: 'codex-native-user-response-item',
                    provider: 'codex',
                    sourceSessionId: 'codex-thread-native-1',
                    channel: 'codex:file:2026-03-16',
                    sourceOrder: 101,
                    occurredAt: 10_000,
                    rawType: 'response_item',
                    payload: {
                        timestamp: '2026-03-16T11:39:20.312Z',
                        type: 'response_item',
                        payload: {
                            type: 'message',
                            role: 'user',
                            content: [
                                {
                                    type: 'input_text',
                                    text: '关于覆盖范围，这套新解析架构首期要吃哪些入口？'
                                }
                            ]
                        }
                    }
                }),
                rawEvent({
                    id: 'codex-native-reasoning-event',
                    provider: 'codex',
                    sourceSessionId: 'codex-thread-native-1',
                    channel: 'codex:file:2026-03-16',
                    sourceOrder: 102,
                    occurredAt: 10_100,
                    rawType: 'event_msg',
                    payload: {
                        timestamp: '2026-03-16T11:45:22.859Z',
                        type: 'event_msg',
                        payload: {
                            type: 'agent_reasoning',
                            text: '**Responding to user questions**'
                        }
                    }
                }),
                rawEvent({
                    id: 'codex-native-reasoning-response-item',
                    provider: 'codex',
                    sourceSessionId: 'codex-thread-native-1',
                    channel: 'codex:file:2026-03-16',
                    sourceOrder: 103,
                    occurredAt: 10_101,
                    rawType: 'response_item',
                    payload: {
                        timestamp: '2026-03-16T11:45:22.860Z',
                        type: 'response_item',
                        payload: {
                            type: 'reasoning',
                            summary: [
                                {
                                    type: 'summary_text',
                                    text: '**Responding to user questions**'
                                }
                            ]
                        }
                    }
                }),
                rawEvent({
                    id: 'codex-native-tool-call',
                    provider: 'codex',
                    sourceSessionId: 'codex-thread-native-1',
                    channel: 'codex:file:2026-03-16',
                    sourceOrder: 104,
                    occurredAt: 10_200,
                    rawType: 'response_item',
                    payload: {
                        timestamp: '2026-03-16T11:46:40.771Z',
                        type: 'response_item',
                        payload: {
                            type: 'function_call',
                            name: 'shell',
                            call_id: 'call-native-1',
                            arguments: '{"cmd":"pwd"}'
                        }
                    }
                }),
                rawEvent({
                    id: 'codex-native-tool-result',
                    provider: 'codex',
                    sourceSessionId: 'codex-thread-native-1',
                    channel: 'codex:file:2026-03-16',
                    sourceOrder: 105,
                    occurredAt: 10_201,
                    rawType: 'response_item',
                    payload: {
                        timestamp: '2026-03-16T11:46:40.772Z',
                        type: 'response_item',
                        payload: {
                            type: 'function_call_output',
                            call_id: 'call-native-1',
                            output: {
                                stdout: '/tmp/project',
                                exit_code: 0
                            }
                        }
                    }
                }),
                rawEvent({
                    id: 'codex-native-token-count',
                    provider: 'codex',
                    sourceSessionId: 'codex-thread-native-1',
                    channel: 'codex:file:2026-03-16',
                    sourceOrder: 106,
                    occurredAt: 10_300,
                    rawType: 'event_msg',
                    payload: {
                        timestamp: '2026-03-16T11:46:40.772Z',
                        type: 'event_msg',
                        payload: {
                            type: 'token_count',
                            info: {
                                total_token_usage: {
                                    input_tokens: 12,
                                    output_tokens: 3
                                }
                            }
                        }
                    }
                }),
                rawEvent({
                    id: 'codex-native-turn-context',
                    provider: 'codex',
                    sourceSessionId: 'codex-thread-native-1',
                    channel: 'codex:file:2026-03-16',
                    sourceOrder: 107,
                    occurredAt: 10_301,
                    rawType: 'turn_context',
                    payload: {
                        timestamp: '2026-03-16T11:39:20.312Z',
                        type: 'turn_context',
                        payload: {
                            turn_id: 'turn-1',
                            cwd: '/home/hwwwww/Project/hapi'
                        }
                    }
                }),
                rawEvent({
                    id: 'codex-native-task-started',
                    provider: 'codex',
                    sourceSessionId: 'codex-thread-native-1',
                    channel: 'codex:file:2026-03-16',
                    sourceOrder: 108,
                    occurredAt: 10_302,
                    rawType: 'event_msg',
                    payload: {
                        timestamp: '2026-03-16T11:39:20.311Z',
                        type: 'event_msg',
                        payload: {
                            type: 'task_started',
                            turn_id: 'turn-1'
                        }
                    }
                }),
                rawEvent({
                    id: 'codex-native-agent-event',
                    provider: 'codex',
                    sourceSessionId: 'codex-thread-native-1',
                    channel: 'codex:file:2026-03-16',
                    sourceOrder: 109,
                    occurredAt: 10_400,
                    rawType: 'event_msg',
                    payload: {
                        timestamp: '2026-03-16T11:45:26.088Z',
                        type: 'event_msg',
                        payload: {
                            type: 'agent_message',
                            message: '我理解成：首版最低标准按 A。'
                        }
                    }
                }),
                rawEvent({
                    id: 'codex-native-agent-response-item',
                    provider: 'codex',
                    sourceSessionId: 'codex-thread-native-1',
                    channel: 'codex:file:2026-03-16',
                    sourceOrder: 110,
                    occurredAt: 10_400,
                    rawType: 'response_item',
                    payload: {
                        timestamp: '2026-03-16T11:45:26.088Z',
                        type: 'response_item',
                        payload: {
                            type: 'message',
                            role: 'assistant',
                            content: [
                                {
                                    type: 'output_text',
                                    text: '我理解成：首版最低标准按 A。'
                                }
                            ]
                        }
                    }
                })
            ]
        })

        expect(result.roots.map((root) => root.kind)).toEqual([
            'user-text',
            'reasoning',
            'tool-call',
            'event',
            'agent-text'
        ])
        expect(result.roots.filter((root) => root.kind === 'fallback-raw')).toHaveLength(0)
        expect(result.roots.filter((root) => root.kind === 'user-text')).toHaveLength(1)
        expect(result.roots.filter((root) => root.kind === 'reasoning')).toHaveLength(1)
        expect(result.roots.filter((root) => root.kind === 'agent-text')).toHaveLength(1)
        expect(readText(findRoot(result.roots, 'user-text'))).toContain('关于覆盖范围')
        expect(readText(findRoot(result.roots, 'reasoning'))).toContain('Responding to user questions')
        expect(readText(findRoot(result.roots, 'agent-text'))).toContain('首版最低标准按 A')

        const tool = findTool(result.roots, 'call-native-1')
        expect(tool).toBeDefined()
        expect(readToolState(tool)).toBe('completed')

        const tokenCountEvent = findEvent(result.roots, 'token-count')
        expect(tokenCountEvent).toBeDefined()
        expect(JSON.stringify(tokenCountEvent?.payload)).toContain('input_tokens')
        expect(result.rebuildRequired).toBe(false)
    })

    it('collapses cross-source observations by observationKey, keeps obs-anchor ids stable, and prefers native fields', () => {
        const runtimeOnly = parseFixture({
            rawEvents: [
                rawEvent({
                    id: 'obs-runtime-1',
                    provider: 'claude',
                    source: 'runtime',
                    sourceSessionId: 'claude-parent-session',
                    channel: 'claude:runtime:messages',
                    sourceOrder: 17,
                    occurredAt: 3_000,
                    observationKey: 'claude:uuid:obs-1',
                    rawType: 'assistant',
                    payload: {
                        type: 'assistant',
                        uuid: 'claude-obs-runtime',
                        message: {
                            role: 'assistant',
                            content: [{ type: 'text', text: 'runtime draft text' }]
                        }
                    }
                })
            ]
        })

        const nativeOnly = parseFixture({
            rawEvents: [
                rawEvent({
                    id: 'obs-native-1',
                    provider: 'claude',
                    source: 'native',
                    sourceSessionId: 'claude-parent-session',
                    channel: 'claude:file:main',
                    sourceOrder: 84,
                    occurredAt: 3_000,
                    observationKey: 'claude:uuid:obs-1',
                    rawType: 'assistant',
                    payload: {
                        type: 'assistant',
                        uuid: 'claude-obs-native',
                        message: {
                            role: 'assistant',
                            content: [{ type: 'text', text: 'native final text' }]
                        }
                    }
                })
            ]
        })

        expect(runtimeOnly.roots).toHaveLength(1)
        expect(nativeOnly.roots).toHaveLength(1)
        expect(runtimeOnly.roots[0]?.kind).toBe('agent-text')
        expect(runtimeOnly.roots[0]?.id).toBe(nativeOnly.roots[0]?.id)
        expect(runtimeOnly.emittedOps.map(({ op }) => op)).toEqual(['append'])
        expect(runtimeOnly.nextState).toBeTruthy()

        const merged = parseFixture({
            rawEvents: [
                rawEvent({
                    id: 'obs-native-1',
                    provider: 'claude',
                    source: 'native',
                    sourceSessionId: 'claude-parent-session',
                    channel: 'claude:file:main',
                    sourceOrder: 84,
                    occurredAt: 3_000,
                    observationKey: 'claude:uuid:obs-1',
                    rawType: 'assistant',
                    payload: {
                        type: 'assistant',
                        uuid: 'claude-obs-native',
                        message: {
                            role: 'assistant',
                            content: [{ type: 'text', text: 'native final text' }]
                        }
                    }
                })
            ],
            previousState: runtimeOnly.nextState
        })

        expect(merged.rebuildRequired).toBe(false)
        expect(merged.emittedOps.map(({ op }) => op)).toEqual(['replace'])
        expect(merged.roots).toHaveLength(1)
        expect(merged.roots[0]?.id).toBe(runtimeOnly.roots[0]?.id)
        expect(readText(merged.roots[0])).toBe('native final text')
        expect(sortedRawIds(merged.roots[0])).toEqual(['obs-native-1', 'obs-runtime-1'])
        expect(merged.nextState).toBeTruthy()
    })

    it('upgrades only the closed event set for title-changed, compact, microcompact, turn-duration, and api-error', () => {
        const result = parseFixture({
            rawEvents: [
                rawEvent({
                    id: 'claude-title-event-1',
                    provider: 'claude',
                    source: 'runtime',
                    sourceSessionId: 'claude-parent-session',
                    channel: 'claude:runtime:events',
                    sourceOrder: 40,
                    occurredAt: 4_000,
                    rawType: 'event',
                    payload: {
                        type: 'title-changed',
                        title: 'Parser fixture tests'
                    }
                }),
                rawEvent({
                    id: 'claude-compact-1',
                    provider: 'claude',
                    source: 'runtime',
                    sourceSessionId: 'claude-parent-session',
                    channel: 'claude:runtime:events',
                    sourceOrder: 41,
                    occurredAt: 4_001,
                    rawType: 'event',
                    payload: {
                        type: 'compact',
                        trigger: 'manual',
                        preTokens: 4_000
                    }
                }),
                rawEvent({
                    id: 'claude-microcompact-1',
                    provider: 'claude',
                    source: 'runtime',
                    sourceSessionId: 'claude-parent-session',
                    channel: 'claude:runtime:events',
                    sourceOrder: 42,
                    occurredAt: 4_002,
                    rawType: 'event',
                    payload: {
                        type: 'microcompact',
                        trigger: 'auto',
                        preTokens: 5_000,
                        tokensSaved: 800
                    }
                }),
                rawEvent({
                    id: 'claude-turn-duration-1',
                    provider: 'claude',
                    source: 'runtime',
                    sourceSessionId: 'claude-parent-session',
                    channel: 'claude:runtime:events',
                    sourceOrder: 43,
                    occurredAt: 4_003,
                    rawType: 'event',
                    payload: {
                        type: 'turn-duration',
                        durationMs: 1_234
                    }
                }),
                rawEvent({
                    id: 'claude-api-error-1',
                    provider: 'claude',
                    source: 'runtime',
                    sourceSessionId: 'claude-parent-session',
                    channel: 'claude:runtime:events',
                    sourceOrder: 44,
                    occurredAt: 4_004,
                    rawType: 'event',
                    payload: {
                        type: 'api-error',
                        retryAttempt: 1,
                        maxRetries: 3,
                        error: {
                            message: 'rate limited'
                        }
                    }
                })
            ]
        })

        expect(result.roots.map((root) => root.kind)).toEqual([
            'event',
            'event',
            'event',
            'event',
            'event'
        ])
        expect(result.roots.map((root) => root.payload.subtype)).toEqual([
            'title-changed',
            'compact',
            'microcompact',
            'turn-duration',
            'api-error'
        ])
        expect(findEvent(result.roots, 'title-changed')?.payload.title).toBe('Parser fixture tests')
        expect(result.rebuildRequired).toBe(false)
    })

    it('preserves outbound user payload fidelity and upgrades generic runtime status messages', () => {
        const result = parseFixture({
            rawEvents: [
                rawEvent({
                    id: 'runtime-user-1',
                    provider: 'cursor',
                    source: 'runtime',
                    sourceSessionId: 'cursor-session-1',
                    channel: 'cursor:runtime',
                    sourceOrder: 1,
                    occurredAt: 4_100,
                    rawType: 'user',
                    payload: {
                        type: 'user',
                        role: 'user',
                        content: {
                            type: 'text',
                            text: 'attach this',
                            attachments: [
                                { id: 'att-1', filename: 'a.txt', mimeType: 'text/plain', size: 1, path: '/tmp/a.txt' }
                            ]
                        },
                        localId: 'local-user-1',
                        meta: {
                            sentFrom: 'webapp'
                        }
                    }
                }),
                rawEvent({
                    id: 'runtime-message-1',
                    provider: 'opencode',
                    source: 'runtime',
                    sourceSessionId: 'opencode-session-1',
                    channel: 'opencode:runtime',
                    sourceOrder: 2,
                    occurredAt: 4_101,
                    rawType: 'message',
                    payload: {
                        type: 'message',
                        message: 'Aborted by user'
                    }
                })
            ]
        })

        expect(result.roots.map((root) => root.kind)).toEqual(['user-text', 'agent-text'])
        expect(result.roots[0]?.payload).toEqual(expect.objectContaining({
            text: 'attach this',
            localId: 'local-user-1',
            attachments: [
                expect.objectContaining({ id: 'att-1', filename: 'a.txt' })
            ],
            meta: expect.objectContaining({
                sentFrom: 'webapp'
            })
        }))
        expect(readText(result.roots[1])).toBe('Aborted by user')
    })

    it('keeps the timeline flat when Claude sidechain-like events lack explicit parent-child evidence', () => {
        const result = parseFixture({
            rawEvents: [
                rawEvent({
                    id: 'claude-task-no-link-1',
                    provider: 'claude',
                    sourceSessionId: 'claude-parent-session',
                    channel: 'claude:file:main',
                    sourceOrder: 50,
                    occurredAt: 5_000,
                    rawType: 'assistant',
                    payload: {
                        type: 'assistant',
                        uuid: 'claude-task-no-link-uuid-1',
                        message: {
                            role: 'assistant',
                            content: [
                                {
                                    type: 'tool_use',
                                    id: 'toolu_task_no_link',
                                    name: 'Task',
                                    input: {
                                        prompt: 'Audit parser state'
                                    }
                                }
                            ]
                        }
                    }
                }),
                rawEvent({
                    id: 'claude-child-user-no-link-1',
                    provider: 'claude',
                    sourceSessionId: 'agent-unlinked-1',
                    channel: 'claude:file:child',
                    sourceOrder: 0,
                    occurredAt: 5_001,
                    rawType: 'user',
                    payload: {
                        type: 'user',
                        uuid: 'claude-child-user-no-link-uuid-1',
                        isSidechain: true,
                        message: {
                            role: 'user',
                            content: 'Audit parser state'
                        }
                    }
                }),
                rawEvent({
                    id: 'claude-child-assistant-no-link-1',
                    provider: 'claude',
                    sourceSessionId: 'agent-unlinked-1',
                    channel: 'claude:file:child',
                    sourceOrder: 1,
                    occurredAt: 5_002,
                    rawType: 'assistant',
                    payload: {
                        type: 'assistant',
                        uuid: 'claude-child-assistant-no-link-uuid-1',
                        isSidechain: true,
                        message: {
                            role: 'assistant',
                            content: [{ type: 'text', text: 'Still flat.' }]
                        }
                    }
                })
            ]
        })

        expect(result.roots.map((root) => root.kind)).not.toContain('subagent-root')
        expect(result.roots.every((root) => root.children.length === 0)).toBe(true)
        expect(result.roots.map((root) => root.kind)).toContain('tool-call')
        expect(result.roots.map((root) => root.kind)).toContain('agent-text')
        expect(result.roots).toHaveLength(3)
        expect(result.rebuildRequired).toBe(false)
    })

    it('falls back visibly for unsupported Gemini, Cursor, and OpenCode payloads', () => {
        const result = parseFixture({
            rawEvents: [
                rawEvent({
                    id: 'gemini-raw-1',
                    provider: 'gemini',
                    sourceSessionId: 'gemini-session-1',
                    channel: 'gemini:runtime',
                    sourceOrder: 0,
                    occurredAt: 6_000,
                    rawType: 'gemini-unsupported',
                    payload: {
                        type: 'gemini_unknown',
                        foo: 'bar'
                    }
                }),
                rawEvent({
                    id: 'cursor-raw-1',
                    provider: 'cursor',
                    sourceSessionId: 'cursor-session-1',
                    channel: 'cursor:runtime',
                    sourceOrder: 1,
                    occurredAt: 6_001,
                    rawType: 'cursor-system',
                    payload: {
                        type: 'cursor_mystery',
                        data: { ok: true }
                    }
                }),
                rawEvent({
                    id: 'opencode-raw-1',
                    provider: 'opencode',
                    sourceSessionId: 'opencode-session-1',
                    channel: 'opencode:runtime',
                    sourceOrder: 2,
                    occurredAt: 6_002,
                    rawType: 'opencode-unsupported',
                    payload: {
                        type: 'opencode_mystery',
                        flag: true
                    }
                })
            ]
        })

        expect(result.roots.map((root) => root.kind)).toEqual([
            'fallback-raw',
            'fallback-raw',
            'fallback-raw'
        ])
        expect(findFallback(result.roots, 'gemini-unsupported')?.payload.rawType).toBe('gemini-unsupported')
        expect(findFallback(result.roots, 'cursor-system')?.payload.rawType).toBe('cursor-system')
        expect(findFallback(result.roots, 'opencode-unsupported')?.payload.rawType).toBe('opencode-unsupported')
        expect(result.rebuildRequired).toBe(false)
    })

    it('keeps orphan tool results visible when no opening tool call exists', () => {
        const result = parseFixture({
            rawEvents: [
                rawEvent({
                    id: 'codex-orphan-output-1',
                    provider: 'codex',
                    sourceSessionId: 'codex-thread-404',
                    channel: 'codex:file:2026-03-16',
                    sourceOrder: 70,
                    occurredAt: 7_000,
                    rawType: 'response_item',
                    payload: {
                        type: 'function_call_output',
                        call_id: 'call-404',
                        output: {
                            stderr: 'missing opener'
                        }
                    }
                })
            ]
        })

        expect(result.roots.map((root) => root.kind)).toEqual(['tool-result'])
        expect(findToolResult(result.roots, 'call-404')).toBeDefined()
        expect(findTool(result.roots, 'call-404')).toBeUndefined()
        expect(result.rebuildRequired).toBe(false)
    })
})
