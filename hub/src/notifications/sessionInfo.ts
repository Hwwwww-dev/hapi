import type { Session } from '../sync/syncEngine'
import { getSessionDisplayTitle } from '@hapi/protocol'

export function getSessionName(session: Session): string {
    return getSessionDisplayTitle(session)
}

export function getAgentName(session: Session): string {
    const flavor = session.metadata?.flavor
    if (flavor === 'claude') return 'Claude'
    if (flavor === 'codex') return 'Codex'
    if (flavor === 'cursor') return 'Cursor'
    if (flavor === 'gemini') return 'Gemini'
    if (flavor === 'opencode') return 'OpenCode'
    return 'Agent'
}
