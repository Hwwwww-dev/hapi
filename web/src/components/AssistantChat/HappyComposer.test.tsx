import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, createEvent, fireEvent, render, screen } from '@testing-library/react'

const sendMock = vi.fn()
const cancelRunMock = vi.fn()
const setTextMock = vi.fn()
const addAttachmentMock = vi.fn()

let mockState = {
    composer: {
        text: 'hello',
        attachments: [] as Array<{ status: { type: string } }>
    },
    thread: {
        isRunning: false,
        isDisabled: false
    }
}

vi.mock('@assistant-ui/react', async () => {
    const React = await import('react')

    return {
        useAssistantApi: () => ({
            composer: () => ({
                send: sendMock,
                setText: setTextMock,
                addAttachment: addAttachmentMock
            }),
            thread: () => ({
                cancelRun: cancelRunMock
            })
        }),
        useAssistantState: (selector: (state: typeof mockState) => unknown) => selector(mockState),
        ComposerPrimitive: {
            Root: ({ children, className, onSubmit }: { children: React.ReactNode; className?: string; onSubmit?: (event: React.FormEvent<HTMLFormElement>) => void }) => (
                <form className={className} onSubmit={onSubmit}>
                    {children}
                </form>
            ),
            Input: React.forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
                function MockComposerInput(props, ref) {
                    const { maxRows: _maxRows, submitOnEnter: _submitOnEnter, cancelOnEscape: _cancelOnEscape, ...rest } = props as React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
                        maxRows?: number
                        submitOnEnter?: boolean
                        cancelOnEscape?: boolean
                    }
                    return <textarea ref={ref} data-testid="composer-input" {...rest} />
                }
            ),
            Attachments: () => null
        }
    }
})

vi.mock('@/hooks/useActiveWord', () => ({
    useActiveWord: () => null
}))

vi.mock('@/hooks/useActiveSuggestions', () => ({
    useActiveSuggestions: () => [[], -1, vi.fn(), vi.fn(), vi.fn()]
}))

vi.mock('@/hooks/usePlatform', () => ({
    usePlatform: () => ({
        haptic: {
            impact: vi.fn(),
            notification: vi.fn()
        },
        isTouch: false
    })
}))

vi.mock('@/hooks/usePWAInstall', () => ({
    usePWAInstall: () => ({
        isStandalone: false,
        isIOS: false
    })
}))

vi.mock('@/components/ChatInput/FloatingOverlay', () => ({
    FloatingOverlay: ({ children }: { children: React.ReactNode }) => <div>{children}</div>
}))

vi.mock('@/components/ChatInput/Autocomplete', () => ({
    Autocomplete: () => null
}))

vi.mock('@/components/AssistantChat/StatusBar', () => ({
    StatusBar: () => null
}))

vi.mock('@/components/AssistantChat/ComposerButtons', () => ({
    ComposerButtons: () => null
}))

vi.mock('@/components/AssistantChat/AttachmentItem', () => ({
    AttachmentItem: () => null
}))

vi.mock('@/lib/use-translation', () => ({
    useTranslation: () => ({
        t: (key: string) => key
    })
}))

import { HappyComposer } from './HappyComposer'

describe('HappyComposer keyboard behavior', () => {
    beforeEach(() => {
        mockState = {
            composer: {
                text: 'hello',
                attachments: []
            },
            thread: {
                isRunning: false,
                isDisabled: false
            }
        }
        vi.clearAllMocks()
    })

    afterEach(() => {
        cleanup()
    })

    it('allows Shift+Enter to insert a newline instead of sending', () => {
        render(<HappyComposer />)

        const textarea = screen.getByTestId('composer-input')
        const event = createEvent.keyDown(textarea, { key: 'Enter', shiftKey: true })
        fireEvent(textarea, event)

        expect(event.defaultPrevented).toBe(false)
        expect(sendMock).not.toHaveBeenCalled()
    })
})
