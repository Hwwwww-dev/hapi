import { describe, it, expect, beforeEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMessageQueue } from './useMessageQueue'

// Mock localStorage
const localStorageMock = (() => {
    let store: Record<string, string> = {}
    return {
        getItem: vi.fn((key: string): string | null => store[key] ?? null),
        setItem: vi.fn((key: string, value: string) => { store[key] = value }),
        removeItem: vi.fn((key: string) => { delete store[key] }),
        clear: vi.fn(() => { store = {} }),
    }
})()
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock })

vi.mock('@/lib/messages', () => ({
    makeClientSideId: vi.fn((prefix: string) => `${prefix}-test-id-${Date.now()}`),
}))

const mockDeps = {
    sendMessage: vi.fn(async () => {}),
    abort: vi.fn(),
}

describe('useMessageQueue', () => {
    beforeEach(() => {
        localStorageMock.clear()
        vi.clearAllMocks()
    })

    it('starts with empty queue', () => {
        const { result } = renderHook(() => useMessageQueue('session-1', mockDeps))
        expect(result.current.queue).toEqual([])
        expect(result.current.isFlushing).toBe(false)
    })

    it('enqueues a message', () => {
        const { result } = renderHook(() => useMessageQueue('session-1', mockDeps))
        act(() => { result.current.enqueue('hello') })
        expect(result.current.queue).toHaveLength(1)
        expect(result.current.queue[0].text).toBe('hello')
    })

    it('persists to localStorage on enqueue', () => {
        const { result } = renderHook(() => useMessageQueue('session-1', mockDeps))
        act(() => { result.current.enqueue('hello') })
        expect(localStorageMock.setItem).toHaveBeenCalledWith(
            'hapi_msg_queue::session-1',
            expect.any(String)
        )
    })

    it('removes a message by id', () => {
        const { result } = renderHook(() => useMessageQueue('session-1', mockDeps))
        act(() => { result.current.enqueue('msg1') })
        const id = result.current.queue[0].id
        act(() => { result.current.remove(id) })
        expect(result.current.queue).toHaveLength(0)
    })

    it('updates a message text', () => {
        const { result } = renderHook(() => useMessageQueue('session-1', mockDeps))
        act(() => { result.current.enqueue('original') })
        const id = result.current.queue[0].id
        act(() => { result.current.update(id, 'updated') })
        expect(result.current.queue[0].text).toBe('updated')
    })

    it('clears all messages', () => {
        const { result } = renderHook(() => useMessageQueue('session-1', mockDeps))
        act(() => {
            result.current.enqueue('a')
            result.current.enqueue('b')
        })
        act(() => { result.current.clear() })
        expect(result.current.queue).toHaveLength(0)
        expect(localStorageMock.removeItem).toHaveBeenCalledWith('hapi_msg_queue::session-1')
    })

    it('enforces max 20 messages', () => {
        const { result } = renderHook(() => useMessageQueue('session-1', mockDeps))
        act(() => {
            for (let i = 0; i < 25; i++) {
                result.current.enqueue(`msg-${i}`)
            }
        })
        expect(result.current.queue).toHaveLength(20)
    })

    it('restores queue from localStorage on sessionId change', () => {
        const stored = JSON.stringify([{ id: 'q-1', text: 'restored', createdAt: 1000 }])
        localStorageMock.setItem('hapi_msg_queue::session-2', stored)
        localStorageMock.getItem.mockImplementation((key: string): string | null => {
            if (key === 'hapi_msg_queue::session-2') return stored
            return null
        })
        const { result } = renderHook(() => useMessageQueue('session-2', mockDeps))
        expect(result.current.queue).toHaveLength(1)
        expect(result.current.queue[0].text).toBe('restored')
    })

    it('returns null queue when sessionId is null', () => {
        const { result } = renderHook(() => useMessageQueue(null, mockDeps))
        expect(result.current.queue).toEqual([])
        act(() => { result.current.enqueue('noop') })
        expect(result.current.queue).toEqual([])
    })

    it('editInComposer removes item and returns it', () => {
        const { result } = renderHook(() => useMessageQueue('session-1', mockDeps))
        act(() => { result.current.enqueue('editable') })
        const id = result.current.queue[0].id
        let edited: ReturnType<typeof result.current.editInComposer>
        act(() => { edited = result.current.editInComposer(id) })
        expect(edited!).not.toBeNull()
        expect(edited!.text).toBe('editable')
        expect(result.current.queue).toHaveLength(0)
    })

    describe('flush', () => {
        it('merges and sends all queued messages', async () => {
            const deps = {
                ...mockDeps,
                sendMessage: vi.fn(async () => {}),
            }
            const { result } = renderHook(() => useMessageQueue('session-1', deps))
            act(() => {
                result.current.enqueue('first')
                result.current.enqueue('second')
            })
            await act(async () => { await result.current.flush() })
            expect(deps.sendMessage).toHaveBeenCalledWith('first\n\nsecond', undefined)
            expect(result.current.queue).toHaveLength(0)
        })

        it('restores queue on send failure', async () => {
            const deps = {
                ...mockDeps,
                sendMessage: vi.fn(async () => { throw new Error('send failed') }),
            }
            const { result } = renderHook(() => useMessageQueue('session-1', deps))
            act(() => {
                result.current.enqueue('ok-1')
                result.current.enqueue('fail-2')
            })
            await act(async () => { await result.current.flush() })
            expect(result.current.queue).toHaveLength(2)
        })

        it('prevents concurrent flush calls', async () => {
            let resolveFirst!: () => void
            const sendPromise = new Promise<void>((r) => { resolveFirst = r })
            const deps = {
                ...mockDeps,
                sendMessage: vi.fn(() => sendPromise),
            }
            const { result } = renderHook(() => useMessageQueue('session-1', deps))
            act(() => { result.current.enqueue('msg') })

            // Start first flush (will block on sendMessage)
            const p1 = act(async () => { await result.current.flush() })

            // Wait a tick so flush starts executing
            await act(async () => { await Promise.resolve() })

            // Second flush should be a no-op since first is in progress
            await act(async () => { await result.current.flush() })

            // sendMessage should only have been called once
            expect(deps.sendMessage).toHaveBeenCalledTimes(1)

            // Resolve the first flush
            resolveFirst()
            await p1
        })
    })
})
