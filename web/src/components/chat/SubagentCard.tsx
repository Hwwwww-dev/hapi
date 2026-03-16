import { useMemo, useState, type ReactNode } from 'react'
import type { CanonicalRenderBlock, CanonicalSubagentRenderBlock } from '@/chat/canonical'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

function summarizeChildren(children: readonly CanonicalRenderBlock[]): string {
    if (children.length === 0) return 'No child activity yet'

    let runningTools = 0
    let failedTools = 0
    let completedTools = 0
    let reasoningBlocks = 0

    for (const child of children) {
        if (child.kind === 'reasoning') {
            reasoningBlocks += 1
            continue
        }
        if (child.kind !== 'tool-call' && child.kind !== 'tool-result') continue
        if (child.tool.state === 'running' || child.tool.state === 'pending') runningTools += 1
        else if (child.tool.state === 'error') failedTools += 1
        else completedTools += 1
    }

    const parts = [
        runningTools > 0 ? `${runningTools} running tool${runningTools > 1 ? 's' : ''}` : null,
        failedTools > 0 ? `${failedTools} failed tool${failedTools > 1 ? 's' : ''}` : null,
        completedTools > 0 ? `${completedTools} completed tool${completedTools > 1 ? 's' : ''}` : null,
        reasoningBlocks > 0 ? `${reasoningBlocks} reasoning update${reasoningBlocks > 1 ? 's' : ''}` : null,
        `${children.length} timeline item${children.length > 1 ? 's' : ''}`
    ].filter(Boolean)

    return parts.join(' · ')
}

function lifecycleClassName(state: string): string {
    const normalized = state.trim().toLowerCase()
    if (normalized === 'running' || normalized === 'streaming' || normalized === 'pending') {
        return 'text-amber-600'
    }
    if (normalized === 'error' || normalized === 'failed' || normalized === 'canceled' || normalized === 'cancelled') {
        return 'text-red-600'
    }
    return 'text-emerald-600'
}

export function SubagentCard(props: {
    block: CanonicalSubagentRenderBlock
    children?: ReactNode
}) {
    const { block } = props
    const [isOpen, setIsOpen] = useState(false)
    const summary = useMemo(() => summarizeChildren(block.children), [block.children])
    const stateLabel = block.lifecycleState.trim().length > 0 ? block.lifecycleState : block.state
    const hasChildren = block.children.length > 0

    return (
        <Card className="overflow-hidden shadow-sm">
            <CardHeader className="p-3 pb-2">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <CardTitle className="text-sm font-medium leading-tight break-words">
                            {block.title ?? 'Subagent'}
                        </CardTitle>
                        <CardDescription className="mt-1 break-words text-xs opacity-80">
                            {block.description ?? summary}
                        </CardDescription>
                    </div>
                    <div className={cn('shrink-0 text-xs font-mono uppercase tracking-wide', lifecycleClassName(stateLabel))}>
                        {stateLabel}
                    </div>
                </div>
                {block.subagentId ? (
                    <div className="text-[11px] font-mono text-[var(--app-hint)] break-all opacity-80">
                        {block.subagentId}
                    </div>
                ) : null}
            </CardHeader>

            <CardContent className="px-3 pb-3 pt-0">
                <div className="text-xs text-[var(--app-hint)] break-words">
                    {summary}
                </div>

                {hasChildren ? (
                    <div className="mt-3">
                        <button
                            type="button"
                            aria-expanded={isOpen}
                            onClick={() => setIsOpen(open => !open)}
                            className="text-xs font-medium text-[var(--app-hint)] hover:text-[var(--app-fg)]"
                        >
                            {isOpen ? 'Hide child timeline' : `Show child timeline (${block.children.length})`}
                        </button>
                        {isOpen ? (
                            <div className="mt-3 border-l-2 border-[var(--app-border)] pl-3">
                                {props.children}
                            </div>
                        ) : null}
                    </div>
                ) : null}
            </CardContent>
        </Card>
    )
}
