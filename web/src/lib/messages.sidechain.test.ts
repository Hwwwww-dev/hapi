import { describe, it, expect } from 'vitest'
import type { DecryptedMessage } from '@/types/api'
import { isSidechainMessage } from './messages'

function makeMsg(id: string, seq: number, content: unknown): DecryptedMessage {
    return { id, seq, localId: null, content, createdAt: Date.now() }
}

describe('isSidechainMessage', () => {
    it('普通 user 消息 → false', () => {
        const msg = makeMsg('1', 1, { role: 'user', content: 'hello' })
        expect(isSidechainMessage(msg)).toBe(false)
    })

    it('普通 assistant 消息 → false', () => {
        const msg = makeMsg('2', 2, {
            role: 'assistant',
            content: [{ type: 'text', text: 'hi' }],
        })
        expect(isSidechainMessage(msg)).toBe(false)
    })

    it('直接格式 sidechain → true', () => {
        const msg = makeMsg('3', 3, {
            type: 'output',
            data: { type: 'assistant', isSidechain: true, content: [] },
        })
        expect(isSidechainMessage(msg)).toBe(true)
    })

    it('Role-wrapped sidechain → true', () => {
        const msg = makeMsg('4', 4, {
            role: 'agent',
            content: {
                type: 'output',
                data: { type: 'assistant', isSidechain: true, content: [] },
            },
        })
        expect(isSidechainMessage(msg)).toBe(true)
    })

    it('isSidechain = false → false', () => {
        const msg = makeMsg('5', 5, {
            type: 'output',
            data: { type: 'assistant', isSidechain: false, content: [] },
        })
        expect(isSidechainMessage(msg)).toBe(false)
    })

    it('null content → false', () => {
        const msg = makeMsg('6', 6, null)
        expect(isSidechainMessage(msg)).toBe(false)
    })

    it('undefined content → false', () => {
        const msg = makeMsg('7', 7, undefined)
        expect(isSidechainMessage(msg)).toBe(false)
    })

    it('空对象 content → false', () => {
        const msg = makeMsg('8', 8, {})
        expect(isSidechainMessage(msg)).toBe(false)
    })
})

describe('isSidechainMessage 过滤集成', () => {
    const rootContents = [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: [{ type: 'text', text: 'hi' }] },
        { role: 'user', content: 'question' },
        { role: 'assistant', content: [{ type: 'text', text: 'answer' }] },
        { role: 'user', content: 'bye' },
    ]

    const sidechainContents = [
        { type: 'output', data: { type: 'assistant', isSidechain: true, content: [] } },
        { role: 'agent', content: { type: 'output', data: { type: 'assistant', isSidechain: true, content: [] } } },
        { type: 'output', data: { isSidechain: true } },
    ]

    it('5 root + 3 sidechain → filter 后剩 5 条', () => {
        const msgs = [
            ...rootContents.map((c, i) => makeMsg(`r${i}`, i + 1, c)),
            ...sidechainContents.map((c, i) => makeMsg(`s${i}`, 100 + i, c)),
        ]
        const filtered = msgs.filter(m => !isSidechainMessage(m))
        expect(filtered).toHaveLength(5)
    })

    it('全部 sidechain → filter 后剩 0 条', () => {
        const msgs = sidechainContents.map((c, i) => makeMsg(`s${i}`, i + 1, c))
        const filtered = msgs.filter(m => !isSidechainMessage(m))
        expect(filtered).toHaveLength(0)
    })

    it('全部 root → filter 后剩原数量', () => {
        const msgs = rootContents.map((c, i) => makeMsg(`r${i}`, i + 1, c))
        const filtered = msgs.filter(m => !isSidechainMessage(m))
        expect(filtered).toHaveLength(rootContents.length)
    })
})
