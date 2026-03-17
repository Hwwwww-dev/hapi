import type { SessionSummary } from '@/types/api'

export const SESSION_AGENT_TABS = ['claude', 'codex', 'cursor'] as const

export type SessionAgentTab = (typeof SESSION_AGENT_TABS)[number]
export type SessionAgentSearch = { agent?: SessionAgentTab }

export function isCodexFamilyFlavor(flavor?: string | null): boolean {
    return flavor === 'codex' || flavor === 'gemini' || flavor === 'opencode'
}

export function isClaudeFlavor(flavor?: string | null): boolean {
    return flavor === 'claude'
}

export function isCursorFlavor(flavor?: string | null): boolean {
    return flavor === 'cursor'
}

export function isKnownFlavor(flavor?: string | null): boolean {
    return isClaudeFlavor(flavor) || isCodexFamilyFlavor(flavor) || isCursorFlavor(flavor)
}

export function normalizeSessionAgentTab(value?: string | null): SessionAgentTab {
    return SESSION_AGENT_TABS.includes(value as SessionAgentTab) ? (value as SessionAgentTab) : 'claude'
}

export function matchesSessionAgentTab(flavor: string | null | undefined, tab: SessionAgentTab): boolean {
    return flavor === tab
}

export function filterSessionsByAgentTab(sessions: SessionSummary[], tab: SessionAgentTab): SessionSummary[] {
    return sessions.filter((session) => matchesSessionAgentTab(session.metadata?.flavor, tab))
}

export function toSessionAgentSearch(tab: SessionAgentTab): SessionAgentSearch {
    return { agent: tab }
}
