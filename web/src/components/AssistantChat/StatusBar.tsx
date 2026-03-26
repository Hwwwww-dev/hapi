import {
    getCodexCollaborationModeLabel,
    getPermissionModeLabel,
    getPermissionModeTone,
    isPermissionModeAllowedForFlavor
} from '@hapi/protocol'
import { useEffect, useMemo } from 'react'
import type { AgentState, CodexCollaborationMode, PermissionMode } from '@/types/api'
import type { ConversationStatus } from '@/realtime/types'
import { getContextBudgetTokens } from '@/chat/modelConfig'
import { useTranslation } from '@/lib/use-translation'
import { setSessionVibing, getSessionVibingMessage } from '@/lib/vibing-store'

// Vibing messages are now managed by vibing-store.ts

function WavyText({ text }: { text: string }) {
    return (
        <span className="wavy-text">
            {[...text].map((ch, i) => (
                <span key={i} style={{ animationDelay: `${i * 0.06}s` }}>{ch === ' ' ? '\u00A0' : ch}</span>
            ))}
        </span>
    )
}

function getConnectionStatus(
    active: boolean,
    thinking: boolean,
    agentState: AgentState | null | undefined,
    voiceStatus: ConversationStatus | undefined,
    vibingMessage: string | null,
    t: (key: string) => string
): { text: string; color: string; dotColor: string; isPulsing: boolean } {
    const hasPermissions = agentState?.requests && Object.keys(agentState.requests).length > 0

    // Voice connecting takes priority
    if (voiceStatus === 'connecting') {
        return {
            text: t('voice.connecting'),
            color: 'text-[#007AFF]',
            dotColor: 'bg-[#007AFF]',
            isPulsing: true
        }
    }

    if (!active) {
        return {
            text: t('misc.offline'),
            color: 'text-[#999]',
            dotColor: 'bg-[#999]',
            isPulsing: false
        }
    }

    if (hasPermissions) {
        return {
            text: t('misc.permissionRequired'),
            color: 'text-[#FF9500]',
            dotColor: 'bg-[#FF9500]',
            isPulsing: true
        }
    }

    if (thinking) {
        return {
            text: vibingMessage ?? 'thinking…',
            color: 'text-[#007AFF]',
            dotColor: 'bg-[#007AFF]',
            isPulsing: true
        }
    }

    return {
        text: t('misc.online'),
        color: 'text-[#34C759]',
        dotColor: 'bg-[#34C759]',
        isPulsing: false
    }
}

