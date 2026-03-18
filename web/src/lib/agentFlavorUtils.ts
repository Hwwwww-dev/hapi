import type { SessionSummary } from '@/types/api'

export const SESSION_AGENT_TABS = ['online', 'claude', 'codex', 'cursor'] as const

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

/** Returns the API flavor string for a tab, or undefined for tabs that don't filter by flavor */
export function getTabFlavor(tab: SessionAgentTab): string | undefined {
    return tab === 'online' ? undefined : tab
}

/** Returns whether the tab should filter by active status */
export function getTabActive(tab: SessionAgentTab): boolean | undefined {
    return tab === 'online' ? true : undefined
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
