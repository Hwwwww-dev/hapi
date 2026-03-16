import type { ReactNode } from 'react'
import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import type { CanonicalRenderBlock, CanonicalToolArtifact } from '@/chat/canonical'
import type { ChatBlock, ToolCallBlock } from '@/chat/types'
import type { HappyChatContextValue } from '@/components/AssistantChat/context'
import { isObject, safeStringify } from '@hapi/protocol'
import { isCanonicalRenderBlock, isCanonicalToolArtifact } from '@/chat/canonical'
import { getEventPresentation } from '@/chat/presentation'
import { CodeBlock } from '@/components/CodeBlock'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { LazyRainbowText } from '@/components/LazyRainbowText'
import { MessageStatusIndicator } from '@/components/AssistantChat/messages/MessageStatusIndicator'
import { ToolCard } from '@/components/ToolCard/ToolCard'
import { useHappyChatContext } from '@/components/AssistantChat/context'
import { CliOutputBlock } from '@/components/CliOutputBlock'
import { FallbackRawCard } from '@/components/chat/FallbackRawCard'
import { SubagentCard } from '@/components/chat/SubagentCard'

function isLegacyToolCallBlock(value: unknown): value is ToolCallBlock {
    if (!isObject(value)) return false
    if (value.kind !== 'tool-call') return false
    if (typeof value.id !== 'string') return false
    if (value.localId !== null && typeof value.localId !== 'string') return false
    if (typeof value.createdAt !== 'number') return false
    if (!Array.isArray(value.children)) return false
    if (!isObject(value.tool)) return false
    if (typeof value.tool.name !== 'string') return false
    if (!('input' in value.tool)) return false
    if (value.tool.description !== null && typeof value.tool.description !== 'string') return false
    if (value.tool.state !== 'pending' && value.tool.state !== 'running' && value.tool.state !== 'completed' && value.tool.state !== 'error') return false
    return true
}

function isPendingPermissionBlock(block: ChatBlock): boolean {
    return block.kind === 'tool-call' && block.tool.permission?.status === 'pending'
}

function splitTaskChildren(block: ToolCallBlock): { pending: ChatBlock[]; rest: ChatBlock[] } {
    const pending: ChatBlock[] = []
    const rest: ChatBlock[] = []

    for (const child of block.children) {
        if (isPendingPermissionBlock(child)) {
            pending.push(child)
        } else {
            rest.push(child)
        }
    }

    return { pending, rest }
}

type NestedBlock = ChatBlock | CanonicalRenderBlock

function renderLegacyToolChildren(block: ToolCallBlock): ReactNode {
    if (block.children.length === 0) return null

    const isTask = block.tool.name === 'Task'
    const taskChildren = isTask ? splitTaskChildren(block) : null

    if (!isTask) {
        return (
            <div className="mt-2 pl-3">
                <HappyNestedBlockList blocks={block.children} />
            </div>
        )
    }

    return (
        <>
            {taskChildren && taskChildren.pending.length > 0 ? (
                <div className="mt-2 pl-3">
                    <HappyNestedBlockList blocks={taskChildren.pending} />
                </div>
            ) : null}
            {taskChildren && taskChildren.rest.length > 0 ? (
                <details className="mt-2">
                    <summary className="cursor-pointer text-xs text-[var(--app-hint)]">
                        Task details ({taskChildren.rest.length})
                    </summary>
                    <div className="mt-2 pl-3">
                        <HappyNestedBlockList blocks={taskChildren.rest} />
                    </div>
                </details>
            ) : null}
        </>
    )
}

function toLegacyToolCardBlock(block: Extract<CanonicalToolArtifact, { kind: 'tool-call' | 'tool-result' }>): ToolCallBlock {
    return {
        kind: 'tool-call',
        id: block.id,
        localId: null,
        createdAt: block.createdAt,
        tool: block.tool,
        children: [],
        meta: {
            canonicalKind: block.kind,
            sourceRawEventIds: block.sourceRawEventIds
        }
    }
}

