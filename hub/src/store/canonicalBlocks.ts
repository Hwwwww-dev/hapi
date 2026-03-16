import type { Database } from 'bun:sqlite'
import type { CanonicalChildBlock, CanonicalRootBlock } from '@hapi/protocol'

import { safeJsonParse } from './json'
import type { StoredCanonicalBlock, StoredCanonicalRootsPage } from './types'

export type GetCanonicalRootsPageOptions = {
    generation: number
    beforeTimelineSeq: number | null
    limit: number
}

type DbCanonicalBlockRow = {
    id: string
    session_id: string
    generation: number
    timeline_seq: number
    sibling_seq: number
    parent_block_id: string | null
    root_block_id: string
    depth: number
    kind: StoredCanonicalBlock['kind']
    created_at: number
    updated_at: number
    state: string
    payload: string
    source_raw_event_ids: string
    parser_version: number
}

type CanonicalTreeNode = CanonicalRootBlock | CanonicalChildBlock

function serializeJson(value: unknown, fieldName: string): string {
    const json = JSON.stringify(value)
    if (json === undefined) {
        throw new Error(`${fieldName} must be JSON-serializable before storage`)
    }
    return json
}

function parseJsonOrThrow(value: string, fieldName: string): unknown {
    const parsed = safeJsonParse(value)
    if (parsed === null && value.trim() !== 'null') {
        throw new Error(`Invalid JSON in canonical_blocks.${fieldName}`)
    }
    return parsed
}

function parsePayloadJson(value: string): Record<string, unknown> {
    const parsed = parseJsonOrThrow(value, 'payload')
    if (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object') {
        throw new Error('canonical_blocks.payload must decode to an object')
    }
    return parsed as Record<string, unknown>
}

function parseSourceRawEventIdsJson(value: string): string[] {
    const parsed = parseJsonOrThrow(value, 'source_raw_event_ids')
    if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== 'string')) {
        throw new Error('canonical_blocks.source_raw_event_ids must decode to a string[]')
    }
    return [...parsed]
}

function toStoredCanonicalBlock(row: DbCanonicalBlockRow): StoredCanonicalBlock {
    return {
        id: row.id,
        sessionId: row.session_id,
        generation: row.generation,
        timelineSeq: row.timeline_seq,
        siblingSeq: row.sibling_seq,
        parentBlockId: row.parent_block_id,
        rootBlockId: row.root_block_id,
        depth: row.depth,
        kind: row.kind,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        state: row.state,
        payload: parsePayloadJson(row.payload),
        sourceRawEventIds: parseSourceRawEventIdsJson(row.source_raw_event_ids),
        parserVersion: row.parser_version
    }
}

function compareStoredCanonicalBlocks(left: StoredCanonicalBlock, right: StoredCanonicalBlock): number {
    return left.timelineSeq - right.timelineSeq
        || left.depth - right.depth
        || left.siblingSeq - right.siblingSeq
        || left.id.localeCompare(right.id)
}

function createCanonicalNode(row: StoredCanonicalBlock): CanonicalTreeNode {
    const common = {
        id: row.id,
        sessionId: row.sessionId,
        timelineSeq: row.timelineSeq,
        siblingSeq: row.siblingSeq,
        rootBlockId: row.rootBlockId,
        kind: row.kind,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        state: row.state,
        payload: { ...row.payload },
        sourceRawEventIds: [...row.sourceRawEventIds],
        parserVersion: row.parserVersion,
        generation: row.generation,
        children: [] as CanonicalChildBlock[]
    }

    if (row.parentBlockId === null) {
        if (row.depth !== 0) {
            throw new Error(`Canonical root ${row.id} must have depth 0`)
        }

        return {
            ...common,
            parentBlockId: null,
            depth: 0
        }
    }

    if (row.depth <= 0) {
        throw new Error(`Canonical child ${row.id} must have depth > 0`)
    }

    return {
        ...common,
        parentBlockId: row.parentBlockId,
        depth: row.depth
    }
}

function buildCanonicalRoots(rows: StoredCanonicalBlock[]): CanonicalRootBlock[] {
    const orderedRows = [...rows].sort(compareStoredCanonicalBlocks)
    const nodeById = new Map<string, CanonicalTreeNode>()
    const roots: CanonicalRootBlock[] = []

    for (const row of orderedRows) {
        const node = createCanonicalNode(row)
        nodeById.set(node.id, node)

        if (node.parentBlockId === null) {
            roots.push(node)
            continue
        }

        const parent = nodeById.get(node.parentBlockId)
        if (!parent) {
            throw new Error(`Canonical block ${node.id} is missing parent ${node.parentBlockId}`)
        }

        parent.children.push(node)
    }

    return roots
}

function toStoredCanonicalBlockFromRoot(sessionId: string, generation: number, root: CanonicalRootBlock): StoredCanonicalBlock {
    if (root.sessionId !== sessionId) {
        throw new Error(`Canonical root ${root.id} belongs to session ${root.sessionId}, expected ${sessionId}`)
    }
    if (root.generation !== generation) {
        throw new Error(`Canonical root ${root.id} belongs to generation ${root.generation}, expected ${generation}`)
    }
    if (root.parentBlockId !== null) {
        throw new Error(`Canonical root ${root.id} must have parentBlockId null`)
    }

    return {
        id: root.id,
        sessionId: root.sessionId,
        generation: root.generation,
        timelineSeq: root.timelineSeq,
        siblingSeq: root.siblingSeq,
        parentBlockId: null,
        rootBlockId: root.rootBlockId,
        depth: root.depth,
        kind: root.kind,
        createdAt: root.createdAt,
        updatedAt: root.updatedAt,
        state: root.state,
        payload: { ...root.payload },
        sourceRawEventIds: [...root.sourceRawEventIds],
        parserVersion: root.parserVersion
    }
}

