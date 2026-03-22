import { describe, expect, it, vi, beforeEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

const markdownTextSpy = vi.fn()
const rainbowTextSpy = vi.fn()

vi.mock('@/components/AssistantChat/context', () => ({
    useHappyChatContext: () => ({
        onRetryMessage: vi.fn()
    })
}))

vi.mock('@/components/LazyRainbowText', () => ({
    LazyRainbowText: (props: { text: string; size?: 'body' | 'chat' }) => {
        rainbowTextSpy(props)
        return <div data-testid="lazy-rainbow-text">{props.text}</div>
    }
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
    MarkdownText: (props: { text: string; size?: string }) => {
        markdownTextSpy(props)
        return <div data-testid="markdown-text">{props.text}</div>
    }
}))

import { HappyUserMessage } from './UserMessage'
import { HappyAssistantMessage } from './AssistantMessage'
import type { UserTextBlock, AgentTextBlock } from '@/chat/types'

describe('chat body font sizing', () => {
    beforeEach(() => {
        cleanup()
        markdownTextSpy.mockReset()
        rainbowTextSpy.mockReset()
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

    it('renders assistant messages with chat body sizing', () => {
        const block: AgentTextBlock = {
            kind: 'agent-text',
            id: 'assistant-1',
            localId: null,
            createdAt: new Date('2026-03-15T12:34:56.000Z').getTime(),
            text: 'assistant body'
        }

        render(<HappyAssistantMessage block={block} />)

        expect(screen.getByTestId('markdown-text')).toBeInTheDocument()
        expect(markdownTextSpy).toHaveBeenCalledWith(expect.objectContaining({
            text: 'assistant body',
            size: 'chat'
        }))
    })

    it('renders user messages with chat body sizing', () => {
        const block: UserTextBlock = {
            kind: 'user-text',
            id: 'user-1',
            localId: null,
            createdAt: new Date('2026-03-15T12:34:56.000Z').getTime(),
            text: 'user body'
        }

        render(<HappyUserMessage block={block} />)

        expect(screen.getByTestId('lazy-rainbow-text')).toBeInTheDocument()
        expect(rainbowTextSpy).toHaveBeenCalledWith(expect.objectContaining({
            text: 'user body',
            size: 'chat'
        }))
    })

    it('keeps collapsed long user messages at chat body size', () => {
        const block: UserTextBlock = {
            kind: 'user-text',
            id: 'user-2',
            localId: null,
            createdAt: new Date('2026-03-15T12:34:56.000Z').getTime(),
            text: '长文本'.repeat(120)
        }

        const { container } = render(<HappyUserMessage block={block} />)

        const collapsed = container.querySelector('.line-clamp-5')
        expect(collapsed).not.toBeNull()
        expect(collapsed).toHaveClass('text-[length:var(--text-chat-body)]')
    })
})

