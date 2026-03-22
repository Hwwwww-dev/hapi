import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { Select, Timeline, Input, DatePicker } from '@arco-design/web-react'
import type { RefInputType } from '@arco-design/web-react/es/Input'
import type { ApiClient } from '@/api/client'
import type { CommitEntry } from '@/types/api'
import { useGitLog } from '@/hooks/queries/useGitLog'
import { useGitTags } from '@/hooks/queries/useGitTags'
import { useGitBranches } from '@/hooks/queries/useGitBranches'
import { useTranslation } from '@/lib/use-translation'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { notify } from '@/lib/notify'
import { CommitRow } from './CommitRow'

// --- Tag search parser ---
type ParsedSearch = { keyword?: string; author?: string; hash?: string }
const TAG_KEYS = ['keyword', 'author', 'hash'] as const

function parseSearchQuery(input: string): ParsedSearch {
    const result: ParsedSearch = {}
    const remaining: string[] = []
    // Match tokens: either tag:value, tag:"value with spaces", or plain words
    const tokens = input.match(/(?:[^\s"]+|"[^"]*")+/g) ?? []
    for (const token of tokens) {
        const colonIdx = token.indexOf(':')
        if (colonIdx > 0) {
            const key = token.slice(0, colonIdx).toLowerCase()
            const value = token.slice(colonIdx + 1).replace(/^"|"$/g, '')
            if (key === 'keyword') result.keyword = value
            else if (key === 'author') result.author = value
            else if (key === 'hash') result.hash = value
            else remaining.push(token) // unknown tag → treat as text
        } else {
            remaining.push(token)
        }
    }
    // Plain text (no tag prefix) treated as keyword
    if (remaining.length > 0 && !result.keyword) {
        result.keyword = remaining.join(' ')
    }
    return result
}

type CommitsTabProps = {
    api: ApiClient
    sessionId: string
    ahead: number
    currentBranch: string | null
    onRefresh: () => void
}

export function CommitsTab({ api, sessionId, ahead, currentBranch, onRefresh }: CommitsTabProps) {
    const { t } = useTranslation()
    const [allCommits, setAllCommits] = useState<CommitEntry[]>([])
    const [skip, setSkip] = useState(0)
    const [hasMore, setHasMore] = useState(true)
    const [selectedBranch, setSelectedBranch] = useState<string | undefined>(undefined)

    // Search / filter (debounced for backend queries)
    const [commitSearchInput, setCommitSearchInput] = useState('')
    const [debouncedSearch, setDebouncedSearch] = useState('')
    const [dateSince, setDateSince] = useState('')
    const [dateUntil, setDateUntil] = useState('')
    const [showTagHints, setShowTagHints] = useState(false)
    const searchInputRef = useRef<RefInputType>(null)

    // Debounce raw input
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearch(commitSearchInput.trim()), 300)
        return () => clearTimeout(timer)
    }, [commitSearchInput])

    // Parse debounced input into structured filters
    const parsedSearch = useMemo(() => parseSearchQuery(debouncedSearch), [debouncedSearch])

    // Reset pagination when search/date filters change
    useEffect(() => {
        setAllCommits([])
        setSkip(0)
        setHasMore(true)
    }, [debouncedSearch, dateSince, dateUntil])

    const { local: localBranches, remote: remoteBranches } = useGitBranches(api, sessionId, currentBranch)
    const { commits, isLoading } = useGitLog(api, sessionId, {
        limit: 50,
        skip,
        branch: selectedBranch,
        keyword: parsedSearch.keyword || undefined,
        author: parsedSearch.author || undefined,
        hash: parsedSearch.hash || undefined,
        since: dateSince || undefined,
        until: dateUntil || undefined,
    })
    const scrollRef = useRef<HTMLDivElement>(null)
    const [uncommitTarget, setUncommitTarget] = useState<CommitEntry | null>(null)
    const [uncommitLoading, setUncommitLoading] = useState(false)

    // Cherry-pick
    const [cherryPickTarget, setCherryPickTarget] = useState<CommitEntry | null>(null)
    const [cherryPickLoading, setCherryPickLoading] = useState(false)

    // Reset mixed
    const [resetMixedTarget, setResetMixedTarget] = useState<CommitEntry | null>(null)
    const [resetMixedLoading, setResetMixedLoading] = useState(false)

    // Reset hard
    const [resetHardTarget, setResetHardTarget] = useState<CommitEntry | null>(null)
    const [resetHardLoading, setResetHardLoading] = useState(false)
    const [resetHardInput, setResetHardInput] = useState('')

    // Create tag
    const [createTagTarget, setCreateTagTarget] = useState<CommitEntry | null>(null)
    const [tagName, setTagName] = useState('')
    const [tagMessage, setTagMessage] = useState('')
    const [createTagLoading, setCreateTagLoading] = useState(false)

    // Amend
    const [amendTarget, setAmendTarget] = useState<CommitEntry | null>(null)
    const [amendMessage, setAmendMessage] = useState('')
    const [amendLoading, setAmendLoading] = useState(false)

    // Revert
    const [revertTarget, setRevertTarget] = useState<CommitEntry | null>(null)
    const [revertLoading, setRevertLoading] = useState(false)

    // Tags (only for refetchTags after create tag)
    const { refetch: refetchTags } = useGitTags(api, sessionId, undefined)

    const handleBranchChange = useCallback((branch: string) => {
        const value = branch === '' ? undefined : branch
        setSelectedBranch(value)
        setAllCommits([])
        setSkip(0)
        setHasMore(true)
    }, [])

    useEffect(() => {
        if (commits.length > 0) {
            setAllCommits(prev => skip === 0 ? commits : [...prev, ...commits])
            setHasMore(commits.length === 50)
        } else if (!isLoading) {
            setHasMore(false)
        }
    }, [commits, skip, isLoading])

    const handleScroll = useCallback(() => {
        const el = scrollRef.current
        if (!el || isLoading || !hasMore) return
        if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
            setSkip(allCommits.length)
        }
    }, [isLoading, hasMore, allCommits.length])

    const handleUncommit = useCallback(async () => {
        if (!uncommitTarget) return
        setUncommitLoading(true)
        const res = await api.gitReset(sessionId, `${uncommitTarget.hash}~1`, 'soft')
        setUncommitLoading(false)
        if (res.success) {
            setUncommitTarget(null)
            notify.success(t('notify.git.uncommitOk'))
            setSkip(0)
            setAllCommits([])
            onRefresh()
        } else {
            notify.error(res.stderr ?? res.error ?? 'Uncommit failed')
        }
    }, [api, sessionId, uncommitTarget, t, onRefresh])

    const handleCherryPick = useCallback(async () => {
        if (!cherryPickTarget) return
        setCherryPickLoading(true)
        const res = await api.gitCherryPick(sessionId, cherryPickTarget.hash)
        setCherryPickLoading(false)
        if (res.success) {
            setCherryPickTarget(null)
            notify.success(t('notify.git.cherryPickOk'))
            setSkip(0); setAllCommits([]); onRefresh()
        } else {
            notify.error(res.stderr ?? res.error ?? 'Cherry-pick failed')
        }
    }, [api, sessionId, cherryPickTarget, t, onRefresh])

    const handleResetMixed = useCallback(async () => {
        if (!resetMixedTarget) return
        setResetMixedLoading(true)
        const res = await api.gitReset(sessionId, resetMixedTarget.hash, 'mixed')
        setResetMixedLoading(false)
        if (res.success) {
            setResetMixedTarget(null)
            notify.success(t('notify.git.resetOk'))
            setSkip(0); setAllCommits([]); onRefresh()
        } else {
            notify.error(res.stderr ?? res.error ?? 'Reset failed')
        }
    }, [api, sessionId, resetMixedTarget, t, onRefresh])

    const handleResetHard = useCallback(async () => {
        if (!resetHardTarget || resetHardInput !== 'RESET') return
        setResetHardLoading(true)
        const res = await api.gitReset(sessionId, resetHardTarget.hash, 'hard')
        setResetHardLoading(false)
        if (res.success) {
            setResetHardTarget(null); setResetHardInput('')
            notify.success(t('notify.git.resetOk'))
            setSkip(0); setAllCommits([]); onRefresh()
        } else {
            notify.error(res.stderr ?? res.error ?? 'Reset failed')
        }
    }, [api, sessionId, resetHardTarget, resetHardInput, t, onRefresh])

    const handleCreateTag = useCallback(async () => {
        if (!createTagTarget || !tagName.trim()) return
        setCreateTagLoading(true)
        const res = await api.gitTagCreate(sessionId, tagName.trim(), tagMessage.trim() || undefined, createTagTarget.hash)
        setCreateTagLoading(false)
        if (res.success) {
            setCreateTagTarget(null); setTagName(''); setTagMessage('')
            notify.success(t('notify.git.tagCreateOk'))
            refetchTags()
        } else {
            notify.error(res.stderr ?? res.error ?? 'Tag creation failed')
        }
    }, [api, sessionId, createTagTarget, tagName, tagMessage, t])

    const handleAmend = useCallback(async () => {
        if (!amendTarget || !amendMessage.trim()) return
        setAmendLoading(true)
        const res = await api.gitAmend(sessionId, amendMessage.trim())
        setAmendLoading(false)
        if (res.success) {
            setAmendTarget(null); setAmendMessage('')
            notify.success(t('notify.git.amendOk'))
            setSkip(0); setAllCommits([]); onRefresh()
        } else {
            notify.error(res.stderr ?? res.error ?? 'Amend failed')
        }
    }, [api, sessionId, amendTarget, amendMessage, t, onRefresh])

    const handleRevert = useCallback(async () => {
        if (!revertTarget) return
        setRevertLoading(true)
        const res = await api.gitRevert(sessionId, revertTarget.hash)
        setRevertLoading(false)
        if (res.success) {
            setRevertTarget(null)
            notify.success(t('notify.git.revertOk'))
            setSkip(0); setAllCommits([]); onRefresh()
        } else {
            notify.error(res.stderr ?? res.error ?? 'Revert failed')
        }
    }, [api, sessionId, revertTarget, t, onRefresh])

    return (
        <div className="flex flex-col h-full">
            {/* Branch selector */}
            {(localBranches.length > 0 || remoteBranches.length > 0) && (
                <div className="px-3 py-2 border-b border-[var(--app-divider)] shrink-0">
                    <Select
                        value={selectedBranch ?? ''}
                        onChange={(val: string) => handleBranchChange(val)}
                        className="w-full"
                        showSearch
                        filterOption={(inputValue, option) => {
                            const label = (option as { props?: { children?: React.ReactNode } }).props?.children?.toString() ?? ''
                            return label.toLowerCase().includes(inputValue.toLowerCase())
                        }}
                        getPopupContainer={(node) => node.parentElement ?? document.body}
                    >
                        <Select.Option value="">{currentBranch ? `${currentBranch} (HEAD)` : 'HEAD'}</Select.Option>
                        {localBranches.length > 0 && (
                            <Select.OptGroup label={t('git.localBranches', { n: localBranches.length })}>
                                {localBranches.filter(b => b.name !== currentBranch).map(b => (
                                    <Select.Option key={b.name} value={b.name}>{b.name}</Select.Option>
                                ))}
                            </Select.OptGroup>
                        )}
                        {remoteBranches.length > 0 && (
                            <Select.OptGroup label={t('git.remoteBranches', { n: remoteBranches.length })}>
                                {remoteBranches.map(b => (
                                    <Select.Option key={b.name} value={b.name}>{b.name}</Select.Option>
                                ))}
                            </Select.OptGroup>
                        )}
                    </Select>
                </div>
            )}
            <div className="px-3 py-1.5 border-b border-[var(--app-divider)] shrink-0 grid grid-cols-1 sm:grid-cols-10 gap-1.5">
                <div className="sm:col-span-4 relative">
                    <Input
                        ref={searchInputRef}
                        value={commitSearchInput}
                        onChange={(val: string) => {
                            setCommitSearchInput(val)
                            // Show tag hints when input is empty or cursor at a word boundary
                            setShowTagHints(val === '' || val.endsWith(' '))
                        }}
                        onFocus={() => setShowTagHints(commitSearchInput === '' || commitSearchInput.endsWith(' '))}
                        onBlur={() => setTimeout(() => setShowTagHints(false), 150)}
                        placeholder={t('git.searchCommitsTagged')}
                        allowClear
                        size="small"
                        suffix={
                            (parsedSearch.keyword || parsedSearch.author || parsedSearch.hash) ? (
                                <span className="flex items-center gap-1">
                                    {parsedSearch.keyword && <span className="inline-flex items-center rounded px-1 py-px text-[10px] font-medium bg-blue-500/15 text-blue-600">K</span>}
                                    {parsedSearch.author && <span className="inline-flex items-center rounded px-1 py-px text-[10px] font-medium bg-purple-500/15 text-purple-600">A</span>}
                                    {parsedSearch.hash && <span className="inline-flex items-center rounded px-1 py-px text-[10px] font-medium bg-amber-500/15 text-amber-600">H</span>}
                                </span>
                            ) : undefined
                        }
                    />
                    {showTagHints && (
                        <div className="absolute left-0 top-full z-20 mt-1 flex gap-1 rounded-lg border border-[var(--app-border)] bg-[var(--app-bg)] px-2 py-1.5 shadow-lg">
                            {TAG_KEYS.map(tag => (
                                <button
                                    key={tag}
                                    type="button"
                                    className="rounded-md px-2 py-0.5 text-[11px] font-mono text-[var(--app-link)] hover:bg-[var(--app-subtle-bg)] transition-colors"
                                    onMouseDown={e => {
                                        e.preventDefault()
                                        const prefix = tag + ':'
                                        setCommitSearchInput(prev => {
                                            const trimmed = prev.trimEnd()
                                            return trimmed ? trimmed + ' ' + prefix : prefix
                                        })
                                        setShowTagHints(false)
                                        setTimeout(() => searchInputRef.current?.focus(), 0)
                                    }}
                                >
                                    {tag}:
                                </button>
                            ))}
                        </div>
                    )}
                </div>
                <div className="sm:col-span-6">
                    <DatePicker.RangePicker
                        size="small"
                        className="w-full"
                        placeholder={[t('git.dateSince'), t('git.dateUntil')]}
                        onChange={(_dateStrings, dates) => {
                            if (dates && dates[0] && dates[1]) {
                                setDateSince(dates[0].format('YYYY-MM-DD'))
                                setDateUntil(dates[1].format('YYYY-MM-DD'))
                            } else {
                                setDateSince('')
                                setDateUntil('')
                            }
                        }}
                        allowClear
                        getPopupContainer={(node) => node.parentElement ?? document.body}
                    />
                </div>
            </div>
            <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
                {allCommits.length > 0 && (
                    <Timeline className="px-4 pt-3 pb-1">
                        {allCommits.map((commit, index) => {
                            const isLocal_ = !selectedBranch && index < ahead
                            return (
                                <Timeline.Item
                                    key={commit.hash}
                                    dotColor={isLocal_ ? 'var(--app-status-pending-border)' : 'var(--app-link)'}
                                >
                                    <CommitRow
                                        commit={commit}
                                        api={api}
                                        sessionId={sessionId}
                                        isLocal={isLocal_}
                                        isFirst={index === 0}
                                        onUncommit={selectedBranch ? undefined : () => setUncommitTarget(commit)}
                                        onAmend={selectedBranch ? undefined : () => { setAmendTarget(commit); setAmendMessage(commit.subject) }}
                                        onRevert={() => setRevertTarget(commit)}
                                        onCherryPick={() => setCherryPickTarget(commit)}
                                        onResetMixed={selectedBranch ? undefined : () => setResetMixedTarget(commit)}
                                        onResetHard={selectedBranch ? undefined : () => setResetHardTarget(commit)}
                                        onCreateTag={() => setCreateTagTarget(commit)}
                                        onBranchCreated={() => { setSkip(0); setAllCommits([]); onRefresh() }}
                                    />
                                </Timeline.Item>
                            )
                        })}
                    </Timeline>
                )}
                {isLoading && (
                    <div className="flex justify-center py-4">
                        <span className="w-5 h-5 border-2 border-[var(--app-link)] border-t-transparent rounded-full animate-spin" />
                    </div>
                )}
                {!hasMore && allCommits.length > 0 && (
                    <div className="text-center text-xs text-[var(--app-hint)] py-4">{t('git.noMoreCommits')}</div>
                )}
                {!isLoading && allCommits.length === 0 && (
                    <div className="text-center text-sm text-[var(--app-hint)] py-8">{t('git.noCommitHistory')}</div>
                )}
            </div>
            <ConfirmDialog
                isOpen={uncommitTarget !== null}
                onClose={() => setUncommitTarget(null)}
                title={t('dialog.git.uncommit.title')}
                description={t('dialog.git.uncommit.description', { subject: uncommitTarget?.subject ?? '' })}
                confirmLabel={t('dialog.git.uncommit.confirm')}
                confirmingLabel={t('dialog.git.uncommit.confirming')}
                onConfirm={handleUncommit}
                isPending={uncommitLoading}
                destructive
            />
            {/* Cherry-pick confirm */}
            <ConfirmDialog
                isOpen={cherryPickTarget !== null}
                onClose={() => setCherryPickTarget(null)}
                title={t('dialog.git.cherryPick.title')}
                description={t('dialog.git.cherryPick.description', { short: cherryPickTarget?.short ?? '', subject: cherryPickTarget?.subject ?? '' })}
                confirmLabel={t('dialog.git.cherryPick.confirm')}
                confirmingLabel={t('dialog.git.cherryPick.confirming')}
                onConfirm={handleCherryPick}
                isPending={cherryPickLoading}
            />
            {/* Reset mixed confirm */}
            <ConfirmDialog
                isOpen={resetMixedTarget !== null}
                onClose={() => setResetMixedTarget(null)}
                title={t('dialog.git.resetMixed.title')}
                description={t('dialog.git.resetMixed.description', { short: resetMixedTarget?.short ?? '' })}
                confirmLabel={t('dialog.git.resetMixed.confirm')}
                confirmingLabel={t('dialog.git.resetMixed.confirming')}
                onConfirm={handleResetMixed}
                isPending={resetMixedLoading}
                destructive
            />
            {/* Hard reset - 需要输入 RESET 确认 */}
            {resetHardTarget && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => { setResetHardTarget(null); setResetHardInput('') }}>
                    <div className="bg-[var(--app-bg)] rounded-xl border border-[var(--app-border)] p-6 max-w-sm w-full mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
                        <h3 className="text-base font-semibold text-[var(--app-fg)] mb-2">{t('dialog.git.resetHard.title')}</h3>
                        <p className="text-sm text-[var(--app-hint)] mb-4">{t('dialog.git.resetHard.description', { short: resetHardTarget.short })}</p>
                        <Input
                            value={resetHardInput}
                            onChange={(val: string) => setResetHardInput(val)}
                            placeholder={t('dialog.git.resetHard.inputPlaceholder')}
                            autoFocus
                            size="small"
                            className="mb-4"
                            style={{ borderColor: 'var(--app-border)' }}
                            status={resetHardInput && resetHardInput !== 'RESET' ? 'error' : undefined}
                        />
                        <div className="flex gap-2 justify-end">
                            <button type="button" onClick={() => { setResetHardTarget(null); setResetHardInput('') }} className="px-4 py-2 text-sm rounded-md border border-[var(--app-border)] text-[var(--app-hint)]">{t('button.cancel')}</button>
                            <button type="button" onClick={handleResetHard} disabled={resetHardInput !== 'RESET' || resetHardLoading} className="px-4 py-2 text-sm rounded-md bg-red-500 text-white disabled:opacity-50">{resetHardLoading ? t('dialog.git.resetHard.confirming') : t('dialog.git.resetHard.confirm')}</button>
                        </div>
                    </div>
                </div>
            )}
            {/* Create tag dialog */}
            {createTagTarget && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => { setCreateTagTarget(null); setTagName(''); setTagMessage('') }}>
                    <div className="bg-[var(--app-bg)] rounded-xl border border-[var(--app-border)] p-6 max-w-sm w-full mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
                        <h3 className="text-base font-semibold text-[var(--app-fg)] mb-2">{t('dialog.git.createTag.title')}</h3>
                        <p className="text-xs text-[var(--app-hint)] mb-3 font-mono">{createTagTarget.short}: {createTagTarget.subject}</p>
                        <Input value={tagName} onChange={(val: string) => setTagName(val)} placeholder={t('git.tagName')} autoFocus size="small" className="mb-2" />
                        <Input value={tagMessage} onChange={(val: string) => setTagMessage(val)} placeholder={t('git.tagMessage')} size="small" className="mb-4" />
                        <div className="flex gap-2 justify-end">
                            <button type="button" onClick={() => { setCreateTagTarget(null); setTagName(''); setTagMessage('') }} className="px-4 py-2 text-sm rounded-md border border-[var(--app-border)] text-[var(--app-hint)]">{t('button.cancel')}</button>
                            <button type="button" onClick={handleCreateTag} disabled={!tagName.trim() || createTagLoading} className="px-4 py-2 text-sm rounded-md bg-[var(--app-button)] text-[var(--app-button-text)] disabled:opacity-50">{createTagLoading ? t('dialog.git.deleteTag.confirming') : t('git.createTag')}</button>
                        </div>
                    </div>
                </div>
            )}
            {/* Amend commit message */}
            {amendTarget && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => { setAmendTarget(null); setAmendMessage('') }}>
                    <div className="bg-[var(--app-bg)] rounded-xl border border-[var(--app-border)] p-6 max-w-sm w-full mx-4 shadow-xl" onClick={e => e.stopPropagation()}>
                        <h3 className="text-base font-semibold text-[var(--app-fg)] mb-2">{t('dialog.git.amend.title')}</h3>
                        <p className="text-xs text-[var(--app-hint)] mb-3 font-mono">{amendTarget.short}: {amendTarget.subject}</p>
                        <Input
                            value={amendMessage}
                            onChange={(val: string) => setAmendMessage(val)}
                            placeholder={t('git.commitPlaceholder')}
                            autoFocus
                            size="small"
                            className="mb-4"
                        />
                        <div className="flex gap-2 justify-end">
                            <button type="button" onClick={() => { setAmendTarget(null); setAmendMessage('') }} className="px-4 py-2 text-sm rounded-md border border-[var(--app-border)] text-[var(--app-hint)]">{t('button.cancel')}</button>
                            <button type="button" onClick={handleAmend} disabled={!amendMessage.trim() || amendLoading} className="px-4 py-2 text-sm rounded-md bg-[var(--app-button)] text-[var(--app-button-text)] disabled:opacity-50">{amendLoading ? t('dialog.git.amend.confirming') : t('dialog.git.amend.confirm')}</button>
                        </div>
                    </div>
                </div>
            )}
            {/* Revert commit */}
            <ConfirmDialog
                isOpen={revertTarget !== null}
                onClose={() => setRevertTarget(null)}
                title={t('dialog.git.revert.title')}
                description={t('dialog.git.revert.description', { short: revertTarget?.short ?? '', subject: revertTarget?.subject ?? '' })}
                confirmLabel={t('dialog.git.revert.confirm')}
                confirmingLabel={t('dialog.git.revert.confirming')}
                onConfirm={handleRevert}
                isPending={revertLoading}
            />
        </div>
    )
}
