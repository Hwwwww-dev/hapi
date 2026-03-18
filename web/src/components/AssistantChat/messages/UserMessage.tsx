import { memo, useState } from 'react'
import { MessagePrimitive, useAssistantState } from '@assistant-ui/react'
import { LazyRainbowText } from '@/components/LazyRainbowText'
import { useHappyChatContext } from '@/components/AssistantChat/context'
import type { HappyChatMessageMetadata } from '@/lib/assistant-runtime'
import { MessageStatusIndicator } from '@/components/AssistantChat/messages/MessageStatusIndicator'
import { MessageAttachments } from '@/components/AssistantChat/messages/MessageAttachments'
import { MessageTimestamp } from '@/components/AssistantChat/messages/MessageTimestamp'
import { CliOutputBlock } from '@/components/CliOutputBlock'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { BulbIcon, ClipboardIcon } from '@/components/ToolCard/icons'

const SKILL_CONTENT_PREFIX = 'Base directory for this skill:'
const COMPACT_CONTENT_PREFIX = 'This session is being continued from a previous conversation'

/** Detect skill content message and extract skill name from path */
function parseSkillContent(text: string): { skillName: string } | null {
    if (!text.startsWith(SKILL_CONTENT_PREFIX)) return null
    const firstLine = text.split('\n')[0]
    const match = firstLine.match(/\/skills\/([^/\s]+)/)
    if (match) return { skillName: match[1] }
    const pathMatch = firstLine.match(/:\s*(.+)/)
    if (pathMatch) {
        const segments = pathMatch[1].trim().split('/')
        return { skillName: segments[segments.length - 1] || 'skill' }
    }
    return { skillName: 'skill' }
}

/** Detect compact/context-continuation message */
function isCompactContent(text: string): boolean {
    return text.startsWith(COMPACT_CONTENT_PREFIX)
}

