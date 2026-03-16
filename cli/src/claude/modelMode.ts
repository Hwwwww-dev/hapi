import type { SessionModelMode } from '@/api/types'

const CLAUDE_SESSION_MODEL_MODES = new Set<SessionModelMode>([
    'sonnet',
    'sonnet[1m]',
    'opus',
    'opus[1m]'
])

export function resolveClaudeSessionModelMode(model?: string): SessionModelMode {
    const trimmedModel = model?.trim()
    if (!trimmedModel) {
        return 'default'
    }

    return CLAUDE_SESSION_MODEL_MODES.has(trimmedModel as SessionModelMode)
        ? trimmedModel as SessionModelMode
        : 'default'
}

export function resolveClaudePersistedModel(model?: string): string | undefined {
    const trimmedModel = model?.trim()
    if (!trimmedModel || trimmedModel === 'auto' || trimmedModel === 'default') {
        return undefined
    }

    return resolveClaudeSessionModelMode(trimmedModel) === 'default'
        ? trimmedModel
        : undefined
}
