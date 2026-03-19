import type { ToolCallBlock, ChatBlock } from '@/chat/types'
import type { ApiClient } from '@/api/client'
import type { SessionMetadataSummary } from '@/types/api'
import { memo, useEffect, useMemo, useState, type ReactNode } from 'react'
import { isObject, safeStringify } from '@hapi/protocol'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { CodeBlock } from '@/components/CodeBlock'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { DiffView } from '@/components/DiffView'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { PermissionFooter } from '@/components/ToolCard/PermissionFooter'
import { AskUserQuestionFooter } from '@/components/ToolCard/AskUserQuestionFooter'
import { RequestUserInputFooter } from '@/components/ToolCard/RequestUserInputFooter'
import { isAskUserQuestionToolName } from '@/components/ToolCard/askUserQuestion'
import { isRequestUserInputToolName } from '@/components/ToolCard/requestUserInput'
import { getToolPresentation } from '@/components/ToolCard/knownTools'
import { getToolFullViewComponent, getToolViewComponent } from '@/components/ToolCard/views/_all'
import { getToolResultViewComponent } from '@/components/ToolCard/views/_results'
import { extractApplyPatchText } from '@/lib/applyPatch'
import { usePointerFocusRing } from '@/hooks/usePointerFocusRing'
import { canonicalizeToolName } from '@/lib/toolNames'
import { getInputString, getInputStringAny, truncate } from '@/lib/toolInputUtils'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/use-translation'

const ELAPSED_INTERVAL_MS = 1000

function ElapsedView(props: { from: number; active: boolean }) {
    const [now, setNow] = useState(() => Date.now())

    useEffect(() => {
        if (!props.active) return
        const id = setInterval(() => setNow(Date.now()), ELAPSED_INTERVAL_MS)
        return () => clearInterval(id)
    }, [props.active])

    if (!props.active) return null

    const elapsed = (now - props.from) / 1000
    if (!Number.isFinite(elapsed)) return null

    return (
        <span className="font-mono text-xs text-[var(--app-hint)]">
            {elapsed.toFixed(1)}s
        </span>
    )
}

function formatTaskChildLabel(child: ToolCallBlock, metadata: SessionMetadataSummary | null): string {
    const presentation = getToolPresentation({
        toolName: child.tool.name,
        input: child.tool.input,
        result: child.tool.result,
        childrenCount: child.children.length,
        description: child.tool.description,
        metadata
    })

    if (presentation.subtitle) {
        return truncate(`${presentation.title}: ${presentation.subtitle}`, 140)
    }

    return presentation.title
}

function TaskStateIcon(props: { state: ToolCallBlock['tool']['state'] }) {
    if (props.state === 'completed') {
        return <span className="text-emerald-600">✓</span>
    }
    if (props.state === 'error') {
        return <span className="text-red-600">✕</span>
    }
    if (props.state === 'pending') {
        return <span className="text-amber-600">🔐</span>
    }
    return <span className="text-amber-600 animate-pulse">●</span>
}

function getTaskSummaryChildren(block: ToolCallBlock): {
    children: ToolCallBlock[]
    total: number
    completedCount: number
} | null {
    if (canonicalizeToolName(block.tool.name) !== 'Task') return null

    const children = block.children
        .filter((child): child is ToolCallBlock => child.kind === 'tool-call')
        .filter((child) => child.tool.state === 'pending' || child.tool.state === 'running' || child.tool.state === 'completed' || child.tool.state === 'error')

    if (children.length === 0) return null

    const completedCount = children.filter(c => c.tool.state === 'completed').length
    return { children, total: children.length, completedCount }
}

