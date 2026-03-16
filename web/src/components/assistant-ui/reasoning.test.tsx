import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'

let mockMessage: {
    status?: { type: string }
    content: Array<{ type: string }>
} = {
    status: { type: 'complete' },
    content: []
}

vi.mock('@assistant-ui/react', () => ({
    useMessage: () => mockMessage
}))

import { ReasoningGroup } from './reasoning'

afterEach(() => {
    cleanup()
    mockMessage = {
        status: { type: 'complete' },
        content: []
    }
})

describe('ReasoningGroup', () => {
    it('starts collapsed even while reasoning is streaming', () => {
        mockMessage = {
            status: { type: 'running' },
            content: [{ type: 'reasoning' }]
        }

        render(
            <ReasoningGroup startIndex={0} endIndex={0}>
                <div>内部推理</div>
            </ReasoningGroup>
        )

        expect(screen.getByRole('button', { name: /Reasoning/i })).toHaveAttribute('aria-expanded', 'false')
    })

    it('only changes aria-expanded after user click', () => {
        render(
            <ReasoningGroup startIndex={0} endIndex={0}>
                <div>内部推理</div>
            </ReasoningGroup>
        )

        const button = screen.getByRole('button', { name: /Reasoning/i })
        expect(button).toHaveAttribute('aria-expanded', 'false')

        fireEvent.click(button)
        expect(button).toHaveAttribute('aria-expanded', 'true')

        fireEvent.click(button)
        expect(button).toHaveAttribute('aria-expanded', 'false')
    })
})
