import type { AgentState } from '@/types/api'
import type { ChatBlock, NormalizedMessage, UsageData } from '@/chat/types'
import { traceMessages, type TracedMessage } from '@/chat/tracer'
import { dedupeAgentEvents, foldApiErrorEvents } from '@/chat/reducerEvents'
import { collectTitleChanges, collectToolIdsFromMessages, ensureToolBlock, getPermissions } from '@/chat/reducerTools'
import { reduceTimeline } from '@/chat/reducerTimeline'

// Calculate context size from usage data
function calculateContextSize(usage: UsageData): number {
    return (usage.cache_creation_input_tokens || 0) + (usage.cache_read_input_tokens || 0) + usage.input_tokens
}

export type LatestUsage = {
    inputTokens: number
    outputTokens: number
    cacheCreation: number
    cacheRead: number
    contextSize: number
    timestamp: number
}

export function reduceChatBlocks(
    normalized: NormalizedMessage[],
    agentState: AgentState | null | undefined
): { blocks: ChatBlock[]; hasReadyEvent: boolean; latestUsage: LatestUsage | null } {
    const permissionsById = getPermissions(agentState)
    // Collect tool IDs from ALL messages (including sidechain) so that
    // sidechain tool IDs prevent duplicate permission-only cards from being
    // created at the root level.  Sidechain permissions are already rendered
    // inside their parent Agent/Task tool card via reduceTimeline recursion.
    const toolIdsInMessages = collectToolIdsFromMessages(normalized)
    const titleChangesByToolUseId = collectTitleChanges(normalized)

    const traced = traceMessages(normalized)
    const groups = new Map<string, TracedMessage[]>()
    const root: TracedMessage[] = []

    for (const msg of traced) {
        if (msg.sidechainId) {
            const existing = groups.get(msg.sidechainId) ?? []
            existing.push(msg)
            groups.set(msg.sidechainId, existing)
        } else {
            root.push(msg)
        }
    }

    const consumedGroupIds = new Set<string>()
    const emittedTitleChangeToolUseIds = new Set<string>()
    const reducerContext = { permissionsById, groups, consumedGroupIds, titleChangesByToolUseId, emittedTitleChangeToolUseIds }
    const rootResult = reduceTimeline(root, reducerContext)
    let hasReadyEvent = rootResult.hasReadyEvent

    // Only create permission-only tool cards for PENDING permissions that need
    // user interaction.  Completed permissions (approved/denied/canceled) whose
    // tool-call message is not in the current window would appear as orphan
    // "Approved" / error cards stuck at the bottom of the list.  Their state is
    // already merged into the tool block by reduceTimeline when the tool-call
    // message IS in the window, so standalone cards are unnecessary.
    let oldestMessageTime: number | null = null
    if (normalized.length > 0) {
        let min = normalized[0].createdAt
        for (let i = 1; i < normalized.length; i++) {
            if (normalized[i].createdAt < min) min = normalized[i].createdAt
        }
        oldestMessageTime = min
    }

    for (const [id, entry] of permissionsById) {
        if (toolIdsInMessages.has(id)) continue
        if (rootResult.toolBlocksById.has(id)) continue

        // Skip completed permissions — they will be rendered when their
        // corresponding tool-call message is loaded (via pagination or
        // because it is already in the window and handled by reduceTimeline).
        if (entry.permission.status !== 'pending') continue

        const createdAt = entry.permission.createdAt ?? Date.now()

        // Skip permissions that are older than the oldest message in the current view.
        // These will be shown when the user loads older messages.
        if (oldestMessageTime !== null && createdAt < oldestMessageTime) {
            continue
        }

        ensureToolBlock(rootResult.blocks, rootResult.toolBlocksById, id, {
            createdAt,
            localId: null,
            name: entry.toolName,
            input: entry.input,
            description: null,
            permission: entry.permission
        })
    }

    // Calculate latest usage from messages (find the most recent message with usage data)
    let latestUsage: LatestUsage | null = null
    for (let i = normalized.length - 1; i >= 0; i--) {
        const msg = normalized[i]
        if (msg.usage) {
            latestUsage = {
                inputTokens: msg.usage.input_tokens,
                outputTokens: msg.usage.output_tokens,
                cacheCreation: msg.usage.cache_creation_input_tokens ?? 0,
                cacheRead: msg.usage.cache_read_input_tokens ?? 0,
                contextSize: calculateContextSize(msg.usage),
                timestamp: msg.createdAt
            }
            break
        }
    }

    return { blocks: dedupeAgentEvents(foldApiErrorEvents(rootResult.blocks)), hasReadyEvent, latestUsage }
}