function renderTaskSummary(block: ToolCallBlock, metadata: SessionMetadataSummary | null): ReactNode | null {
    const summary = getTaskSummaryChildren(block)
    if (!summary) return null

    const { children, total, completedCount } = summary
    const isRunning = block.tool.state === 'running'
    const progressPct = total > 0 ? Math.round((completedCount / total) * 100) : 0

    return (
        <div className="flex flex-col gap-2">
            {/* Progress header */}
            <div className="flex items-center justify-between gap-2">
                <div className="flex-1 h-1 rounded-full bg-[var(--app-secondary-bg)] overflow-hidden">
                    <div
                        className={`h-full rounded-full transition-all duration-500 ${isRunning ? 'bg-amber-400' : completedCount === total ? 'bg-emerald-500' : 'bg-[var(--app-link)]'}`}
                        style={{ width: `${progressPct}%` }}
                    />
                </div>
                <span className="shrink-0 text-[10px] tabular-nums text-[var(--app-hint)]">
                    {completedCount}/{total}
                </span>
            </div>
            {/* All steps */}
            <div className="flex flex-col gap-0.5 max-h-[300px] overflow-y-auto">
                {children.map((child) => {
                    const isError = child.tool.state === 'error'
                    const isActive = child.tool.state === 'running'
                    return (
                        <div key={child.id} className={`flex items-center gap-2 rounded px-2 py-1 ${isActive ? 'bg-amber-50 dark:bg-amber-950/20' : isError ? 'bg-red-50 dark:bg-red-950/20' : 'bg-[var(--app-secondary-bg)]'}`}>
                            <span className="shrink-0 w-3 text-center text-[10px]">
                                <TaskStateIcon state={child.tool.state} />
                            </span>
                            <span className={`min-w-0 flex-1 truncate font-mono text-xs ${isError ? 'text-red-600' : isActive ? 'text-amber-700 dark:text-amber-400' : 'text-[var(--app-hint)]'}`}>
                                {formatTaskChildLabel(child, metadata)}
                            </span>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

function renderEditInput(input: unknown): ReactNode | null {
    if (!isObject(input)) return null
    const filePath = getInputStringAny(input, ['file_path', 'path']) ?? undefined
    const oldString = getInputString(input, 'old_string')
    const newString = getInputString(input, 'new_string')
    if (oldString === null || newString === null) return null

    return (
        <DiffView
            oldString={oldString}
            newString={newString}
            filePath={filePath}
        />
    )
}

function renderExitPlanModeInput(input: unknown): ReactNode | null {
    if (!isObject(input)) return null
    const plan = getInputString(input, 'plan')
    if (!plan) return null
    return <MarkdownRenderer content={plan} />
}

function renderToolInput(block: ToolCallBlock): ReactNode {
    const toolName = canonicalizeToolName(block.tool.name)
    const input = block.tool.input

    if (toolName === 'Task' && isObject(input)) {
        const subagentType = typeof input.subagent_type === 'string' ? input.subagent_type : null
        const description = typeof input.description === 'string' ? input.description : null
        const prompt = typeof input.prompt === 'string' ? input.prompt : null
        return (
            <div className="flex flex-col gap-3">
                {subagentType && (
                    <div>
                        <div className="mb-1 text-xs text-[var(--app-hint)]">subagent_type</div>
                        <span className="rounded-full bg-[var(--app-secondary-bg)] px-2.5 py-0.5 text-xs font-medium text-[var(--app-fg)]">
                            {subagentType}
                        </span>
                    </div>
                )}
                {description && (
                    <div>
                        <div className="mb-1 text-xs text-[var(--app-hint)]">description</div>
                        <span className="text-sm text-[var(--app-fg)]">{description}</span>
                    </div>
                )}
                {prompt !== null && (
                    <div>
                        <div className="mb-1 text-xs text-[var(--app-hint)]">prompt</div>
                        {prompt ? (
                            <div className="rounded-lg border border-[var(--app-divider)] bg-[var(--app-secondary-bg)] p-3">
                                <MarkdownRenderer content={prompt} />
                            </div>
                        ) : (
                            <span className="text-xs text-[var(--app-hint)]">(empty)</span>
                        )}
                    </div>
                )}
            </div>
        )
    }

    if (toolName === 'Edit') {
        const diff = renderEditInput(input)
        if (diff) return diff
    }

    if (toolName === 'MultiEdit' && isObject(input)) {
        const filePath = getInputStringAny(input, ['file_path', 'path']) ?? undefined
        const edits = Array.isArray(input.edits) ? input.edits : null
        if (edits && edits.length > 0) {
            const rendered = edits
                .slice(0, 3)
                .map((edit, idx) => {
                    if (!isObject(edit)) return null
                    const oldString = getInputString(edit, 'old_string')
                    const newString = getInputString(edit, 'new_string')
                    if (oldString === null || newString === null) return null
                    return (
                        <div key={idx}>
                            <DiffView oldString={oldString} newString={newString} filePath={filePath} />
                        </div>
                    )
                })
                .filter(Boolean)

            if (rendered.length > 0) {
                return (
                    <div className="flex flex-col gap-2">
                        {rendered}
                        {edits.length > 3 ? (
                            <div className="text-xs text-[var(--app-hint)]">
                                (+{edits.length - 3} more edits)
                            </div>
                        ) : null}
                    </div>
                )
            }
        }
    }

    if (toolName === 'Write' && isObject(input)) {
        const filePath = getInputStringAny(input, ['file_path', 'path'])
        const content = getInputStringAny(input, ['content', 'text'])
        if (filePath && content !== null) {
            return (
                <div className="flex flex-col gap-2">
                    <div className="text-xs text-[var(--app-hint)] font-mono break-all">
                        {filePath}
                    </div>
                    <CodeBlock code={content} language="text" />
                </div>
            )
        }
    }

    if (toolName === 'CodexDiff' && isObject(input) && typeof input.unified_diff === 'string') {
        return <CodeBlock code={input.unified_diff} language="diff" />
    }

    if (toolName === 'ExitPlanMode' || toolName === 'exit_plan_mode') {
        const plan = renderExitPlanModeInput(input)
        if (plan) return plan
    }

    const commandArray = isObject(input) && Array.isArray(input.command) ? input.command : null
    if ((toolName === 'CodexBash' || toolName === 'Bash') && (typeof commandArray?.[0] === 'string' || typeof input === 'object')) {
        const cmd = Array.isArray(commandArray)
            ? commandArray.filter((part) => typeof part === 'string').join(' ')
            : getInputStringAny(input, ['command', 'cmd'])
        if (cmd) {
            return <CodeBlock code={cmd} language="bash" />
        }
    }

    if (toolName === 'apply_patch') {
        const patch = extractApplyPatchText(input)
        if (patch) {
            return <CodeBlock code={patch} language="diff" />
        }
    }

    return <CodeBlock code={safeStringify(input)} language="json" />
}

function StatusIcon(props: { state: ToolCallBlock['tool']['state'] }) {
    if (props.state === 'completed') {
        return (
            <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
                <path d="M5.2 8.3l1.8 1.8 3.8-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
        )
    }
    if (props.state === 'error') {
        return (
            <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none">
                <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" />
                <path d="M5.6 5.6l4.8 4.8M10.4 5.6l-4.8 4.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
        )
    }
    if (props.state === 'pending') {
        return (
            <svg className="h-3 w-3" viewBox="0 0 16 16" fill="none">
                <rect x="4.5" y="7" width="7" height="6" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
                <path d="M6 7V5.8a2 2 0 0 1 4 0V7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
        )
    }
    return (
        <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.25" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" opacity="0.75" />
        </svg>
    )
}

function statusColorClass(state: ToolCallBlock['tool']['state']): string {
    if (state === 'completed') return 'text-emerald-600'
    if (state === 'error') return 'text-red-600'
    if (state === 'pending') return 'text-amber-600'
    return 'text-[var(--app-hint)]'
}

function DetailsIcon() {
    return (
        <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none">
            <path d="M6 3l5 5-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
    )
}

/**
 * Lightweight renderer for Task children blocks inside ToolCard dialog.
 * Renders tool-call, agent-text, user-text, cli-output blocks.
 */
function TaskChildrenList({ children, metadata }: { children: ChatBlock[]; metadata: SessionMetadataSummary | null }) {
    if (children.length === 0) return null

    return (
        <div className="flex flex-col gap-1.5">
            {children.map((block) => {
                if (block.kind === 'tool-call') {
                    const isError = block.tool.state === 'error'
                    const isActive = block.tool.state === 'running'
                    const label = formatTaskChildLabel(block, metadata)
                    return (
                        <div key={block.id} className={`flex items-start gap-2 rounded px-2 py-1.5 ${isActive ? 'bg-amber-50 dark:bg-amber-950/20' : isError ? 'bg-red-50 dark:bg-red-950/20' : 'bg-[var(--app-secondary-bg)]'}`}>
                            <span className="shrink-0 w-3 text-center text-[10px] mt-0.5">
                                <TaskStateIcon state={block.tool.state} />
                            </span>
                            <div className="min-w-0 flex-1">
                                <span className={`font-mono text-xs ${isError ? 'text-red-600' : isActive ? 'text-amber-700 dark:text-amber-400' : 'text-[var(--app-fg)]'}`}>
                                    {label}
                                </span>
                                {block.tool.result !== undefined && block.tool.result !== null ? (
                                    <div className="mt-1 text-[10px] text-[var(--app-hint)] line-clamp-3 break-all">
                                        {typeof block.tool.result === 'string' ? block.tool.result : safeStringify(block.tool.result)}
                                    </div>
                                ) : null}
                                {block.children.length > 0 ? (
                                    <div className="mt-1 ml-2 border-l-2 border-[var(--app-divider)] pl-2">
                                        <TaskChildrenList children={block.children} metadata={metadata} />
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    )
                }

                if (block.kind === 'agent-text') {
                    return (
                        <div key={block.id} className="px-2 py-1">
                            <MarkdownRenderer content={block.text} />
                        </div>
                    )
                }

                if (block.kind === 'user-text') {
                    return (
                        <div key={block.id} className="px-2 py-1 rounded bg-[var(--app-secondary-bg)]">
                            <div className="text-[10px] text-[var(--app-hint)] mb-0.5">User</div>
                            <div className="text-xs text-[var(--app-fg)]">{block.text}</div>
                        </div>
                    )
                }

                if (block.kind === 'cli-output') {
                    return (
                        <div key={block.id} className="px-2 py-1">
                            <CodeBlock code={block.text} language="text" />
                        </div>
                    )
                }

                return null
            })}
        </div>
    )
}

type ToolCardProps = {
    api: ApiClient
    sessionId: string
    metadata: SessionMetadataSummary | null
    disabled: boolean
    onDone: () => void
    block: ToolCallBlock
}

function ToolCardInner(props: ToolCardProps) {
    const { t } = useTranslation()
    const presentation = useMemo(() => getToolPresentation({
        toolName: props.block.tool.name,
        input: props.block.tool.input,
        result: props.block.tool.result,
        childrenCount: props.block.children.length,
        description: props.block.tool.description,
        metadata: props.metadata
    }), [
        props.block.tool.name,
        props.block.tool.input,
        props.block.tool.result,
        props.block.children.length,
        props.block.tool.description,
        props.metadata
    ])

    const toolName = props.block.tool.name
    const canonicalToolName = canonicalizeToolName(toolName)
    const toolTitle = presentation.title
    const subtitle = presentation.subtitle ?? props.block.tool.description
    const taskSummary = renderTaskSummary(props.block, props.metadata)
    const runningFrom = props.block.tool.startedAt ?? props.block.tool.createdAt
    const isTaskOrAgent = canonicalToolName === 'Task' || canonicalToolName === 'Agent'
    const showInline = !presentation.minimal && !isTaskOrAgent
    const showTaskResult = isTaskOrAgent
        && props.block.tool.state === 'completed'
        && props.block.tool.result !== undefined
        && props.block.tool.result !== null
    const CompactToolView = showInline ? getToolViewComponent(canonicalToolName) : null
    const FullToolView = getToolFullViewComponent(canonicalToolName)
    const ResultToolView = getToolResultViewComponent(canonicalToolName)
    const permission = props.block.tool.permission
    const isAskUserQuestion = isAskUserQuestionToolName(canonicalToolName)
    const isRequestUserInput = isRequestUserInputToolName(canonicalToolName)
    const isQuestionTool = isAskUserQuestion || isRequestUserInput
    const showsPermissionFooter = Boolean(permission && (
        permission.status === 'pending'
        || ((permission.status === 'denied' || permission.status === 'canceled') && Boolean(permission.reason))
    ))
    const hasBody = showInline || showTaskResult || taskSummary !== null || showsPermissionFooter
    const isMinimalWithResult = presentation.minimal && props.block.tool.state === 'completed' && props.block.tool.result !== undefined && props.block.tool.result !== null
    const stateColor = statusColorClass(props.block.tool.state)
    const { suppressFocusRing, onTriggerPointerDown, onTriggerKeyDown, onTriggerBlur } = usePointerFocusRing()

    const header = (
        <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between gap-3">
                <div className="min-w-0 flex items-center gap-2">
                    <div className="shrink-0 flex h-3.5 w-3.5 items-center justify-center text-[var(--app-hint)] leading-none">
                        {presentation.icon}
                    </div>
                    <CardTitle className="min-w-0 text-sm font-medium leading-tight break-words">
                        {toolTitle}
                    </CardTitle>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                    <ElapsedView from={runningFrom} active={props.block.tool.state === 'running'} />
                    {isMinimalWithResult ? (
                        <span className="rounded bg-[var(--app-secondary-bg)] px-1 py-0.5 text-[10px] text-[var(--app-hint)]">···</span>
                    ) : null}
                    <span className={stateColor}>
                        <StatusIcon state={props.block.tool.state} />
                    </span>
                    <span className="text-[var(--app-hint)]">
                        <DetailsIcon />
                    </span>
                </div>
            </div>

            {subtitle ? (
                <CardDescription className="font-mono text-xs break-all opacity-80">
                    {truncate(subtitle, 160)}
                </CardDescription>
            ) : null}
        </div>
    )

    return (
        <Card className="overflow-hidden shadow-sm">
            <CardHeader className="p-3 space-y-0">
                <Dialog>
                    <DialogTrigger asChild>
                        <button
                            type="button"
                            className={cn(
                                'w-full text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-link)]',
                                suppressFocusRing && 'focus-visible:ring-0'
                            )}
                            onPointerDown={onTriggerPointerDown}
                            onKeyDown={onTriggerKeyDown}
                            onBlur={onTriggerBlur}
                        >
                            {header}
                        </button>
                    </DialogTrigger>
                    <DialogContent className="max-w-2xl">
                        <DialogHeader>
                            <DialogTitle className="break-all">{toolTitle}</DialogTitle>
                        </DialogHeader>
                        {(() => {
                            const isQuestionToolWithAnswers = isQuestionTool
                                && permission?.answers
                                && Object.keys(permission.answers).length > 0

                            return (
                                <div className="mt-3 flex max-h-[75vh] flex-col gap-4 overflow-auto">
                                    <div>
                                        <div className="mb-1 text-xs font-medium text-[var(--app-hint)]">
                                            {isQuestionToolWithAnswers ? t('tool.questionsAnswers') : t('tool.input')}
                                        </div>
                                        {FullToolView
                                            ? <FullToolView block={props.block} metadata={props.metadata} />
                                            : renderToolInput(props.block)
                                        }
                                    </div>
                                    {isTaskOrAgent && props.block.children.length > 0 ? (
                                        <details className="group">
                                            <summary className="flex cursor-pointer list-none items-center gap-2 rounded border border-[var(--app-divider)] bg-[var(--app-secondary-bg)] px-2.5 py-1.5 text-xs text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] select-none">
                                                <span className="transition-transform group-open:rotate-90">▶</span>
                                                <span className="flex-1">{t('tool.taskSteps')} ({props.block.children.length})</span>
                                            </summary>
                                            <div className="mt-1.5">
                                                <TaskChildrenList children={props.block.children} metadata={props.metadata} />
                                            </div>
                                        </details>
                                    ) : null}
                                    {!isQuestionToolWithAnswers && (
                                        <div>
                                            <div className="mb-1 text-xs font-medium text-[var(--app-hint)]">{t('tool.result')}</div>
                                            {presentation.minimal ? (
                                                <details className="group" open>
                                                    <summary className="flex cursor-pointer list-none items-center gap-2 rounded border border-[var(--app-divider)] bg-[var(--app-secondary-bg)] px-2.5 py-1.5 text-xs text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] select-none">
                                                        <span className="transition-transform group-open:rotate-90">▶</span>
                                                        <span className="flex-1">{t('tool.result')}</span>
                                                    </summary>
                                                    <div className="mt-1.5">
                                                        <ResultToolView block={props.block} metadata={props.metadata} />
                                                    </div>
                                                </details>
                                            ) : (
                                                <ResultToolView block={props.block} metadata={props.metadata} />
                                            )}
                                        </div>
                                    )}
                                </div>
                            )
                        })()}
                    </DialogContent>
                </Dialog>
            </CardHeader>

            {hasBody ? (
                <CardContent className="px-3 pb-3 pt-0">
                    {taskSummary ? (
                        <div className="mt-2">
                            {taskSummary}
                        </div>
                    ) : null}

                    {showTaskResult ? (
                        <div className="mt-3">
                            <ResultToolView block={props.block} metadata={props.metadata} />
                        </div>
                    ) : null}

                    {showInline ? (
                        CompactToolView ? (
                            <div className="mt-3">
                                <CompactToolView block={props.block} metadata={props.metadata} />
                            </div>
                        ) : (
                            <div className="mt-3 flex flex-col gap-3">
                                <div>
                                    <div className="mb-1 text-xs font-medium text-[var(--app-hint)]">{t('tool.input')}</div>
                                    {renderToolInput(props.block)}
                                </div>
                                <div>
                                    <div className="mb-1 text-xs font-medium text-[var(--app-hint)]">{t('tool.result')}</div>
                                    <ResultToolView block={props.block} metadata={props.metadata} />
                                </div>
                            </div>
                        )
                    ) : null}

                    {isAskUserQuestion && permission?.status === 'pending' ? (
                        <AskUserQuestionFooter
                            api={props.api}
                            sessionId={props.sessionId}
                            tool={props.block.tool}
                            disabled={props.disabled}
                            onDone={props.onDone}
                        />
                    ) : isRequestUserInput && permission?.status === 'pending' ? (
                        <RequestUserInputFooter
                            api={props.api}
                            sessionId={props.sessionId}
                            tool={props.block.tool}
                            disabled={props.disabled}
                            onDone={props.onDone}
                        />
                    ) : (
                        <PermissionFooter
                            api={props.api}
                            sessionId={props.sessionId}
                            metadata={props.metadata}
                            tool={props.block.tool}
                            disabled={props.disabled}
                            onDone={props.onDone}
                        />
                    )}
                </CardContent>
            ) : null}
        </Card>
    )
}

export const ToolCard = memo(ToolCardInner)