export const HappyUserMessage = memo(function HappyUserMessage() {
    const ctx = useHappyChatContext()
    const role = useAssistantState(({ message }) => message.role)
    const text = useAssistantState(({ message }) => {
        if (message.role !== 'user') return ''
        return message.content.find((part) => part.type === 'text')?.text ?? ''
    })
    const status = useAssistantState(({ message }) => {
        if (message.role !== 'user') return undefined
        const custom = message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        return custom?.status
    })
    const localId = useAssistantState(({ message }) => {
        if (message.role !== 'user') return null
        const custom = message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        return custom?.localId ?? null
    })
    const attachments = useAssistantState(({ message }) => {
        if (message.role !== 'user') return undefined
        const custom = message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        return custom?.attachments
    })
    const isCliOutput = useAssistantState(({ message }) => {
        const custom = message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        return custom?.kind === 'cli-output'
    })
    const cliText = useAssistantState(({ message }) => {
        const custom = message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        if (custom?.kind !== 'cli-output') return ''
        return message.content.find((part) => part.type === 'text')?.text ?? ''
    })
    const createdAt = useAssistantState(({ message }) => message.createdAt)

    // All hooks must be before any conditional returns (React rules of hooks)
    const skillInfo = parseSkillContent(text)
    const isCompact = !skillInfo && isCompactContent(text)
    const [skillExpanded, setSkillExpanded] = useState(false)
    const [compactExpanded, setCompactExpanded] = useState(false)
    const [expanded, setExpanded] = useState(false)

    if (role !== 'user') return null
    const canRetry = status === 'failed' && typeof localId === 'string' && Boolean(ctx.onRetryMessage)
    const onRetry = canRetry ? () => ctx.onRetryMessage!(localId) : undefined

    const userBubbleClass = 'w-fit min-w-0 max-w-[92%] ml-auto rounded-xl bg-[var(--app-secondary-bg)] px-3 py-2 text-[var(--app-fg)] shadow-sm'

    if (isCliOutput) {
        return (
            <MessagePrimitive.Root className="px-1 min-w-0 max-w-full overflow-x-hidden">
                <div className="ml-auto w-full max-w-[92%]">
                    <CliOutputBlock text={cliText} />
                    <div className="mt-1 flex justify-end">
                        <MessageTimestamp value={createdAt} />
                    </div>
                </div>
            </MessagePrimitive.Root>
        )
    }

    if (skillInfo) {
        return (
            <MessagePrimitive.Root className="px-1 min-w-0 max-w-full overflow-x-hidden">
                <Card className="overflow-hidden shadow-sm cursor-pointer select-none" onClick={() => setSkillExpanded(v => !v)}>
                    <CardHeader className="p-3 space-y-0">
                        <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0 flex items-center gap-2">
                                <div className="shrink-0 flex h-3.5 w-3.5 items-center justify-center text-[var(--app-hint)] leading-none">
                                    <BulbIcon className="h-3.5 w-3.5" />
                                </div>
                                <CardTitle className="min-w-0 text-sm font-medium leading-tight break-words">
                                    Skill 指令已加载
                                </CardTitle>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <CardDescription className="text-xs">{skillInfo.skillName}</CardDescription>
                                <span className={`text-[var(--app-hint)] transition-transform ${skillExpanded ? 'rotate-180' : ''}`}>▾</span>
                            </div>
                        </div>
                    </CardHeader>
                    {skillExpanded && (
                        <div className="border-t border-[var(--app-divider)] px-3 py-2 text-xs text-[var(--app-hint)] max-h-[300px] overflow-y-auto whitespace-pre-wrap break-words">
                            {text}
                        </div>
                    )}
                </Card>
            </MessagePrimitive.Root>
        )
    }

    if (isCompact) {
        return (
            <MessagePrimitive.Root className="px-1 min-w-0 max-w-full overflow-x-hidden">
                <Card className="overflow-hidden shadow-sm cursor-pointer select-none" onClick={() => setCompactExpanded(v => !v)}>
                    <CardHeader className="p-3 space-y-0">
                        <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0 flex items-center gap-2">
                                <div className="shrink-0 flex h-3.5 w-3.5 items-center justify-center text-[var(--app-hint)] leading-none">
                                    <ClipboardIcon className="h-3.5 w-3.5" />
                                </div>
                                <CardTitle className="min-w-0 text-sm font-medium leading-tight break-words">
                                    上下文已压缩
                                </CardTitle>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                <CardDescription className="text-xs">Compact</CardDescription>
                                <span className={`text-[var(--app-hint)] transition-transform ${compactExpanded ? 'rotate-180' : ''}`}>▾</span>
                            </div>
                        </div>
                    </CardHeader>
                    {compactExpanded && (
                        <div className="border-t border-[var(--app-divider)] px-3 py-2 text-xs text-[var(--app-hint)] max-h-[300px] overflow-y-auto whitespace-pre-wrap break-words">
                            {text}
                        </div>
                    )}
                </Card>
            </MessagePrimitive.Root>
        )
    }

    const hasText = text.length > 0
    const hasAttachments = attachments && attachments.length > 0
    const isLong = text.length > 200

    return (
        <MessagePrimitive.Root className={userBubbleClass}>
            <div className="flex items-end gap-2">
                <div className="flex-1 min-w-0">
                    {hasText && (
                        isLong ? (
                            <div>
                                {expanded
                                    ? <LazyRainbowText text={text} />
                                    : <div className="line-clamp-5 whitespace-pre-wrap break-words">{text}</div>
                                }
                                <button
                                    type="button"
                                    onClick={() => setExpanded(v => !v)}
                                    className="mt-1 text-xs text-[var(--app-hint)] hover:text-[var(--app-fg)]"
                                >
                                    {expanded ? '收起' : `展开全文 (${text.length} 字)`}
                                </button>
                            </div>
                        ) : (
                            <LazyRainbowText text={text} />
                        )
                    )}
                    {hasAttachments && <MessageAttachments attachments={attachments} />}
                </div>
                {status ? (
                    <div className="shrink-0 self-end pb-0.5">
                        <MessageStatusIndicator status={status} onRetry={onRetry} />
                    </div>
                ) : null}
            </div>
            <div className="mt-1 flex justify-end">
                <MessageTimestamp value={createdAt} />
            </div>
        </MessagePrimitive.Root>
    )
})
