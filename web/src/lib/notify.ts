/**
 * Lightweight imperative notification system (antd message style).
 * Module-level store — works anywhere, no React Context needed.
 *
 * Usage:
 *   import { notify } from '@/lib/notify'
 *   notify.success('Copied!')
 *   notify.error('Something went wrong')
 *   notify.info('Syncing...')
 */

export type NotifyVariant = 'success' | 'error' | 'info' | 'warning'

export type NotifyItem = {
    id: string
    variant: NotifyVariant
    message: string
    duration: number
    createdAt: number
}

type Listener = () => void

// ── Store ──────────────────────────────────────────────

let items: NotifyItem[] = []
const listeners = new Set<Listener>()
let idCounter = 0

function emit(): void {
    for (const fn of listeners) fn()
}

function add(variant: NotifyVariant, message: string, duration = 3000): string {
    const id = `notify-${++idCounter}-${Date.now()}`
    items = [...items, { id, variant, message, duration, createdAt: Date.now() }]
    emit()
    return id
}

function remove(id: string): void {
    const prev = items
    items = items.filter((n) => n.id !== id)
    if (items !== prev) emit()
}

// ── Public API ─────────────────────────────────────────

export const notify = {
    success: (message: string, duration?: number) => add('success', message, duration),
    error: (message: string, duration?: number) => add('error', message, duration ?? 5000),
    info: (message: string, duration?: number) => add('info', message, duration),
    warning: (message: string, duration?: number) => add('warning', message, duration ?? 4000),
    remove,
}

// ── React integration ──────────────────────────────────

export function getNotifyItems(): NotifyItem[] {
    return items
}

export function subscribeNotify(listener: Listener): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
}
