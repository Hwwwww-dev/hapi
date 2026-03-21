import { describe, expect, it, vi, beforeEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

vi.mock('@/components/AssistantChat/context', () => ({
    useHappyChatContext: () => ({
        onRetryMessage: vi.fn()
    })
}))

vi.mock('@/components/LazyRainbowText', () => ({
    LazyRainbowText: ({ text }: { text: string }) => <div>{text}</div>
}))

vi.mock('@/components/AssistantChat/messages/MessageAttachments', () => ({
    MessageAttachments: () => <div>attachments</div>
}))

vi.mock('@/components/AssistantChat/messages/MessageStatusIndicator', () => ({
    MessageStatusIndicator: () => <div>status</div>
}))

vi.mock('@/components/CliOutputBlock', () => ({
    CliOutputBlock: ({ text }: { text: string }) => <div>{text}</div>
}))

vi.mock('@/chat/presentation', () => ({
    isPillEvent: () => false,
    getEventPresentation: () => ({ icon: null, text: 'event' }),
    renderEventLabel: () => 'event'
}))

vi.mock('@/hooks/useCopyToClipboard', () => ({
    useCopyToClipboard: () => ({
        copied: false,
        copy: vi.fn()
    })
}))

vi.mock('@/components/assistant-ui/markdown-text', () => ({
    MarkdownText: () => <div>markdown</div>
}))

vi.mock('@/components/assistant-ui/reasoning', () => ({
    Reasoning: () => <div>reasoning</div>,
    ReasoningGroup: () => <div>reasoning-group</div>
}))

vi.mock('@/components/AssistantChat/messages/ToolMessage', () => ({
    HappyToolMessage: () => <div>tool-message</div>
}))

import { HappyUserMessage } from './UserMessage'
import { HappyAssistantMessage } from './AssistantMessage'
import { HappySystemMessage } from './SystemMessage'
import type { UserTextBlock, AgentTextBlock, AgentEventBlock } from '@/chat/types'

describe('message timestamps', () => {
    beforeEach(() => {
        cleanup()
        Object.defineProperty(window, 'matchMedia', {
            writable: true,
            value: vi.fn().mockImplementation((query: string) => ({
                matches: false,
                media: query,
                onchange: null,
                addListener: vi.fn(),
                removeListener: vi.fn(),
                addEventListener: vi.fn(),
                removeEventListener: vi.fn(),
                dispatchEvent: vi.fn()
            }))
        })
    })

    it('shows seconds timestamp for user messages', () => {
        const block: UserTextBlock = {
            kind: 'user-text',
            id: 'msg-1',
            localId: null,
            createdAt: new Date('2026-03-15T12:34:56.000Z').getTime(),
            text: 'hello'
        }

        render(<HappyUserMessage block={block} />)

        expect(screen.getByText(/\d{2}:\d{2}:\d{2}/)).toBeInTheDocument()
    })

    it('shows seconds timestamp for assistant messages', () => {
        const block: AgentTextBlock = {
            kind: 'agent-text',
            id: 'msg-2',
            localId: null,
            createdAt: new Date('2026-03-15T12:34:56.000Z').getTime(),
            text: 'hello'
        }

        render(<HappyAssistantMessage block={block} />)

        expect(screen.getByText(/\d{2}:\d{2}:\d{2}/)).toBeInTheDocument()
    })

    it('shows seconds timestamp for system messages', () => {
        const block: AgentEventBlock = {
            kind: 'agent-event',
            id: 'msg-5',
            createdAt: new Date('2026-03-15T12:34:56.000Z').getTime(),
            event: { type: 'ready' }
        }

        render(<HappySystemMessage block={block} />)

        expect(screen.getByText(/\d{2}:\d{2}:\d{2}/)).toBeInTheDocument()
    })
})
