import type {
    CanonicalResetEvent,
    CanonicalRootBlock,
    CanonicalRootUpsertEvent,
} from '@/types/api'

export type CanonicalRealtimeSnapshot = {
    generation: number | null
    latestStreamSeq: number
    roots: CanonicalRootBlock[]
}

export type CanonicalRealtimeApplyResult = {
    changed: boolean
    needsRefresh: boolean
    generation: number | null
    latestStreamSeq: number
    roots: CanonicalRootBlock[]
}

function sortRoots(roots: readonly CanonicalRootBlock[]): CanonicalRootBlock[] {
    return [...roots].sort((left, right) => {
        if (left.timelineSeq !== right.timelineSeq) {
            return left.timelineSeq - right.timelineSeq
        }
        if (left.createdAt !== right.createdAt) {
            return left.createdAt - right.createdAt
        }
        return left.id.localeCompare(right.id)
    })
}

function upsertRoot(roots: readonly CanonicalRootBlock[], root: CanonicalRootBlock): CanonicalRootBlock[] {
    const next = roots.filter((item) => item.id !== root.id)
    next.push(root)
    return sortRoots(next)
}

export function applyCanonicalRootUpsert(
    snapshot: CanonicalRealtimeSnapshot,
    event: CanonicalRootUpsertEvent
): CanonicalRealtimeApplyResult {
    if (snapshot.generation === null) {
        return {
            changed: false,
            needsRefresh: true,
            generation: event.generation,
            latestStreamSeq: Math.max(snapshot.latestStreamSeq, event.streamSeq),
            roots: snapshot.roots,
        }
    }

    if (event.streamSeq <= snapshot.latestStreamSeq) {
        return {
            changed: false,
            needsRefresh: false,
            generation: snapshot.generation,
            latestStreamSeq: snapshot.latestStreamSeq,
            roots: snapshot.roots,
        }
    }

    if (event.generation !== snapshot.generation) {
        return {
            changed: false,
            needsRefresh: true,
            generation: event.generation,
            latestStreamSeq: event.streamSeq,
            roots: [],
        }
    }

    return {
        changed: true,
        needsRefresh: false,
        generation: snapshot.generation,
        latestStreamSeq: event.streamSeq,
        roots: upsertRoot(snapshot.roots, event.root),
    }
}

export function applyCanonicalReset(
    snapshot: CanonicalRealtimeSnapshot,
    event: CanonicalResetEvent
): CanonicalRealtimeApplyResult {
    if (snapshot.generation === event.generation && event.streamSeq <= snapshot.latestStreamSeq) {
        return {
            changed: false,
            needsRefresh: false,
            generation: snapshot.generation,
            latestStreamSeq: snapshot.latestStreamSeq,
            roots: snapshot.roots,
        }
    }

    return {
        changed: false,
        needsRefresh: true,
        generation: event.generation,
        latestStreamSeq: event.streamSeq,
        roots: [],
    }
}
