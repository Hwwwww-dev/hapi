import { z } from 'zod'

export const RawEventProviderSchema = z.enum(['claude', 'codex', 'gemini', 'cursor', 'opencode'])
export type RawEventProvider = z.infer<typeof RawEventProviderSchema>

export const RawEventSourceSchema = z.enum(['native', 'runtime'])
export type RawEventSource = z.infer<typeof RawEventSourceSchema>

export const RawEventEnvelopeSchema = z.object({
    id: z.string().min(1),
    sessionId: z.string().min(1),
    provider: RawEventProviderSchema,
    source: RawEventSourceSchema,
    sourceSessionId: z.string().min(1),
    sourceKey: z.string().min(1),
    observationKey: z.string().min(1).nullable().optional(),
    channel: z.string().min(1),
    sourceOrder: z.number().int().nonnegative(),
    occurredAt: z.number().finite().nonnegative(),
    ingestedAt: z.number().finite().nonnegative(),
    rawType: z.string().min(1),
    payload: z.unknown(),
    ingestSchemaVersion: z.number().int().positive()
})

export type RawEventEnvelope = z.infer<typeof RawEventEnvelopeSchema>

export const CanonicalBlockKindSchema = z.enum([
    'user-text',
    'agent-text',
    'reasoning',
    'tool-call',
    'tool-result',
    'event',
    'subagent-root',
    'fallback-raw'
])

export type CanonicalBlockKind = z.infer<typeof CanonicalBlockKindSchema>

export const CanonicalClosedEventSubtypeSchema = z.enum([
    'title-changed',
    'compact',
    'microcompact',
    'turn-duration',
    'api-error',
    'token-count',
    'plan-updated'
])

export type CanonicalClosedEventSubtype = z.infer<typeof CanonicalClosedEventSubtypeSchema>

const CanonicalPayloadSchema = z.object({}).catchall(z.unknown())

const CanonicalBlockCommonSchema = z.object({
    id: z.string().min(1),
    sessionId: z.string().min(1),
    timelineSeq: z.number().int().positive(),
    siblingSeq: z.number().int().nonnegative(),
    rootBlockId: z.string().min(1),
    kind: CanonicalBlockKindSchema,
    createdAt: z.number().finite().nonnegative(),
    updatedAt: z.number().finite().nonnegative(),
    state: z.string().min(1),
    payload: CanonicalPayloadSchema,
    sourceRawEventIds: z.array(z.string().min(1)).min(1),
    parserVersion: z.number().int().positive(),
    generation: z.number().int().positive()
})

type CanonicalBlockCommon = z.infer<typeof CanonicalBlockCommonSchema>

export interface CanonicalChildBlock extends CanonicalBlockCommon {
    parentBlockId: string
    depth: number
    children: CanonicalChildBlock[]
}

export interface CanonicalRootBlock extends CanonicalBlockCommon {
    parentBlockId: null
    depth: 0
    children: CanonicalChildBlock[]
}

export type CanonicalBlock = CanonicalRootBlock | CanonicalChildBlock

function validateEventPayload(
    block: { kind: CanonicalBlockKind; payload: Record<string, unknown> },
    ctx: z.RefinementCtx
): void {
    if (block.kind !== 'event') {
        return
    }

    const subtype = block.payload.subtype
    if (!CanonicalClosedEventSubtypeSchema.safeParse(subtype).success) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['payload', 'subtype'],
            message: 'event payload subtype must be one of the closed v1 event subtypes'
        })
    }
}