function formatTokenCount(tokens: number): string {
    if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
    if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}K`
    return `${tokens}`
}

function getContextColor(percent: number): string {
    // 0-30%: green, 30-60%: yellow/amber, 60-100%: orange→red
    if (percent <= 30) return 'text-green-500'
    if (percent <= 40) return 'text-lime-500'
    if (percent <= 50) return 'text-yellow-500'
    if (percent <= 60) return 'text-amber-500'
    if (percent <= 70) return 'text-orange-500'
    if (percent <= 80) return 'text-orange-600'
    if (percent <= 90) return 'text-red-500'
    return 'text-red-600'
}

function getContextWarning(contextSize: number, maxContextSize: number): { percent: number; label: string; color: string } | null {
    const percentageUsed = (contextSize / maxContextSize) * 100
    const usedLabel = formatTokenCount(contextSize)
    const totalLabel = formatTokenCount(maxContextSize)
    const percent = Math.min(100, Math.round(percentageUsed))

    return { percent, label: `(${usedLabel} / ${totalLabel})`, color: getContextColor(percent) }
}

export function StatusBar(props: {
    sessionId?: string | null
    active: boolean
    thinking: boolean
    agentState: AgentState | null | undefined
    contextSize?: number
    messageCount?: number
    totalMessages?: number | null
    model?: string | null
    effort?: string | null
    permissionMode?: PermissionMode
    collaborationMode?: CodexCollaborationMode
    agentFlavor?: string | null
    voiceStatus?: ConversationStatus
}) {
    const { t } = useTranslation()
    const sid = props.sessionId ?? ''

    // Sync thinking state → vibing store
    useEffect(() => {
        if (sid) setSessionVibing(sid, props.thinking)
    }, [sid, props.thinking])

    const vibingMessage = getSessionVibingMessage(sid)
    const connectionStatus = useMemo(
        () => getConnectionStatus(props.active, props.thinking, props.agentState, props.voiceStatus, vibingMessage, t),
        [props.active, props.thinking, props.agentState, props.voiceStatus, vibingMessage, t]
    )

    const contextWarning = useMemo(
        () => {
            if (props.contextSize === undefined) return null
            const maxContextSize = getContextBudgetTokens(props.model, props.agentFlavor)
            if (!maxContextSize) return null
            return getContextWarning(props.contextSize, maxContextSize)
        },
        [props.contextSize, props.model, props.agentFlavor]
    )

    const permissionMode = props.permissionMode
    const displayPermissionMode = permissionMode
        && permissionMode !== 'default'
        && isPermissionModeAllowedForFlavor(permissionMode, props.agentFlavor)
        ? permissionMode
        : null

    const permissionModeLabel = displayPermissionMode ? getPermissionModeLabel(displayPermissionMode) : null
    const permissionModeTone = displayPermissionMode ? getPermissionModeTone(displayPermissionMode) : null
    const displayCollaborationMode = props.agentFlavor === 'codex' && props.collaborationMode === 'plan'
        ? props.collaborationMode
        : null
    const collaborationModeLabel = displayCollaborationMode
        ? getCodexCollaborationModeLabel(displayCollaborationMode)
        : null

    // Effort display — show non-default effort as capsule with tone
    const effortLabel = props.effort && props.effort !== 'auto' && props.effort !== 'default'
        ? `${props.effort.charAt(0).toUpperCase()}${props.effort.slice(1)}`
        : null
    const effortTone = props.effort === 'max' ? 'danger'
        : props.effort === 'high' ? 'warning'
        : 'info'

    const hasCapsules = Boolean(collaborationModeLabel || effortLabel || displayPermissionMode)

    return (
        <div className="flex flex-wrap items-center justify-between gap-y-0.5 px-2 pb-1">
            {/* Left: connection status + context + message count */}
            <div className="flex items-baseline gap-3 shrink-0">
                <div className="flex items-center gap-1.5 shrink-0">
                    <span
                        className={`h-2 w-2 shrink-0 rounded-full ${connectionStatus.dotColor} ${connectionStatus.isPulsing ? 'animate-pulse' : ''}`}
                    />
                    <span className={`text-xs whitespace-nowrap ${connectionStatus.color}`}>
                        {connectionStatus.isPulsing ? <WavyText text={connectionStatus.text} /> : connectionStatus.text}
                    </span>
                </div>
                {contextWarning ? (
                    <span className="text-[length:var(--text-badge)] text-[var(--app-hint)] whitespace-nowrap">
                        <span className={contextWarning.color}>{contextWarning.percent}%</span> {contextWarning.label}
                    </span>
                ) : null}
                {props.totalMessages != null && props.messageCount != null ? (
                    <span className="text-[length:var(--text-badge)] text-[var(--app-hint)] tabular-nums whitespace-nowrap">
                        {t('misc.messageCount', { current: props.messageCount, total: props.totalMessages })}
                    </span>
                ) : null}
            </div>

            {/* Right: capsule badges — wrap to next line on narrow screens */}
            {hasCapsules ? (
                <div className="flex items-center gap-1.5">
                    {collaborationModeLabel ? (
                        <span className="inline-flex items-center rounded-full border border-blue-500/30 bg-blue-500/10 px-2 py-0.5 text-[length:var(--text-badge)] text-blue-500 whitespace-nowrap">
                            {collaborationModeLabel}
                        </span>
                    ) : null}
                    {effortLabel ? (
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[length:var(--text-badge)] whitespace-nowrap ${
                            effortTone === 'danger'
                                ? 'border-red-500/30 bg-red-500/10 text-red-500'
                                : effortTone === 'warning'
                                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-500'
                                    : 'border-blue-500/30 bg-blue-500/10 text-blue-500'
                        }`}>
                            ⚡ {effortLabel}
                        </span>
                    ) : null}
                    {displayPermissionMode ? (
                        <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[length:var(--text-badge)] whitespace-nowrap ${
                            permissionModeTone === 'danger'
                                ? 'border-red-500/30 bg-red-500/10 text-red-500'
                                : permissionModeTone === 'warning'
                                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-500'
                                    : permissionModeTone === 'info'
                                        ? 'border-blue-500/30 bg-blue-500/10 text-blue-500'
                                        : 'border-[var(--app-hint)]/30 bg-[var(--app-hint)]/10 text-[var(--app-hint)]'
                        }`}>
                            {permissionModeLabel}
                        </span>
                    ) : null}
                </div>
            ) : null}
        </div>
    )
}