function toStoredCanonicalBlockFromChild(
    sessionId: string,
    generation: number,
    child: CanonicalChildBlock
): StoredCanonicalBlock {
    if (child.sessionId !== sessionId) {
        throw new Error(`Canonical child ${child.id} belongs to session ${child.sessionId}, expected ${sessionId}`)
    }
    if (child.generation !== generation) {
        throw new Error(`Canonical child ${child.id} belongs to generation ${child.generation}, expected ${generation}`)
    }
    if (child.parentBlockId === null) {
        throw new Error(`Canonical child ${child.id} must reference a parent block id`)
    }

    return {
        id: child.id,
        sessionId: child.sessionId,
        generation: child.generation,
        timelineSeq: child.timelineSeq,
        siblingSeq: child.siblingSeq,
        parentBlockId: child.parentBlockId,
        rootBlockId: child.rootBlockId,
        depth: child.depth,
        kind: child.kind,
        createdAt: child.createdAt,
        updatedAt: child.updatedAt,
        state: child.state,
        payload: { ...child.payload },
        sourceRawEventIds: [...child.sourceRawEventIds],
        parserVersion: child.parserVersion
    }
}

function flattenCanonicalChild(
    sessionId: string,
    generation: number,
    child: CanonicalChildBlock
): StoredCanonicalBlock[] {
    return [
        toStoredCanonicalBlockFromChild(sessionId, generation, child),
        ...child.children.flatMap((nestedChild) => flattenCanonicalChild(sessionId, generation, nestedChild))
    ]
}

function flattenCanonicalRoot(
    sessionId: string,
    generation: number,
    root: CanonicalRootBlock
): StoredCanonicalBlock[] {
    return [
        toStoredCanonicalBlockFromRoot(sessionId, generation, root),
        ...root.children.flatMap((child) => flattenCanonicalChild(sessionId, generation, child))
    ]
}

function listCanonicalBlocksByGeneration(db: Database, sessionId: string, generation: number): StoredCanonicalBlock[] {
    const rows = db.prepare(`
        SELECT * FROM canonical_blocks
        WHERE session_id = ?
          AND generation = ?
        ORDER BY timeline_seq ASC, depth ASC, sibling_seq ASC, id ASC
    `).all(sessionId, generation) as DbCanonicalBlockRow[]

    return rows.map(toStoredCanonicalBlock)
}

export function replaceCanonicalGeneration(
    db: Database,
    sessionId: string,
    generation: number,
    roots: CanonicalRootBlock[]
): void {
    const rows = roots.flatMap((root) => flattenCanonicalRoot(sessionId, generation, root))

    try {
        db.exec('BEGIN')
        db.prepare(
            'DELETE FROM canonical_blocks WHERE session_id = ? AND generation = ?'
        ).run(sessionId, generation)

        const insertStatement = db.prepare(`
            INSERT INTO canonical_blocks (
                id,
                session_id,
                generation,
                timeline_seq,
                sibling_seq,
                parent_block_id,
                root_block_id,
                depth,
                kind,
                created_at,
                updated_at,
                state,
                payload,
                source_raw_event_ids,
                parser_version
            ) VALUES (
                @id,
                @session_id,
                @generation,
                @timeline_seq,
                @sibling_seq,
                @parent_block_id,
                @root_block_id,
                @depth,
                @kind,
                @created_at,
                @updated_at,
                @state,
                @payload,
                @source_raw_event_ids,
                @parser_version
            )
        `)

        for (const row of rows) {
            insertStatement.run({
                id: row.id,
                session_id: row.sessionId,
                generation: row.generation,
                timeline_seq: row.timelineSeq,
                sibling_seq: row.siblingSeq,
                parent_block_id: row.parentBlockId,
                root_block_id: row.rootBlockId,
                depth: row.depth,
                kind: row.kind,
                created_at: row.createdAt,
                updated_at: row.updatedAt,
                state: row.state,
                payload: serializeJson(row.payload, 'canonical block payload'),
                source_raw_event_ids: serializeJson(row.sourceRawEventIds, 'canonical block sourceRawEventIds'),
                parser_version: row.parserVersion
            })
        }

        db.exec('COMMIT')
    } catch (error) {
        db.exec('ROLLBACK')
        throw error
    }
}

export function getCanonicalRootsPage(
    db: Database,
    sessionId: string,
    options: GetCanonicalRootsPageOptions
): StoredCanonicalRootsPage {
    const generation = Math.trunc(options.generation)
    const limit = Number.isFinite(options.limit)
        ? Math.max(1, Math.trunc(options.limit))
        : 50
    const beforeTimelineSeq = options.beforeTimelineSeq === null
        ? null
        : Math.trunc(options.beforeTimelineSeq)

    const roots = buildCanonicalRoots(listCanonicalBlocksByGeneration(db, sessionId, generation))
    const startIndex = beforeTimelineSeq === null
        ? 0
        : roots.findIndex((root) => root.timelineSeq >= beforeTimelineSeq)
    const normalizedStartIndex = startIndex === -1 ? roots.length : startIndex
    const items = roots.slice(normalizedStartIndex, normalizedStartIndex + limit)
    const hasMore = normalizedStartIndex + limit < roots.length
    const nextBeforeTimelineSeq = hasMore
        ? (roots[normalizedStartIndex + limit]?.timelineSeq ?? null)
        : null

    return {
        items,
        page: {
            generation,
            limit,
            beforeTimelineSeq,
            nextBeforeTimelineSeq,
            hasMore
        }
    }
}
