import { useState } from 'react'
import type { ToolCallMessagePartProps } from '@assistant-ui/react'
import type { ChatBlock } from '@/chat/types'
import type { ToolCallBlock } from '@/chat/types'
import { isObject, safeStringify } from '@hapi/protocol'
import { getEventPresentation } from '@/chat/presentation'
import { CodeBlock } from '@/components/CodeBlock'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { LazyRainbowText } from '@/components/LazyRainbowText'
import { MessageStatusIndicator } from '@/components/AssistantChat/messages/MessageStatusIndicator'
import { ToolCard } from '@/components/ToolCard/ToolCard'
import { useHappyChatContext } from '@/components/AssistantChat/context'
import { CliOutputBlock } from '@/components/CliOutputBlock'

function isToolCallBlock(value: unknown): value is ToolCallBlock {
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

function TaskChildrenOutside(props: {
    taskChildren: { pending: ChatBlock[]; rest: ChatBlock[] } | null
    allChildren: ChatBlock[]
    isRunning: boolean
}) {
    const [expanded, setExpanded] = useState(false)
    const { taskChildren, allChildren, isRunning } = props

    // pending permissions always show
    const pendingBlocks = taskChildren?.pending ?? []
    const restBlocks = taskChildren?.rest ?? []

    // When running, show the latest child as a live preview
    const latestChild = allChildren.length > 0 ? allChildren[allChildren.length - 1] : null

    if (pendingBlocks.length === 0 && restBlocks.length === 0) return null

    return (
        <div className="mt-2 pl-3 border-l-2 border-[var(--app-divider)]">
            {pendingBlocks.length > 0 ? (
                <div className="mb-1">
                    <HappyNestedBlockList blocks={pendingBlocks} />
                </div>
            ) : null}
            {restBlocks.length > 0 ? (
                expanded ? (
                    <>
                        <HappyNestedBlockList blocks={restBlocks} />
                        <button
                            type="button"
                            className="mt-1 text-xs text-[var(--app-hint)] hover:text-[var(--app-link)] cursor-pointer"
                            onClick={() => setExpanded(false)}
                        >
                            ▲ 收起 {restBlocks.length} 个步骤
                        </button>
                    </>
                ) : (
                    <>
                        {isRunning && latestChild ? (
                            <div className="mb-1">
                                <HappyNestedBlockList blocks={[latestChild]} />
                            </div>
                        ) : null}
                        <button
                            type="button"
                            className="text-xs text-[var(--app-hint)] hover:text-[var(--app-link)] cursor-pointer"
                            onClick={() => setExpanded(true)}
                        >
                            ▶ 展开 {restBlocks.length} 个步骤
                        </button>
                    </>
                )
            ) : null}
        </div>
    )
}

function HappyNestedBlockList(props: {
    blocks: ChatBlock[]
}) {
    const ctx = useHappyChatContext()

    return (
        <div className="flex flex-col gap-3">
            {props.blocks.map((block) => {
                if (block.kind === 'user-text') {
                    const userBubbleClass = 'w-fit max-w-[92%] ml-auto rounded-xl bg-[var(--app-secondary-bg)] px-3 py-2 text-[var(--app-fg)] shadow-sm'
                    const status = block.status
                    const canRetry = status === 'failed' && typeof block.localId === 'string' && Boolean(ctx.onRetryMessage)
                    const onRetry = canRetry ? () => ctx.onRetryMessage!(block.localId!) : undefined

                    return (
                        <div key={`user:${block.id}`} className={`${userBubbleClass} animate-fade-in-up`}>
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
                        <div key={`agent:${block.id}`} className="px-1 min-w-0 max-w-full animate-fade-in-up">
                            <details className="group">
                                <summary className="cursor-pointer select-none text-xs text-[var(--app-hint)] hover:text-[var(--app-fg)] list-none flex items-center gap-1 mb-1">
                                    <span className="transition-transform group-open:rotate-90">▶</span>
                                    <span className="truncate">{block.text.split('\n')[0].slice(0, 80).trim() || 'Agent 输出'}…</span>
                                </summary>
                                <div className="overflow-x-auto">
                                    <MarkdownRenderer content={block.text} />
                                </div>
                            </details>
                        </div>
                    )
                }

                if (block.kind === 'cli-output') {
                    const alignClass = block.source === 'user' ? 'ml-auto w-full max-w-[92%]' : ''
                    return (
                        <div key={`cli:${block.id}`} className="px-1 min-w-0 max-w-full overflow-x-hidden animate-fade-in-up">
                            <div className={alignClass}>
                                <CliOutputBlock text={block.text} />
                            </div>
                        </div>
                    )
                }

                if (block.kind === 'agent-event') {
                    const presentation = getEventPresentation(block.event)
                    const eventType = (block.event as { type: string }).type
                    const eventMessage = eventType === 'message' ? (block.event as { message?: string }).message : undefined
                    const isCompactMessage = eventType === 'message' && (eventMessage === 'Compaction completed' || eventMessage === 'Compaction started')
                    const isCompact = eventType === 'compact' || eventType === 'microcompact' || isCompactMessage
                    const isMessage = eventType === 'message'
                    const messageText = isMessage && typeof (block.event as Record<string, unknown>).message === 'string'
                        ? (block.event as Record<string, unknown>).message as string
                        : null

                    if (isCompact) {
                        return (
                            <div key={`event:${block.id}`} className="py-1 animate-fade-in-up">
                                <div className="mx-auto w-fit max-w-[92%]">
                                    <div className="inline-flex items-center gap-1.5 rounded-full border border-[var(--app-divider)] bg-[var(--app-secondary-bg)] px-3 py-1 text-xs text-[var(--app-hint)]">
                                        <span aria-hidden="true">{presentation.icon}</span>
                                        <span>{presentation.text}</span>
                                    </div>
                                </div>
                            </div>
                        )
                    }

                    if (isMessage && messageText && messageText.length > 120) {
                        return (
                            <div key={`event:${block.id}`} className="py-1 animate-fade-in-up">
                                <details className="rounded-lg border border-[var(--app-divider)] bg-[var(--app-secondary-bg)]">
                                    <summary className="cursor-pointer select-none px-3 py-2 text-xs text-[var(--app-hint)] hover:text-[var(--app-fg)]">
                                        <span className="inline-flex items-center gap-1.5">
                                            <span aria-hidden="true">📋</span>
                                            <span>Context summary</span>
                                        </span>
                                    </summary>
                                    <div className="border-t border-[var(--app-divider)] px-3 py-2 text-xs text-[var(--app-fg)] leading-relaxed whitespace-pre-wrap">
                                        {messageText}
                                    </div>
                                </details>
                            </div>
                        )
                    }

                    return (
                        <div key={`event:${block.id}`} className="py-1 animate-fade-in-up">
                            <div className="mx-auto w-fit max-w-[92%] px-2 text-center text-xs text-[var(--app-hint)] opacity-80">
                                <span className="inline-flex items-center gap-1">
                                    {presentation.icon ? <span aria-hidden="true">{presentation.icon}</span> : null}
                                    <span>{presentation.text}</span>
                                </span>
                            </div>
                        </div>
                    )
                }

                if (block.kind === 'tool-call') {
                    const isTask = block.tool.name === 'Task' || block.tool.name === 'Agent'
                    const taskChildren = isTask ? splitTaskChildren(block) : null

                    return (
                        <div key={`tool:${block.id}`} className="py-1 opacity-75 animate-fade-in-up">
                            <ToolCard
                                api={ctx.api}
                                sessionId={ctx.sessionId}
                                metadata={ctx.metadata}
                                disabled={ctx.disabled}
                                onDone={ctx.onRefresh}
                                block={block}
                            />
                            {block.children.length > 0 ? (
                                isTask ? (
                                    <TaskChildrenOutside taskChildren={taskChildren} allChildren={block.children} isRunning={block.tool.state === 'running'} />
                                ) : (
                                    <div className="mt-2 pl-3">
                                        <HappyNestedBlockList blocks={block.children} />
                                    </div>
                                )
                            ) : null}
                        </div>
                    )
                }

                return null
            })}
        </div>
    )
}

export function HappyToolMessage(props: ToolCallMessagePartProps) {
    const ctx = useHappyChatContext()
    const artifact = props.artifact

    if (!isToolCallBlock(artifact)) {
        const argsText = typeof props.argsText === 'string' ? props.argsText.trim() : ''
        const hasArgsText = argsText.length > 0
        const hasResult = props.result !== undefined
        const resultText = hasResult ? safeStringify(props.result) : ''

        return (
            <div className="py-1 min-w-0 max-w-full overflow-x-hidden opacity-75">
                <div className="rounded-xl bg-[var(--app-secondary-bg)] p-2 shadow-sm">
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

    const block = artifact
    const isTask = block.tool.name === 'Task' || block.tool.name === 'Agent'
    const taskChildren = isTask ? splitTaskChildren(block) : null

    return (
        <div className="py-1 min-w-0 max-w-full overflow-x-hidden opacity-75">
            <ToolCard
                api={ctx.api}
                sessionId={ctx.sessionId}
                metadata={ctx.metadata}
                disabled={ctx.disabled}
                onDone={ctx.onRefresh}
                block={block}
            />
            {block.children.length > 0 ? (
                isTask ? (
                    <TaskChildrenOutside taskChildren={taskChildren} allChildren={block.children} isRunning={block.tool.state === 'running'} />
                ) : (
                    <div className="mt-2 pl-3">
                        <HappyNestedBlockList blocks={block.children} />
                    </div>
                )
            ) : null}
        </div>
    )
}
