import { describe, expect, it, vi, beforeEach } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'

let mockMessage: any = null

vi.mock('@assistant-ui/react', () => ({
    useAssistantState: (selector: (state: { message: unknown }) => unknown) => selector({ message: mockMessage }),
    MessagePrimitive: {
        Root: ({ children, className }: { children: React.ReactNode; className?: string }) => <div className={className}>{children}</div>,
        Content: () => <div data-testid="assistant-content">assistant-content</div>
    }
}))

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
    getEventPresentation: () => ({ icon: '⚙️', text: 'event' })
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

describe('message timestamps', () => {
    beforeEach(() => {
        cleanup()
        mockMessage = null
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
        mockMessage = {
            role: 'user',
            createdAt: new Date('2026-03-15T12:34:56.000Z'),
            content: [{ type: 'text', text: 'hello' }],
            metadata: {
                custom: {
                    kind: 'user'
                }
            }
        }

        render(<HappyUserMessage />)

        expect(screen.getByText(/\d{2}:\d{2}:\d{2}/)).toBeInTheDocument()
    })

    it('shows seconds timestamp for assistant messages', () => {
        mockMessage = {
            role: 'assistant',
            createdAt: new Date('2026-03-15T12:34:56.000Z'),
            content: [{ type: 'text', text: 'hello' }],
            metadata: {
                custom: {
                    kind: 'assistant'
                }
            }
        }

        render(<HappyAssistantMessage />)

        expect(screen.getByText(/\d{2}:\d{2}:\d{2}/)).toBeInTheDocument()
    })

    it('shows seconds timestamp for user cli output messages', () => {
        mockMessage = {
            role: 'user',
            createdAt: new Date('2026-03-15T12:34:56.000Z'),
            content: [{ type: 'text', text: 'cli output' }],
            metadata: {
                custom: {
                    kind: 'cli-output',
                    source: 'user'
                }
            }
        }

        render(<HappyUserMessage />)

        expect(screen.getByText(/\d{2}:\d{2}:\d{2}/)).toBeInTheDocument()
    })

    it('shows seconds timestamp for assistant cli output messages', () => {
        mockMessage = {
            role: 'assistant',
            createdAt: new Date('2026-03-15T12:34:56.000Z'),
            content: [{ type: 'text', text: 'cli output' }],
            metadata: {
                custom: {
                    kind: 'cli-output',
                    source: 'assistant'
                }
            }
        }

        render(<HappyAssistantMessage />)

        expect(screen.getByText(/\d{2}:\d{2}:\d{2}/)).toBeInTheDocument()
    })

    it('shows seconds timestamp for system messages', () => {
        mockMessage = {
            role: 'system',
            createdAt: new Date('2026-03-15T12:34:56.000Z'),
            content: [{ type: 'text', text: 'system notice' }],
            metadata: {
                custom: {
                    kind: 'event',
                    event: { type: 'session-ready' }
                }
            }
        }

        render(<HappySystemMessage />)

        expect(screen.getByText(/\d{2}:\d{2}:\d{2}/)).toBeInTheDocument()
    })
})

