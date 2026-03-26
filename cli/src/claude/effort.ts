import type { SessionEffort } from '@/api/types'

const KNOWN_EFFORTS = ['low', 'medium', 'high', 'max'] as const

export function normalizeClaudeSessionEffort(effort?: string | null): SessionEffort {
    const trimmedEffort = effort?.trim().toLowerCase()
    if (!trimmedEffort || trimmedEffort === 'auto' || trimmedEffort === 'default') {
        return null
    }

    if (!KNOWN_EFFORTS.includes(trimmedEffort as typeof KNOWN_EFFORTS[number])) {
        return null
    }

    return trimmedEffort
}