function validateChildTree(
    children: CanonicalChildBlock[],
    parentId: string,
    rootId: string,
    parentDepth: number,
    ctx: z.RefinementCtx,
    path: Array<string | number>
): void {
    for (const [index, child] of children.entries()) {
        if (child.parentBlockId !== parentId) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: [...path, index, 'parentBlockId'],
                message: 'child parentBlockId must match its parent block id'
            })
        }

        if (child.rootBlockId !== rootId) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: [...path, index, 'rootBlockId'],
                message: 'child rootBlockId must match the root block id'
            })
        }

        if (child.depth !== parentDepth + 1) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: [...path, index, 'depth'],
                message: 'child depth must be exactly one level deeper than its parent'
            })
        }

        validateChildTree(child.children, child.id, rootId, child.depth, ctx, [...path, index, 'children'])
    }
}

export const CanonicalChildBlockSchema: z.ZodType<CanonicalChildBlock> = CanonicalBlockCommonSchema.extend({
    parentBlockId: z.string().min(1),
    depth: z.number().int().positive(),
    children: z.array(z.lazy(() => CanonicalChildBlockSchema))
}).superRefine((block, ctx) => {
    validateEventPayload(block, ctx)
})

export const CanonicalRootBlockSchema: z.ZodType<CanonicalRootBlock> = CanonicalBlockCommonSchema.extend({
    parentBlockId: z.null(),
    depth: z.literal(0),
    children: z.array(z.lazy(() => CanonicalChildBlockSchema))
}).superRefine((block, ctx) => {
    validateEventPayload(block, ctx)

    if (block.rootBlockId !== block.id) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['rootBlockId'],
            message: 'root block rootBlockId must equal its id'
        })
    }

    validateChildTree(block.children, block.id, block.id, block.depth, ctx, ['children'])
})

export const CanonicalBlockSchema: z.ZodType<CanonicalBlock> = z.union([
    CanonicalRootBlockSchema,
    CanonicalChildBlockSchema
])

export const CanonicalMessagesPageInfoSchema = z.object({
    generation: z.number().int().positive(),
    parserVersion: z.number().int().positive(),
    latestStreamSeq: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    beforeTimelineSeq: z.number().int().positive().nullable(),
    nextBeforeTimelineSeq: z.number().int().positive().nullable(),
    hasMore: z.boolean()
})

export type CanonicalMessagesPageInfo = z.infer<typeof CanonicalMessagesPageInfoSchema>

export const CanonicalMessagesPageSchema = z.object({
    items: z.array(CanonicalRootBlockSchema),
    page: CanonicalMessagesPageInfoSchema
})

export type CanonicalMessagesPage = z.infer<typeof CanonicalMessagesPageSchema>

const CanonicalSyncEventBaseSchema = z.object({
    namespace: z.string().optional(),
    sessionId: z.string().min(1),
    generation: z.number().int().positive(),
    parserVersion: z.number().int().positive(),
    streamSeq: z.number().int().nonnegative()
})

export const CanonicalRealtimeOpSchema = z.enum(['append', 'replace'])
export type CanonicalRealtimeOp = z.infer<typeof CanonicalRealtimeOpSchema>

export const CanonicalRootUpsertEventSchema = CanonicalSyncEventBaseSchema.extend({
    type: z.literal('canonical-root-upsert'),
    op: CanonicalRealtimeOpSchema,
    root: CanonicalRootBlockSchema
})

export type CanonicalRootUpsertEvent = z.infer<typeof CanonicalRootUpsertEventSchema>

export const CanonicalResetReasonSchema = z.enum([
    'rebuild',
    'parser-version-change',
    'late-earlier-event'
])

export type CanonicalResetReason = z.infer<typeof CanonicalResetReasonSchema>

export const CanonicalResetEventSchema = CanonicalSyncEventBaseSchema.extend({
    type: z.literal('canonical-reset'),
    reason: CanonicalResetReasonSchema
})

export type CanonicalResetEvent = z.infer<typeof CanonicalResetEventSchema>

export const CanonicalSyncEventSchema = z.discriminatedUnion('type', [
    CanonicalRootUpsertEventSchema,
    CanonicalResetEventSchema
])

export type CanonicalSyncEvent = z.infer<typeof CanonicalSyncEventSchema>
