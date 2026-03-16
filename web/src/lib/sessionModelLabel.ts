import { getModelModeLabel } from '@hapi/protocol'
import type { Session, SessionSummary } from '@/types/api'

type SessionModelSource = Pick<Session, 'model' | 'modelMode'> | Pick<SessionSummary, 'model' | 'modelMode'>

export type SessionModelLabel = {
    key: 'session.item.model' | 'session.item.modelMode'
    value: string
}

export function getSessionModelLabel(session: SessionModelSource): SessionModelLabel | null {
    const explicitModel = typeof session.model === 'string' ? session.model.trim() : ''
    if (explicitModel) {
        return {
            key: 'session.item.model',
            value: explicitModel
        }
    }

    if (session.modelMode) {
        return {
            key: 'session.item.modelMode',
            value: getModelModeLabel(session.modelMode)
        }
    }

    return null
}
