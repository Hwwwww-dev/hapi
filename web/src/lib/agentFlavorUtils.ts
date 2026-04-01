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

const AGENT_TAB_STORAGE_KEY = 'hapi:agent-tab'

export function loadAgentTab(): SessionAgentTab {
    try {
        const stored = localStorage.getItem(AGENT_TAB_STORAGE_KEY)
        return normalizeSessionAgentTab(stored)
    } catch {
        return 'claude'
    }
}

export function saveAgentTab(tab: SessionAgentTab): void {
    try {
        localStorage.setItem(AGENT_TAB_STORAGE_KEY, tab)
    } catch {}
}

const FLAVOR_DISPLAY_NAMES: Record<string, string> = {
    claude: 'Claude Code',
    codex: 'Codex',
    cursor: 'Cursor',
    gemini: 'Gemini',
    opencode: 'OpenCode',
}

export function formatFlavorName(flavor?: string | null): string {
    const key = flavor?.trim()
    if (!key) return 'Unknown'
    return FLAVOR_DISPLAY_NAMES[key] ?? key
}

export function supportsModelChange(flavor?: string | null): boolean {
    return flavor === 'claude' || flavor === 'gemini'
}
