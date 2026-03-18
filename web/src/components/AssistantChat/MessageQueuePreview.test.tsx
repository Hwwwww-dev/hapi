import { afterEach, describe, it, expect, vi } from 'vitest'
import { cleanup, render, screen, fireEvent } from '@testing-library/react'
import { MessageQueuePreview } from './MessageQueuePreview'
import type { QueuedMessage } from '@/hooks/useMessageQueue'

const mockQueue: QueuedMessage[] = [
    { id: 'q-1', text: 'First message', createdAt: 1000 },
    { id: 'q-2', text: 'Second message with a very long text that should be truncated at fifty characters limit', createdAt: 2000 },
]

describe('MessageQueuePreview', () => {
    afterEach(cleanup)
    it('renders nothing when queue is empty', () => {
        const { container } = render(
            <MessageQueuePreview queue={[]} onRemove={vi.fn()} onEdit={vi.fn()} onFlush={vi.fn()} isRunning={false} />
        )
        expect(container.firstChild).toBeNull()
    })

    it('renders queue items', () => {
        render(
            <MessageQueuePreview queue={mockQueue} onRemove={vi.fn()} onEdit={vi.fn()} onFlush={vi.fn()} isRunning={false} />
        )
        expect(screen.getByText(/First message/)).toBeTruthy()
    })

    it('truncates long text', () => {
        render(
            <MessageQueuePreview queue={mockQueue} onRemove={vi.fn()} onEdit={vi.fn()} onFlush={vi.fn()} isRunning={false} />
        )
        const longItem = screen.getByText(/Second message/)
        expect(longItem.textContent!.length).toBeLessThanOrEqual(53) // 50 + "..."
    })

    it('calls onRemove when clicking remove button', () => {
        const onRemove = vi.fn()
        render(
            <MessageQueuePreview queue={mockQueue} onRemove={onRemove} onEdit={vi.fn()} onFlush={vi.fn()} isRunning={false} />
        )
        const removeButtons = screen.getAllByRole('button', { name: /remove/i })
        fireEvent.click(removeButtons[0])
        expect(onRemove).toHaveBeenCalledWith('q-1')
    })

    it('calls onEdit when clicking a bubble', () => {
        const onEdit = vi.fn()
        render(
            <MessageQueuePreview queue={mockQueue} onRemove={vi.fn()} onEdit={onEdit} onFlush={vi.fn()} isRunning={false} />
        )
        fireEvent.click(screen.getByText(/First message/))
        expect(onEdit).toHaveBeenCalledWith(mockQueue[0])
    })

    it('shows flush button when idle', () => {
        render(
            <MessageQueuePreview queue={mockQueue} onRemove={vi.fn()} onEdit={vi.fn()} onFlush={vi.fn()} isRunning={false} />
        )
        const flushBtn = screen.getByRole('button', { name: /发送全部|send all/i })
        expect(flushBtn).toBeTruthy()
    })

    it('shows abort-and-send button when running', () => {
        render(
            <MessageQueuePreview queue={mockQueue} onRemove={vi.fn()} onEdit={vi.fn()} onFlush={vi.fn()} isRunning={true} />
        )
        const flushBtn = screen.getByRole('button', { name: /中止并发送|abort/i })
        expect(flushBtn).toBeTruthy()
    })

    it('calls onFlush when clicking flush button', () => {
        const onFlush = vi.fn()
        render(
            <MessageQueuePreview queue={mockQueue} onRemove={vi.fn()} onEdit={vi.fn()} onFlush={onFlush} isRunning={false} />
        )
        const flushBtn = screen.getByRole('button', { name: /发送全部|send all/i })
        fireEvent.click(flushBtn)
        expect(onFlush).toHaveBeenCalled()
    })
})
