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
})
