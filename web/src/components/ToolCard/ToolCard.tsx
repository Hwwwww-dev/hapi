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
import { getToolResultViewComponent, extractTextFromResult, parseAgentMeta, AgentUsageBadges } from '@/components/ToolCard/views/_results'
import { extractApplyPatchText } from '@/lib/applyPatch'
import { usePointerFocusRing } from '@/hooks/usePointerFocusRing'
import { canonicalizeToolName } from '@/lib/toolNames'
import { getInputString, getInputStringAny, truncate } from '@/lib/toolInputUtils'
import { cn } from '@/lib/utils'
import { useTranslation } from '@/lib/use-translation'
import {
    IconCheckCircleFill,
    IconCloseCircleFill,
    IconLock,
    IconLoading,
    IconRight,
    IconCheck,
    IconClose,
} from '@arco-design/web-react/icon'
import { Collapse } from '@arco-design/web-react'

const CollapseItem = Collapse.Item

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
        return <IconCheck className="text-emerald-600" style={{ fontSize: 'var(--icon-xs)' }} />
    }
    if (props.state === 'error') {
        return <IconClose className="text-red-600" style={{ fontSize: 'var(--icon-xs)' }} />
    }
    if (props.state === 'pending') {
        return <IconLock className="text-amber-600" style={{ fontSize: 'var(--icon-xs)' }} />
    }
    return <IconLoading className="text-amber-600 animate-spin" style={{ fontSize: 'var(--icon-xs)' }} />
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
                <span className="shrink-0 text-[length:var(--text-badge)] tabular-nums text-[var(--app-hint)]">
                    {completedCount}/{total}
                </span>
            </div>
            {/* All steps */}
            <div className="flex flex-col gap-0.5 max-h-[300px] overflow-y-auto">
                {children.map((child) => {
                    const isError = child.tool.state === 'error'
                    const isActive = child.tool.state === 'running'
                    return (
                        <div key={child.id} className={`flex items-center gap-2 rounded-md px-2 py-1 ${isActive ? 'bg-amber-50 dark:bg-amber-950/20' : isError ? 'bg-red-50 dark:bg-red-950/20' : 'bg-[var(--app-secondary-bg)]'}`}>
                            <span className="shrink-0 w-3 text-center text-[length:var(--text-badge)]">
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
                        <div className="mb-1 text-[length:var(--text-caption)] text-[var(--app-hint)]">subagent_type</div>
                        <span className="rounded-full bg-[var(--app-secondary-bg)] px-2.5 py-0.5 text-[length:var(--text-caption)] font-medium text-[var(--app-fg)]">
                            {subagentType}
                        </span>
                    </div>
                )}
                {description && (
                    <div>
                        <div className="mb-1 text-[length:var(--text-caption)] text-[var(--app-hint)]">description</div>
                        <span className="text-[length:var(--text-body)] text-[var(--app-fg)]">{description}</span>
                    </div>
                )}
                {prompt !== null && (
                    <div>
                        <div className="mb-1 text-[length:var(--text-caption)] text-[var(--app-hint)]">prompt</div>
                        {prompt ? (
                            <div className="rounded-lg border border-[var(--app-divider)] bg-[var(--app-secondary-bg)] p-3">
                                <MarkdownRenderer content={prompt} />
                            </div>
                        ) : (
                            <span className="text-[length:var(--text-caption)] text-[var(--app-hint)]">(empty)</span>
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
                            <div className="text-[length:var(--text-caption)] text-[var(--app-hint)]">
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
                    <div className="text-[length:var(--text-caption)] text-[var(--app-hint)] font-mono break-all">
                        {filePath}
                    </div>
                    <CodeBlock code={content} language="text" />
                </div>
            )
        }
    }

    if (toolName === 'Read' && isObject(input)) {
        const filePath = getInputStringAny(input, ['file_path', 'path'])
        const offset = typeof input.offset === 'number' ? input.offset : null
        const limit = typeof input.limit === 'number' ? input.limit : null
        const pages = getInputString(input, 'pages')

        return (
            <div className="flex flex-col gap-2">
                {filePath ? (
                    <div className="rounded-md bg-[var(--app-code-bg)] px-2 py-2 text-[length:var(--text-code)] text-[var(--app-hint)] font-mono break-all max-sm:px-1.5 max-sm:py-1.5">
                        {filePath}
                    </div>
                ) : null}
                <div className="flex flex-wrap gap-1.5 text-[length:var(--text-caption)]">
                    {offset !== null ? <span className="rounded-md bg-[var(--app-secondary-bg)] px-2 py-1 text-[var(--app-hint)]">offset {offset}</span> : null}
                    {limit !== null ? <span className="rounded-md bg-[var(--app-secondary-bg)] px-2 py-1 text-[var(--app-hint)]">limit {limit}</span> : null}
                    {pages ? <span className="rounded-md bg-[var(--app-secondary-bg)] px-2 py-1 text-[var(--app-hint)]">pages {pages}</span> : null}
                </div>
            </div>
        )
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
            return <CodeBlock code={cmd} language="bash" preClassName="shiki m-0 whitespace-pre-wrap break-words p-2 pr-8 text-[length:var(--text-code)] font-mono" />
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
        return <IconCheckCircleFill style={{ fontSize: 'var(--icon-sm)' }} />
    }
    if (props.state === 'error') {
        return <IconCloseCircleFill style={{ fontSize: 'var(--icon-sm)' }} />
    }
    if (props.state === 'pending') {
        return <IconLock style={{ fontSize: 'var(--icon-sm)' }} />
    }
    return <IconLoading className="animate-spin" style={{ fontSize: 'var(--icon-sm)' }} />
}

function statusColorClass(state: ToolCallBlock['tool']['state']): string {
    if (state === 'completed') return 'text-emerald-600'
    if (state === 'error') return 'text-red-600'
    if (state === 'pending') return 'text-amber-600'
    return 'text-[var(--app-hint)]'
}

function DetailsIcon() {
    return <IconRight style={{ fontSize: 'var(--icon-md)' }} />
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
                        <div key={block.id} className={`flex items-start gap-2 rounded-md px-2 py-1.5 ${isActive ? 'bg-amber-50 dark:bg-amber-950/20' : isError ? 'bg-red-50 dark:bg-red-950/20' : 'bg-[var(--app-secondary-bg)]'}`}>
                            <span className="shrink-0 w-3 text-center text-[length:var(--text-badge)] mt-0.5">
                                <TaskStateIcon state={block.tool.state} />
                            </span>
                            <div className="min-w-0 flex-1">
                                <span className={`font-mono text-[length:var(--text-body)] ${isError ? 'text-red-600' : isActive ? 'text-amber-700 dark:text-amber-400' : 'text-[var(--app-fg)]'}`}>
                                    {label}
                                </span>
                                {block.tool.result !== undefined && block.tool.result !== null ? (
                                    <div className="mt-1 text-[length:var(--text-badge)] text-[var(--app-hint)] line-clamp-3 break-all">
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
                    const isLong = block.text.length > 120 || block.text.includes('\n')
                    return (
                        <div key={block.id} className="px-2 py-1 min-w-0 max-w-full">
                            {isLong ? (
                                <Collapse bordered={false} className="toolcard-collapse">
                                    <CollapseItem
                                        name="agent-text"
                                        header={<span className="truncate text-[length:var(--text-caption)] text-[var(--app-hint)]">{block.text.split('\n')[0].slice(0, 80).trim()}…</span>}
                                    >
                                        <div className="overflow-x-auto">
                                            <MarkdownRenderer content={block.text} />
                                        </div>
                                    </CollapseItem>
                                </Collapse>
                            ) : (
                                <div className="overflow-x-auto">
                                    <MarkdownRenderer content={block.text} />
                                </div>
                            )}
                        </div>
                    )
                }

                if (block.kind === 'user-text') {
                    return (
                        <div key={block.id} className="px-2 py-1 rounded-md bg-[var(--app-secondary-bg)]">
                            <div className="text-[length:var(--text-badge)] text-[var(--app-hint)] mb-0.5">User</div>
                            <div className="text-[length:var(--text-body)] text-[var(--app-fg)]">{block.text}</div>
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

    const agentMeta = useMemo(() => {
        if (!isTaskOrAgent || props.block.tool.state !== 'completed') return null
        const text = extractTextFromResult(props.block.tool.result)
        if (!text) return null
        const { usage } = parseAgentMeta(text)
        return usage
    }, [isTaskOrAgent, props.block.tool.state, props.block.tool.result])
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
                    <span className={stateColor}>
                        <StatusIcon state={props.block.tool.state} />
                    </span>
                    <span className="text-[var(--app-hint)]">
                        <DetailsIcon />
                    </span>
                </div>
            </div>

            {subtitle ? (
                <CardDescription className="pl-[22px] font-mono text-xs break-all opacity-80">
                    {truncate(subtitle, 160)}
                </CardDescription>
            ) : null}
            {agentMeta ? <div className="pl-[14px]"><AgentUsageBadges agentId={null} usage={agentMeta} /></div> : null}
        </div>
    )

    return (
        <Card className={cn('overflow-hidden shadow-sm toolcard-muted', presentation.hoverReveal && 'group/card')}>
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
                            <DialogTitle className="break-all text-[length:var(--text-title)] font-medium">{toolTitle}</DialogTitle>
                        </DialogHeader>
                        {(() => {
                            const isQuestionToolWithAnswers = isQuestionTool
                                && permission?.answers
                                && Object.keys(permission.answers).length > 0

                            return (
                                <div className="toolcard-dialog mt-3 flex max-h-[75vh] flex-col gap-4 overflow-y-auto scrollbar-hide max-sm:mt-2 max-sm:max-h-[70vh] max-sm:gap-3">
                                    <Collapse bordered={false} activeKey={['input']} className="toolcard-collapse toolcard-collapse--input shrink-0">
                                        <CollapseItem
                                            name="input"
                                            header={<span className="text-[length:var(--text-caption)] sm:text-[length:var(--text-body)] text-[var(--app-hint)]">{isQuestionToolWithAnswers ? t('tool.questionsAnswers') : t('tool.input')}</span>}
                                        >
                                            {FullToolView
                                                ? <FullToolView block={props.block} metadata={props.metadata} />
                                                : renderToolInput(props.block)
                                            }
                                        </CollapseItem>
                                    </Collapse>
                                    {isTaskOrAgent && props.block.children.length > 0 ? (
                                        <Collapse bordered={false} className="toolcard-collapse toolcard-collapse--steps shrink-0">
                                            <CollapseItem
                                                name="task-steps"
                                                header={<span className="text-[length:var(--text-caption)] sm:text-[length:var(--text-body)] text-[var(--app-hint)]">{t('tool.taskSteps')} ({props.block.children.length})</span>}
                                            >
                                                <TaskChildrenList children={props.block.children} metadata={props.metadata} />
                                            </CollapseItem>
                                        </Collapse>
                                    ) : null}
                                    {!isQuestionToolWithAnswers && (
                                        <Collapse bordered={false} defaultActiveKey={presentation.minimal ? [] : ['result']} className="toolcard-collapse toolcard-collapse--result shrink-0">
                                            <CollapseItem
                                                name="result"
                                                header={<span className="text-[length:var(--text-caption)] sm:text-[length:var(--text-body)] text-[var(--app-hint)]">{t('tool.result')}</span>}
                                            >
                                                <ResultToolView block={props.block} metadata={props.metadata} />
                                            </CollapseItem>
                                        </Collapse>
                                    )}
                                    {import.meta.env.DEV && props.block.tool.result != null && (
                                        <Collapse bordered={false} className="toolcard-collapse toolcard-collapse--raw shrink-0">
                                            <CollapseItem
                                                name="raw-result"
                                                header={<span className="text-[length:var(--text-caption)] sm:text-[length:var(--text-body)] font-medium text-[var(--app-hint)]">{t('tool.rawResult')}</span>}
                                            >
                                                <CodeBlock code={safeStringify(props.block.tool.result)} language="json" />
                                            </CollapseItem>
                                        </Collapse>
                                    )}
                                </div>
                            )
                        })()}
                    </DialogContent>
                </Dialog>
            </CardHeader>

            {hasBody ? (
                <CardContent className={cn('px-3 pb-3 pt-0 pl-[34px]', presentation.hoverReveal && 'hidden group-hover/card:block')}>
                    {taskSummary ? (
                        <div className="mt-2">
                            {taskSummary}
                        </div>
                    ) : null}

                    {showTaskResult ? (
                        <Collapse bordered={false} className="toolcard-collapse mt-3">
                            <CollapseItem
                                name="task-result"
                                header={<span className="text-[length:var(--text-body)] text-[var(--app-hint)]">{t('tool.result')}</span>}
                            >
                                <ResultToolView block={props.block} metadata={props.metadata} />
                            </CollapseItem>
                        </Collapse>
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
