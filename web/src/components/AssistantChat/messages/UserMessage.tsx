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
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'
import { CopyIcon, CheckIcon } from '@/components/icons'

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

/** Unified XML tag parser for native Claude Code messages */
const NATIVE_TAG_PATTERN = '(?:command-(?:name|message|args)|bash-(?:input|stdout|stderr)|local-command-[a-z-]+)'
const NATIVE_TAG_CHECK_REGEX = new RegExp(`<${NATIVE_TAG_PATTERN}>`, 'i')
const NATIVE_TAG_REGEX = new RegExp(`<(${NATIVE_TAG_PATTERN})>([\\s\\S]*?)<\\/\\1>`, 'gi')

function extractNativeTags(text: string): Record<string, string> | null {
    if (!NATIVE_TAG_CHECK_REGEX.test(text)) return null
    const tags: Record<string, string> = {}
    for (const match of text.matchAll(NATIVE_TAG_REGEX)) {
        tags[match[1].toLowerCase()] = match[2].trim()
    }
    return Object.keys(tags).length > 0 ? tags : null
}

/** Detect special native system-like messages (interruptions, continuations, slash commands, bash) */
function parseSystemLikeMessage(text: string): { icon: string; label: string } | null {
    const trimmed = text.trim()
    if (trimmed === '[Request interrupted by user]') {
        return { icon: '⏹', label: 'Request interrupted' }
    }
    if (trimmed === 'Continue from where you left off.') {
        return { icon: '▶', label: 'Continued conversation' }
    }
    const tags = extractNativeTags(trimmed)
    if (!tags) return null
    // Slash commands: <command-name>/cost</command-name>
    if (tags['command-name']) {
        const cmdName = tags['command-name']
        const cmdMsg = tags['command-message']
        const label = cmdMsg && cmdMsg !== cmdName.replace(/^\//, '')
            ? `${cmdName} ${cmdMsg}`
            : cmdName
        return { icon: '⚡', label }
    }
    // Shell commands: <bash-input>git push</bash-input>
    if (tags['bash-input']) {
        const cmd = tags['bash-input'].split('\n')[0]
        const stdout = tags['bash-stdout']
        const stderr = tags['bash-stderr']
        const output = stdout || stderr || null
        const shortOutput = output ? output.split('\n')[0].slice(0, 60) : null
        const label = shortOutput ? `$ ${cmd} → ${shortOutput}` : `$ ${cmd}`
        return { icon: '💻', label }
    }
    // Bare caveat/system tags without recognized content
    return { icon: '📋', label: 'System event' }
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
    const systemLikeInfo = !skillInfo && !isCompact ? parseSystemLikeMessage(text) : null
    const [skillExpanded, setSkillExpanded] = useState(false)
    const [compactExpanded, setCompactExpanded] = useState(false)
    const [expanded, setExpanded] = useState(false)
    const { copied, copy } = useCopyToClipboard()

    if (role !== 'user') return null
    const canRetry = status === 'failed' && typeof localId === 'string' && Boolean(ctx.onRetryMessage)
    const onRetry = canRetry ? () => ctx.onRetryMessage!(localId) : undefined

    if (systemLikeInfo) {
        return (
            <div className="py-1">
                <div className="mx-auto w-fit max-w-[92%]">
                    <div className="inline-flex items-center gap-1.5 rounded-full border border-[var(--app-divider)] bg-[var(--app-secondary-bg)] px-3 py-1 text-xs text-[var(--app-hint)]">
                        <span aria-hidden="true">{systemLikeInfo.icon}</span>
                        <span>{systemLikeInfo.label}</span>
                        <span aria-hidden="true">·</span>
                        <MessageTimestamp value={createdAt} className="text-[10px] text-[var(--app-hint)] opacity-80" />
                    </div>
                </div>
            </div>
        )
    }

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
        <div className="group/user ml-auto w-fit min-w-0 max-w-[92%]">
            <MessagePrimitive.Root className="rounded-xl bg-[var(--app-secondary-bg)] px-3 py-2 text-[var(--app-fg)] shadow-sm">
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
            </MessagePrimitive.Root>
            <div className="mt-1 flex items-center justify-end gap-2">
                {hasText && (
                    <button
                        type="button"
                        onClick={() => copy(text)}
                        className="rounded p-0.5 text-[var(--app-hint)] opacity-60 hover:opacity-100 hover:text-[var(--app-fg)]"
                        title="Copy"
                    >
                        {copied ? <CheckIcon className="h-3 w-3" /> : <CopyIcon className="h-3 w-3" />}
                    </button>
                )}
                <MessageTimestamp value={createdAt} />
            </div>
        </div>
    )
})