function renderCanonicalArtifact(block: CanonicalToolArtifact, ctx: HappyChatContextValue): ReactNode {
    if (block.kind === 'tool-call' || block.kind === 'tool-result') {
        return (
            <div className="py-1 min-w-0 max-w-full overflow-x-hidden">
                <ToolCard
                    api={ctx.api}
                    sessionId={ctx.sessionId}
                    metadata={ctx.metadata}
                    disabled={ctx.disabled}
                    onDone={ctx.onRefresh}
                    block={toLegacyToolCardBlock(block)}
                />
                {block.children.length > 0 ? (
                    <div className="mt-2 pl-3">
                        <HappyNestedBlockList blocks={block.children} />
                    </div>
                ) : null}
            </div>
        )
    }

    if (block.kind === 'subagent-root') {
        return (
            <div className="py-1 min-w-0 max-w-full overflow-x-hidden">
                <SubagentCard block={block}>
                    <HappyNestedBlockList blocks={block.children} />
                </SubagentCard>
            </div>
        )
    }

    return (
        <div className="py-1 min-w-0 max-w-full overflow-x-hidden">
            <FallbackRawCard block={block} />
            {block.children.length > 0 ? (
                <div className="mt-2 pl-3">
                    <HappyNestedBlockList blocks={block.children} />
                </div>
            ) : null}
        </div>
    )
}

function renderCanonicalNestedBlock(block: CanonicalRenderBlock, ctx: HappyChatContextValue): ReactNode {
    if (block.kind === 'user-text') {
        return (
            <div key={`canonical-user:${block.id}`} className="w-fit max-w-[92%] ml-auto rounded-xl bg-[var(--app-secondary-bg)] px-3 py-2 text-[var(--app-fg)] shadow-sm">
                <LazyRainbowText text={block.text} />
            </div>
        )
    }

    if (block.kind === 'agent-text') {
        return (
            <div key={`canonical-agent:${block.id}`} className="px-1">
                <MarkdownRenderer content={block.text} />
            </div>
        )
    }

    if (block.kind === 'reasoning') {
        return (
            <div key={`canonical-reasoning:${block.id}`} className="px-1 text-sm text-[var(--app-hint)]">
                <MarkdownRenderer content={block.text} />
            </div>
        )
    }

    if (block.kind === 'event') {
        return (
            <div key={`canonical-event:${block.id}`} className="py-1">
                <div className="mx-auto w-fit max-w-[92%] px-2 text-center text-xs text-[var(--app-hint)] opacity-80">
                    <span>{block.text}</span>
                </div>
            </div>
        )
    }

    return <div key={`canonical-artifact:${block.id}`}>{renderCanonicalArtifact(block, ctx)}</div>
}

