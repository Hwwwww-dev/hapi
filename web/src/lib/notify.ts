/**
 * Lightweight imperative notification system powered by Arco Design Message.
 * Drop-in replacement — same API surface, zero custom rendering.
 *
 * Usage:
 *   import { notify } from '@/lib/notify'
 *   notify.success('Copied!')
 *   notify.error('Something went wrong')
 *   notify.info('Syncing...')
 */

import { Message } from '@arco-design/web-react'

export type NotifyVariant = 'success' | 'error' | 'info' | 'warning'

function show(method: keyof typeof Message, message: string, duration: number) {
    const fn = Message[method] as (config: { content: string; duration: number }) => void
    fn({ content: message, duration })
}

export const notify = {
    success: (message: string, duration?: number) => show('success', message, duration ?? 3000),
    error: (message: string, duration?: number) => show('error', message, duration ?? 5000),
    info: (message: string, duration?: number) => show('info', message, duration ?? 3000),
    warning: (message: string, duration?: number) => show('warning', message, duration ?? 4000),
}
