import { describe, expect, it } from 'vitest'

import { normalizeDecryptedMessage } from './normalize'
import type { DecryptedMessage } from '@/types/api'

function createMessage(content: unknown): DecryptedMessage {
    return {
        id: 'msg-1',
        seq: 1,
        localId: null,
        content,
        createdAt: 1
    }
}

describe('normalizeDecryptedMessage', () => {
    it('normalizes Claude native assistant block arrays instead of rendering raw JSON', () => {
        const normalized = normalizeDecryptedMessage(createMessage({
            type: 'assistant',
            message: {
                role: 'assistant',
                content: [
                    { type: 'thinking', thinking: '先编译一下' },
                    { type: 'tool_use', id: 'call-1', name: 'Bash', input: { command: 'go build' } },
                    { type: 'text', text: '编译成功' }
                ]
            }
        }))

        expect(normalized).toEqual(expect.objectContaining({
            role: 'agent',
            content: [
                expect.objectContaining({ type: 'reasoning', text: '先编译一下' }),
                expect.objectContaining({ type: 'tool-call', id: 'call-1', name: 'Bash' }),
                expect.objectContaining({ type: 'text', text: '编译成功' })
            ]
        }))
    })

    it('normalizes Claude native user tool results into tool-result blocks', () => {
        const normalized = normalizeDecryptedMessage(createMessage({
            type: 'user',
            message: {
                role: 'user',
                content: [
                    {
                        type: 'tool_result',
                        tool_use_id: 'call-2',
                        content: '(Bash completed with no output)',
                        is_error: false
                    }
                ]
            }
        }))

        expect(normalized).toEqual(expect.objectContaining({
            role: 'agent',
            content: [
                expect.objectContaining({
                    type: 'tool-result',
                    tool_use_id: 'call-2',
                    content: '(Bash completed with no output)',
                    is_error: false
                })
            ]
        }))
    })

    it('drops unsupported Claude system output records', () => {
        const normalized = normalizeDecryptedMessage(createMessage({
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'system',
                    subtype: 'stop_hook_summary',
                    uuid: 'sys-1'
                }
            }
        }))

        expect(normalized).toBeNull()
    })

    it('drops Claude init system output records', () => {
        const normalized = normalizeDecryptedMessage(createMessage({
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'system',
                    subtype: 'init',
                    uuid: 'sys-init',
                    session_id: 'session-1'
                }
            }
        }))

        expect(normalized).toBeNull()
    })

    it('keeps known Claude system subtypes as normalized events', () => {
        const normalized = normalizeDecryptedMessage(createMessage({
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'system',
                    subtype: 'turn_duration',
                    uuid: 'sys-2',
                    durationMs: 1200
                }
            }
        }))

        expect(normalized).toMatchObject({
            id: 'msg-1',
            role: 'event',
            isSidechain: false,
            content: {
                type: 'turn-duration',
                durationMs: 1200
            }
        })
    })

    it('keeps the stringify fallback for unknown non-system agent payloads', () => {
        const normalized = normalizeDecryptedMessage(createMessage({
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'assistant',
                    foo: 'bar'
                }
            }
        }))

        expect(normalized).toMatchObject({
            id: 'msg-1',
            role: 'agent',
            isSidechain: false
        })

        expect(normalized?.role).toBe('agent')
        if (!normalized || normalized.role !== 'agent') {
            throw new Error('Expected agent message')
        }
        const firstBlock = normalized.content[0]
        expect(firstBlock).toMatchObject({
            type: 'text'
        })
        if (firstBlock.type !== 'text') {
            throw new Error('Expected fallback text block')
        }
        expect(firstBlock.text).toContain('"foo": "bar"')
    })

    it('parses thinking tags embedded in assistant text into reasoning blocks', () => {
        const normalized = normalizeDecryptedMessage(createMessage({
            type: 'assistant',
            message: {
                role: 'assistant',
                content: '<thinking>先检查 shouldSend</thinking>\n结论：需要先判断 all=true'
            }
        }))

        expect(normalized).toEqual(expect.objectContaining({
            role: 'agent',
            content: [
                expect.objectContaining({ type: 'reasoning', text: '先检查 shouldSend' }),
                expect.objectContaining({ type: 'text', text: '结论：需要先判断 all=true' })
            ]
        }))
    })

    it('marks overlong Claude thinking blocks as truncated reasoning', () => {
        const thinking = '想'.repeat(64 * 1024 + 8)
        const normalized = normalizeDecryptedMessage(createMessage({
            type: 'assistant',
            message: {
                role: 'assistant',
                content: [
                    { type: 'thinking', thinking }
                ]
            }
        }))

        expect(normalized).toEqual(expect.objectContaining({
            role: 'agent',
            content: [
                expect.objectContaining({
                    type: 'reasoning',
                    truncated: true
                })
            ]
        }))
        expect(normalized?.role).toBe('agent')
        if (normalized?.role === 'agent') {
            const [reasoning] = normalized.content
            expect(reasoning).toEqual(expect.objectContaining({ type: 'reasoning' }))
            if (reasoning?.type === 'reasoning') {
                expect(reasoning.text.length).toBe(64 * 1024)
            }
        }
    })

    it('marks overlong Codex reasoning messages as truncated reasoning', () => {
        const thinking = '算'.repeat(64 * 1024 + 4)
        const normalized = normalizeDecryptedMessage(createMessage({
            role: 'agent',
            content: {
                type: 'codex',
                data: {
                    type: 'reasoning',
                    message: thinking
                }
            }
        }))

        expect(normalized).toEqual(expect.objectContaining({
            role: 'agent',
            content: [
                expect.objectContaining({
                    type: 'reasoning',
                    truncated: true
                })
            ]
        }))
    })

    it('keeps Claude native user text block arrays as user text', () => {
        const normalized = normalizeDecryptedMessage(createMessage({
            type: 'user',
            message: {
                role: 'user',
                content: [
                    { type: 'text', text: '你都验证过了吗？' }
                ]
            }
        }))

        expect(normalized).toEqual(expect.objectContaining({
            role: 'user',
            content: {
                type: 'text',
                text: '你都验证过了吗？'
            }
        }))
    })

    it('normalizes role-wrapped legacy tool_call arrays into tool-call blocks', () => {
        const normalized = normalizeDecryptedMessage(createMessage({
            role: 'assistant',
            content: [
                {
                    type: 'tool_call',
                    id: 'call-write-1',
                    name: 'write_stdin',
                    input: {
                        chars: '继续\n'
                    }
                }
            ]
        }))

        expect(normalized).toEqual(expect.objectContaining({
            role: 'agent',
            content: [
                expect.objectContaining({
                    type: 'tool-call',
                    id: 'call-write-1',
                    name: 'write_stdin'
                })
            ]
        }))
    })

    it('normalizes Codex legacy tool_call messages into tool-call blocks', () => {
        const normalized = normalizeDecryptedMessage(createMessage({
            role: 'agent',
            content: {
                type: 'codex',
                data: {
                    type: 'tool_call',
                    id: 'call-spawn-1',
                    name: 'spawn_agent',
                    input: {
                        agent_type: 'worker',
                        message: 'inspect logs'
                    }
                }
            }
        }))

        expect(normalized).toEqual(expect.objectContaining({
            role: 'agent',
            content: [
                expect.objectContaining({
                    type: 'tool-call',
                    id: 'call-spawn-1',
                    name: 'spawn_agent'
                })
            ]
        }))
    })

    it('normalizes Codex plan messages into update_plan tool blocks', () => {
        const normalized = normalizeDecryptedMessage(createMessage({
            role: 'agent',
            content: {
                type: 'codex',
                data: {
                    type: 'plan',
                    entries: [
                        { content: '定位问题', priority: 'high', status: 'in_progress' },
                        { content: '修复问题', priority: 'high', status: 'pending' }
                    ]
                }
            }
        }))

        expect(normalized).toEqual(expect.objectContaining({
            role: 'agent',
            content: [
                expect.objectContaining({
                    type: 'tool-call',
                    name: 'update_plan',
                    input: {
                        plan: [
                            { content: '定位问题', priority: 'high', status: 'in_progress' },
                            { content: '修复问题', priority: 'high', status: 'pending' }
                        ]
                    }
                })
            ]
        }))
    })

    it('converts <task-notification> user output to event', () => {
        const normalized = normalizeDecryptedMessage(createMessage({
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'user',
                    uuid: 'u-notif',
                    message: { content: '<task-notification> <summary>Background command stopped</summary> </task-notification>' }
                }
            }
        }))

        // Normalizer emits as sidechain (preserving uuid for sentinel detection);
        // the reducer extracts the summary as an event.
        expect(normalized).toMatchObject({
            role: 'agent',
            isSidechain: true,
        })
        if (normalized?.role === 'agent') {
            expect(normalized.content[0]).toMatchObject({
                type: 'sidechain',
                prompt: expect.stringContaining('<task-notification>')
            })
        }
    })

    it('treats <task-notification> without summary as sidechain (dropped by reducer)', () => {
        const normalized = normalizeDecryptedMessage(createMessage({
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'user',
                    uuid: 'u3',
                    message: { content: '<task-notification> <status>killed</status> </task-notification>' }
                }
            }
        }))

        expect(normalized).toMatchObject({
            role: 'agent',
            isSidechain: true,
        })
    })

    it('treats non-sidechain string user output as sidechain', () => {
        const normalized = normalizeDecryptedMessage(createMessage({
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'user',
                    isSidechain: false,
                    uuid: 'u1',
                    message: { content: 'This is a subagent prompt' }
                }
            }
        }))

        expect(normalized).toMatchObject({
            role: 'agent',
            isSidechain: true,
        })
        if (normalized?.role !== 'agent') throw new Error('Expected agent')
        expect(normalized.content[0]).toMatchObject({
            type: 'sidechain',
            prompt: 'This is a subagent prompt'
        })
    })

    it('treats <system-reminder> user output as sidechain (dropped by reducer)', () => {
        const normalized = normalizeDecryptedMessage(createMessage({
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'user',
                    uuid: 'u2',
                    message: { content: '<system-reminder>Some internal reminder</system-reminder>' }
                }
            }
        }))

        expect(normalized).toMatchObject({
            role: 'agent',
            isSidechain: true,
        })
    })

    it('normalizes sidechain user message (role-wrapped output format) with isSidechain=true', () => {
        const normalized = normalizeDecryptedMessage(createMessage({
            role: 'user',
            content: {
                type: 'output',
                data: {
                    type: 'user',
                    isSidechain: true,
                    uuid: 'sc-uuid-1',
                    parentUuid: 'parent-uuid-task',
                    message: {
                        role: 'user',
                        content: 'implement the feature'
                    }
                }
            }
        }))

        expect(normalized).not.toBeNull()
        expect(normalized?.isSidechain).toBe(true)
        expect(normalized?.role).toBe('agent')
        expect(normalized?.content).toEqual([
            expect.objectContaining({
                type: 'sidechain',
                uuid: 'sc-uuid-1',
                parentUUID: 'parent-uuid-task',
                prompt: 'implement the feature'
            })
        ])
    })

    it('treats sidechain user output with array content as sidechain', () => {
        const normalized = normalizeDecryptedMessage(createMessage({
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'user',
                    uuid: 'u3',
                    isSidechain: true,
                    message: { content: [{ type: 'text', text: 'This is an agent prompt in array form' }] }
                }
            }
        }))

        expect(normalized).toMatchObject({
            role: 'agent',
            isSidechain: true,
        })
        if (normalized?.role !== 'agent') throw new Error('Expected agent')
        expect(normalized.content[0]).toMatchObject({
            type: 'sidechain',
            prompt: 'This is an agent prompt in array form'
        })
    })

    it('normalizes sidechain assistant message with isSidechain=true', () => {
        const normalized = normalizeDecryptedMessage(createMessage({
            role: 'assistant',
            content: {
                type: 'output',
                data: {
                    type: 'assistant',
                    isSidechain: true,
                    uuid: 'sc-uuid-2',
                    parentUuid: 'sc-uuid-1',
                    message: {
                        role: 'assistant',
                        content: [{ type: 'text', text: 'working on it' }]
                    }
                }
            }
        }))

        expect(normalized).not.toBeNull()
        expect(normalized?.isSidechain).toBe(true)
        expect(normalized?.role).toBe('agent')
    })

    it('keeps "No response requested." text in normalized output (filtered later by reducer)', () => {
        const normalized = normalizeDecryptedMessage(createMessage({
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'assistant',
                    uuid: 'a-1',
                    message: { role: 'assistant', content: 'No response requested.' }
                }
            }
        }))

        // Normalizer preserves the text (uuid/parentUUID needed by tracer);
        // the reducer is responsible for suppressing it during rendering.
        expect(normalized).not.toBeNull()
        expect(normalized?.role).toBe('agent')
        if (normalized?.role === 'agent') {
            expect(normalized.content).toHaveLength(1)
            expect(normalized.content[0]).toMatchObject({ type: 'text', text: 'No response requested.' })
        }
    })

    it('keeps assistant messages with real content', () => {
        const normalized = normalizeDecryptedMessage(createMessage({
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'assistant',
                    uuid: 'a-2',
                    message: { role: 'assistant', content: 'Here is the answer.' }
                }
            }
        }))

        expect(normalized).not.toBeNull()
        expect(normalized?.role).toBe('agent')
    })

    it('propagates parentUuid from assistant output data to text block parentUUID', () => {
        const normalized = normalizeDecryptedMessage(createMessage({
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'assistant',
                    uuid: 'a-3',
                    parentUuid: 'parent-injected-uuid',
                    message: { role: 'assistant', content: 'No response requested.' }
                }
            }
        }))

        expect(normalized).not.toBeNull()
        if (normalized?.role !== 'agent') throw new Error('Expected agent')
        expect(normalized.content).toHaveLength(1)
        expect(normalized.content[0]).toMatchObject({
            type: 'text',
            text: 'No response requested.',
            parentUUID: 'parent-injected-uuid'
        })
    })

    it('sets parentUUID to null when parentUuid is absent in assistant output', () => {
        const normalized = normalizeDecryptedMessage(createMessage({
            role: 'agent',
            content: {
                type: 'output',
                data: {
                    type: 'assistant',
                    uuid: 'a-4',
                    // No parentUuid field
                    message: { role: 'assistant', content: 'Hello.' }
                }
            }
        }))

        expect(normalized).not.toBeNull()
        if (normalized?.role !== 'agent') throw new Error('Expected agent')
        expect(normalized.content[0]).toMatchObject({
            type: 'text',
            parentUUID: null
        })
    })
})