function renderLegacyNestedBlock(block: ChatBlock, ctx: HappyChatContextValue): ReactNode {
    if (block.kind === 'user-text') {
        const userBubbleClass = 'w-fit max-w-[92%] ml-auto rounded-xl bg-[var(--app-secondary-bg)] px-3 py-2 text-[var(--app-fg)] shadow-sm'
        const status = block.status
        const canRetry = status === 'failed' && typeof block.localId === 'string' && Boolean(ctx.onRetryMessage)
        const onRetry = canRetry ? () => ctx.onRetryMessage!(block.localId!) : undefined

        return (
            <div key={`user:${block.id}`} className={userBubbleClass}>
                <div className="flex items-end gap-2">
                    <div className="flex-1">
                        <LazyRainbowText text={block.text} />
                    </div>
                    {status ? (
                        <div className="shrink-0 self-end pb-0.5">
                            <MessageStatusIndicator status={status} onRetry={onRetry} />
                        </div>
                    ) : null}
                </div>
            </div>
        )
    }

    if (block.kind === 'agent-text') {
        return (
            <div key={`agent:${block.id}`} className="px-1">
                <MarkdownRenderer content={block.text} />
            </div>
        )
    }

    if (block.kind === 'cli-output') {
        const alignClass = block.source === 'user' ? 'ml-auto w-full max-w-[92%]' : ''
        return (
            <div key={`cli:${block.id}`} className="px-1 min-w-0 max-w-full overflow-x-hidden">
                <div className={alignClass}>
                    <CliOutputBlock text={block.text} />
                </div>
            </div>
        )
    }

    if (block.kind === 'agent-event') {
        const presentation = getEventPresentation(block.event)
        return (
            <div key={`event:${block.id}`} className="py-1">
                <div className="mx-auto w-fit max-w-[92%] px-2 text-center text-xs text-[var(--app-hint)] opacity-80">
                    <span className="inline-flex items-center gap-1">
                        {presentation.icon ? <span aria-hidden="true">{presentation.icon}</span> : null}
                        <span>{presentation.text}</span>
                    </span>
                </div>
            </div>
        )
    }

    if (block.kind === 'agent-reasoning') {
        return (
            <div key={`reasoning:${block.id}`} className="px-1 text-sm text-[var(--app-hint)]">
                <MarkdownRenderer content={block.text} />
            </div>
        )
    }

    return (
        <div key={`tool:${block.id}`} className="py-1">
            <ToolCard
                api={ctx.api}
                sessionId={ctx.sessionId}
                metadata={ctx.metadata}
                disabled={ctx.disabled}
                onDone={ctx.onRefresh}
                block={block}
            />
            {renderLegacyToolChildren(block)}
        </div>
    )
}

function HappyNestedBlockList(props: {
    blocks: NestedBlock[]
}) {
    const ctx = useHappyChatContext()

    return (
        <div className="flex flex-col gap-3">
            {props.blocks.map((block) => (
                isCanonicalRenderBlock(block)
                    ? renderCanonicalNestedBlock(block, ctx)
                    : renderLegacyNestedBlock(block, ctx)
            ))}
        </div>
    )
}

export function HappyToolMessage(props: ToolCallMessagePartProps) {
    const ctx = useHappyChatContext()
    const artifact = props.artifact

    if (isCanonicalToolArtifact(artifact)) {
        return renderCanonicalArtifact(artifact, ctx)
    }

    if (!isLegacyToolCallBlock(artifact)) {
        const argsText = typeof props.argsText === 'string' ? props.argsText.trim() : ''
        const hasArgsText = argsText.length > 0
        const hasResult = props.result !== undefined
        const resultText = hasResult ? safeStringify(props.result) : ''

        return (
            <div className="py-1 min-w-0 max-w-full overflow-x-hidden">
                <div className="rounded-xl bg-[var(--app-secondary-bg)] p-3 shadow-sm">
                    <div className="flex items-center gap-2 text-xs">
                        <div className="font-mono text-[var(--app-hint)]">
                            Tool: {props.toolName}
                        </div>
                        {props.isError ? (
                            <span className="text-red-500">Error</span>
                        ) : null}
                        {props.status.type === 'running' && !hasResult ? (
                            <span className="text-[var(--app-hint)]">Running…</span>
                        ) : null}
                    </div>

                    {hasArgsText ? (
                        <div className="mt-2">
                            <CodeBlock code={argsText} language="json" />
                        </div>
                    ) : null}

                    {hasResult ? (
                        <div className="mt-2">
                            <CodeBlock code={resultText} language={typeof props.result === 'string' ? 'text' : 'json'} />
                        </div>
                    ) : null}
                </div>
            </div>
        )
    }

    return (
        <div className="py-1 min-w-0 max-w-full overflow-x-hidden">
            <ToolCard
                api={ctx.api}
                sessionId={ctx.sessionId}
                metadata={ctx.metadata}
                disabled={ctx.disabled}
                onDone={ctx.onRefresh}
                block={artifact}
            />
            {renderLegacyToolChildren(artifact)}
        </div>
    )
}
