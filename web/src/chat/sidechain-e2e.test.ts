/**
 * End-to-end test: DecryptedMessage → normalize → trace → reduce → ChatBlock.children
 * Uses the ACTUAL message format produced by CLI (role: 'agent', content: { type: 'output', data: body })
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { normalizeDecryptedMessage } from './normalize'
import { traceMessages } from './tracer'
import { reduceChatBlocks } from './reducer'
import type { DecryptedMessage } from '@/types/api'

let seqCounter = 0
function msg(id: string, content: unknown): DecryptedMessage {
    return { id, seq: ++seqCounter, localId: null, content, createdAt: Date.now() }
}

/** CLI sends sidechain/agent messages as role='agent', content={type:'output', data: body} */
function cliAgentMsg(id: string, body: Record<string, unknown>): DecryptedMessage {
    return msg(id, { role: 'agent', content: { type: 'output', data: body }, meta: { sentFrom: 'cli' } })
}

/** CLI sends normal user messages as role='user', content={type:'text', text} */
function cliUserMsg(id: string, text: string): DecryptedMessage {
    return msg(id, { role: 'user', content: { type: 'text', text }, meta: { sentFrom: 'cli' } })
}

describe('sidechain e2e: DecryptedMessage → ChatBlock.children', () => {
    beforeEach(() => { seqCounter = 0 })

    it('step 1: normalize correctly sets isSidechain on sidechain user message', () => {
        const m = cliAgentMsg('sc-user-1', {
            type: 'user',
            isSidechain: true,
            uuid: 'uuid-sc-root',
            parentUuid: null,
            message: { role: 'user', content: 'do the task' }
        })
        const normalized = normalizeDecryptedMessage(m)
        expect(normalized).not.toBeNull()
        expect(normalized!.isSidechain).toBe(true)
        expect(normalized!.role).toBe('agent')
        expect(normalized!.content).toEqual([
            expect.objectContaining({ type: 'sidechain', prompt: 'do the task' })
        ])
    })

    it('step 2: normalize correctly sets isSidechain on sidechain assistant message', () => {
        const m = cliAgentMsg('sc-asst-1', {
            type: 'assistant',
            isSidechain: true,
            uuid: 'uuid-sc-child',
            parentUuid: 'uuid-sc-root',
            message: { role: 'assistant', content: [{ type: 'text', text: 'working' }] }
        })
        const normalized = normalizeDecryptedMessage(m)
        expect(normalized).not.toBeNull()
        expect(normalized!.isSidechain).toBe(true)
    })

    it('step 3: tracer matches sidechain root to Task via prompt text', () => {
        const messages = [
            // Main chain: assistant with Task tool call
            cliAgentMsg('task-msg', {
                type: 'assistant',
                isSidechain: false,
                uuid: 'uuid-task-msg',
                parentUuid: 'uuid-prev',
                message: {
                    role: 'assistant',
                    content: [{
                        type: 'tool_use', id: 'tc-1', name: 'Task',
                        input: { prompt: 'do the task', description: 'a task' }
                    }]
                }
            }),
            // Sidechain root (user message)
            cliAgentMsg('sc-root', {
                type: 'user',
                isSidechain: true,
                uuid: 'uuid-sc-root',
                parentUuid: null,
                message: { role: 'user', content: 'do the task' }
            }),
            // Sidechain child (assistant response)
            cliAgentMsg('sc-child', {
                type: 'assistant',
                isSidechain: true,
                uuid: 'uuid-sc-child',
                parentUuid: 'uuid-sc-root',
                message: { role: 'assistant', content: [{ type: 'text', text: 'step 1 done' }] }
            })
        ]

        const normalized = messages.map(m => normalizeDecryptedMessage(m)!).filter(Boolean)
        expect(normalized).toHaveLength(3)

        const traced = traceMessages(normalized)
        const scRoot = traced.find(m => m.id === 'sc-root')
        const scChild = traced.find(m => m.id === 'sc-child')

        expect(scRoot?.sidechainId).toBe('task-msg')
        expect(scChild?.sidechainId).toBe('task-msg')
    })

    it('step 5: normalize handles array content sidechain root (actual SDK format)', () => {
        // SDK sends content as [{type:"text", text:"prompt"}] not a string
        const m = cliAgentMsg('sc-array-root', {
            type: 'user',
            isSidechain: true,
            uuid: 'uuid-sc-array',
            parentUuid: null,
            message: { role: 'user', content: [{ type: 'text', text: 'search for files' }] }
        })
        const normalized = normalizeDecryptedMessage(m)
        expect(normalized).not.toBeNull()
        expect(normalized!.isSidechain).toBe(true)
        expect(normalized!.role).toBe('agent')
        expect(normalized!.content).toEqual([
            expect.objectContaining({ type: 'sidechain', prompt: 'search for files' })
        ])
    })

    it('step 6: full pipeline with Agent tool name and array content (real-world format)', () => {
        const messages = [
            cliUserMsg('user-1', 'explore the codebase'),
            // Main chain: assistant with Agent tool call (not Task)
            cliAgentMsg('agent-msg', {
                type: 'assistant',
                isSidechain: false,
                uuid: 'uuid-agent-msg',
                parentUuid: 'uuid-prev',
                message: {
                    role: 'assistant',
                    content: [{
                        type: 'tool_use', id: 'tc-agent-1', name: 'Agent',
                        input: { prompt: 'search for files', description: 'explore', subagent_type: 'Explore' }
                    }]
                }
            }),
            // Sidechain root with ARRAY content (actual SDK format)
            cliAgentMsg('sc-root-arr', {
                type: 'user',
                isSidechain: true,
                uuid: 'uuid-sc-root-arr',
                parentUuid: null,
                message: { role: 'user', content: [{ type: 'text', text: 'search for files' }] }
            }),
            // Sidechain child
            cliAgentMsg('sc-child-arr', {
                type: 'assistant',
                isSidechain: true,
                uuid: 'uuid-sc-child-arr',
                parentUuid: 'uuid-sc-root-arr',
                message: { role: 'assistant', content: [{ type: 'text', text: 'found 3 files' }] }
            }),
            // Agent result in main chain
            cliAgentMsg('agent-result-msg', {
                type: 'user',
                isSidechain: false,
                uuid: 'uuid-agent-result',
                parentUuid: 'uuid-agent-msg',
                message: {
                    role: 'user',
                    content: [{ type: 'tool_result', tool_use_id: 'tc-agent-1', content: 'Done', is_error: false }]
                }
            })
        ]

        const normalized = messages.map(m => normalizeDecryptedMessage(m)!).filter(Boolean)
        const { blocks } = reduceChatBlocks(normalized, null)

        // Find the Agent tool block
        const agentBlock = blocks.find(b => b.kind === 'tool-call' && b.tool.name === 'Agent')
        expect(agentBlock).toBeDefined()
        expect(agentBlock!.kind === 'tool-call' && agentBlock!.children.length).toBeGreaterThan(0)
    })
})
