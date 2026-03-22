import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, createEvent, fireEvent, render } from '@testing-library/react'

import { ComposerProvider, type ComposerContextValue } from '@/chat/composer-context'

const sendMock = vi.fn()
const cancelRunMock = vi.fn()
const setTextMock = vi.fn()
const addAttachmentMock = vi.fn()
const removeAttachmentMock = vi.fn()

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

function renderWithComposer(composerText = 'hello') {
    setTextMock.mockClear()

    const composerValue: ComposerContextValue = {
        text: composerText,
        setText: setTextMock,
        attachments: [],
        addAttachment: addAttachmentMock,
        removeAttachment: removeAttachmentMock,
        send: sendMock,
        cancelRun: cancelRunMock,
    }

    return render(
        <ComposerProvider value={composerValue}>
            <HappyComposer />
        </ComposerProvider>
    )
}

describe('HappyComposer keyboard behavior', () => {
    beforeEach(() => {
        vi.clearAllMocks()
    })

    afterEach(() => {
        cleanup()
    })

    it('allows Enter to insert a newline instead of sending', () => {
        renderWithComposer('hello')

        const textarea = document.querySelector('textarea')!
        const event = createEvent.keyDown(textarea, { key: 'Enter' })
        fireEvent(textarea, event)

        expect(event.defaultPrevented).toBe(false)
        expect(sendMock).not.toHaveBeenCalled()
    })

    it('sends message on Ctrl+Enter', () => {
        renderWithComposer('hello')

        const textarea = document.querySelector('textarea')!
        const event = createEvent.keyDown(textarea, { key: 'Enter', ctrlKey: true })
        fireEvent(textarea, event)

        expect(event.defaultPrevented).toBe(true)
        expect(sendMock).toHaveBeenCalled()
    })
})
