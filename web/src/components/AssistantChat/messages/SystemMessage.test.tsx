import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

let mockMessage: any = null

vi.mock('@assistant-ui/react', () => ({
    useAssistantState: (selector: (state: { message: unknown }) => unknown) => selector({ message: mockMessage })
}))

vi.mock('@/chat/presentation', () => ({
    isPillEvent: (event: { type: string; message?: string }) => event.type === 'message' && event.message === 'Aborted by user',
    getEventPresentation: (event: { type: string; message?: string }) => {
        if (event.type === 'message' && event.message === 'Aborted by user') {
            return { icon: null, text: 'Aborted by user' }
        }
        return { icon: null, text: event.message ?? event.type }
    }
}))

import { HappySystemMessage } from './SystemMessage'

describe('HappySystemMessage', () => {
    it('renders aborted-by-user message as pill style system event', () => {
        mockMessage = {
            role: 'system',
            createdAt: new Date('2026-03-15T12:34:56.000Z'),
            content: [{ type: 'text', text: 'Aborted by user' }],
            metadata: {
                custom: {
                    kind: 'event',
                    event: { type: 'message', message: 'Aborted by user' }
                }
            }
        }

        const { container } = render(<HappySystemMessage />)

        expect(screen.getByText('Aborted by user')).toBeInTheDocument()
        expect(screen.getByText('⏹')).toBeInTheDocument()
        expect(container.querySelector('.rounded-full')).not.toBeNull()
    })
})
