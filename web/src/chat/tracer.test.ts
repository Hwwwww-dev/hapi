import { describe, it, expect } from 'vitest'
import { traceMessages } from './tracer'
import type { NormalizedMessage } from './types'

function makeAgentMsg(id: string, opts: {
    uuid?: string
    parentUUID?: string | null
    isSidechain?: boolean
    toolCalls?: Array<{ id: string; name: string; input: unknown }>
    text?: string
}): NormalizedMessage {
    const uuid = opts.uuid ?? id
    const parentUUID = opts.parentUUID ?? null
    const content = opts.toolCalls
        ? opts.toolCalls.map(tc => ({
            type: 'tool-call' as const,
            id: tc.id,
            name: tc.name,
            input: tc.input,
            description: null,
            uuid,
            parentUUID
        }))
        : [{ type: 'text' as const, text: opts.text ?? 'hello', uuid, parentUUID }]
    return {
        id,
        localId: null,
        createdAt: Date.now(),
        role: 'agent',
        isSidechain: opts.isSidechain ?? false,
        content
    }
}

function makeSidechainRootMsg(id: string, opts: {
    uuid: string
    parentUUID: string | null
    prompt: string
}): NormalizedMessage {
    return {
        id,
        localId: null,
        createdAt: Date.now(),
        role: 'agent',
        isSidechain: true,
        content: [{ type: 'sidechain', uuid: opts.uuid, parentUUID: opts.parentUUID, prompt: opts.prompt }]
    }
}

function makeSidechainChildMsg(id: string, opts: {
    uuid: string
    parentUUID: string
    text?: string
}): NormalizedMessage {
    return {
        id,
        localId: null,
        createdAt: Date.now(),
        role: 'agent',
        isSidechain: true,
        content: [{ type: 'text', text: opts.text ?? 'step', uuid: opts.uuid, parentUUID: opts.parentUUID }]
    }
}

describe('traceMessages', () => {
    it('non-sidechain messages pass through unchanged', () => {
        const msg = makeAgentMsg('m1', { text: 'hello' })
        const result = traceMessages([msg])
        expect(result).toHaveLength(1)
        expect(result[0].sidechainId).toBeUndefined()
    })

    it('matches sidechain root via prompt text', () => {
        const taskMsg = makeAgentMsg('task-msg', {
            uuid: 'uuid-task',
            toolCalls: [{ id: 'tc1', name: 'Task', input: { prompt: 'do the thing' } }]
        })
        const sidechainRoot = makeSidechainRootMsg('sc-root', {
            uuid: 'uuid-sc-root',
            parentUUID: null,
            prompt: 'do the thing'
        })
        const result = traceMessages([taskMsg, sidechainRoot])
        const scResult = result.find(m => m.id === 'sc-root')
        expect(scResult?.sidechainId).toBe('task-msg')
    })

    it('matches sidechain root via parentUUID → Task message UUID (primary fix)', () => {
        const taskMsg = makeAgentMsg('task-msg', {
            uuid: 'uuid-task',
            toolCalls: [{ id: 'tc1', name: 'Task', input: { prompt: 'do the thing' } }]
        })
        // Sidechain root has parentUUID pointing to the Task message UUID
        // but prompt text is different (simulating the mismatch bug)
        const sidechainRoot = makeSidechainRootMsg('sc-root', {
            uuid: 'uuid-sc-root',
            parentUUID: 'uuid-task',
            prompt: 'DIFFERENT TEXT - should still match via UUID'
        })
        const result = traceMessages([taskMsg, sidechainRoot])
        const scResult = result.find(m => m.id === 'sc-root')
        expect(scResult?.sidechainId).toBe('task-msg')
    })

    it('propagates sidechainId to child messages via UUID chain', () => {
        const taskMsg = makeAgentMsg('task-msg', {
            uuid: 'uuid-task',
            toolCalls: [{ id: 'tc1', name: 'Task', input: { prompt: 'do the thing' } }]
        })
        const sidechainRoot = makeSidechainRootMsg('sc-root', {
            uuid: 'uuid-sc-root',
            parentUUID: 'uuid-task',
            prompt: 'do the thing'
        })
        const child1 = makeSidechainChildMsg('sc-child1', {
            uuid: 'uuid-child1',
            parentUUID: 'uuid-sc-root'
        })
        const child2 = makeSidechainChildMsg('sc-child2', {
            uuid: 'uuid-child2',
            parentUUID: 'uuid-child1'
        })
        const result = traceMessages([taskMsg, sidechainRoot, child1, child2])
        expect(result.find(m => m.id === 'sc-root')?.sidechainId).toBe('task-msg')
        expect(result.find(m => m.id === 'sc-child1')?.sidechainId).toBe('task-msg')
        expect(result.find(m => m.id === 'sc-child2')?.sidechainId).toBe('task-msg')
    })

    it('resolves orphan messages when parent UUID is later assigned', () => {
        const taskMsg = makeAgentMsg('task-msg', {
            uuid: 'uuid-task',
            toolCalls: [{ id: 'tc1', name: 'Task', input: { prompt: 'do the thing' } }]
        })
        const sidechainRoot = makeSidechainRootMsg('sc-root', {
            uuid: 'uuid-sc-root',
            parentUUID: 'uuid-task',
            prompt: 'do the thing'
        })
        // child arrives before root in the array (out of order)
        const child = makeSidechainChildMsg('sc-child', {
            uuid: 'uuid-child',
            parentUUID: 'uuid-sc-root'
        })
        const result = traceMessages([taskMsg, child, sidechainRoot])
        expect(result.find(m => m.id === 'sc-root')?.sidechainId).toBe('task-msg')
        expect(result.find(m => m.id === 'sc-child')?.sidechainId).toBe('task-msg')
    })

    it('sidechain without matching Task has no sidechainId', () => {
        const sidechainRoot = makeSidechainRootMsg('sc-root', {
            uuid: 'uuid-sc-root',
            parentUUID: 'uuid-unknown',
            prompt: 'orphan task'
        })
        const result = traceMessages([sidechainRoot])
        expect(result.find(m => m.id === 'sc-root')?.sidechainId).toBeUndefined()
    })

    it('multiple Task calls each get their own sidechain group', () => {
        const taskMsg1 = makeAgentMsg('task-msg-1', {
            uuid: 'uuid-task-1',
            toolCalls: [{ id: 'tc1', name: 'Task', input: { prompt: 'task one' } }]
        })
        const taskMsg2 = makeAgentMsg('task-msg-2', {
            uuid: 'uuid-task-2',
            toolCalls: [{ id: 'tc2', name: 'Task', input: { prompt: 'task two' } }]
        })
        const sc1Root = makeSidechainRootMsg('sc1-root', {
            uuid: 'uuid-sc1',
            parentUUID: 'uuid-task-1',
            prompt: 'task one'
        })
        const sc2Root = makeSidechainRootMsg('sc2-root', {
            uuid: 'uuid-sc2',
            parentUUID: 'uuid-task-2',
            prompt: 'task two'
        })
        const result = traceMessages([taskMsg1, taskMsg2, sc1Root, sc2Root])
        expect(result.find(m => m.id === 'sc1-root')?.sidechainId).toBe('task-msg-1')
        expect(result.find(m => m.id === 'sc2-root')?.sidechainId).toBe('task-msg-2')
    })
})
