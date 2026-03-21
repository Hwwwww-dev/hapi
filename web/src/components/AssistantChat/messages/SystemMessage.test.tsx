import { describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

vi.mock('@/chat/presentation', () => ({
    isPillEvent: (event: { type: string; message?: string }) => event.type === 'message' && event.message === 'Aborted by user',
    getEventPresentation: (event: { type: string; message?: string }) => {
        if (event.type === 'message' && event.message === 'Aborted by user') {
            return { icon: null, text: 'Aborted by user' }
        }
        return { icon: null, text: event.message ?? event.type }
    },
    renderEventLabel: (event: { type: string; message?: string }) => {
        if (event.type === 'message' && event.message === 'Aborted by user') {
            return 'Aborted by user'
        }
        return event.message ?? event.type
    }
}))

import { HappySystemMessage } from './SystemMessage'
import type { AgentEventBlock } from '@/chat/types'

describe('HappySystemMessage', () => {
    it('renders aborted-by-user message as pill style system event', () => {
        const block: AgentEventBlock = {
            kind: 'agent-event',
            id: 'test-1',
            createdAt: new Date('2026-03-15T12:34:56.000Z').getTime(),
            event: { type: 'message', message: 'Aborted by user' }
        }

        const { container } = render(<HappySystemMessage block={block} />)

        expect(screen.getByText('Aborted by user')).toBeInTheDocument()
        expect(container.querySelector('.rounded-full')).not.toBeNull()
    })
})
