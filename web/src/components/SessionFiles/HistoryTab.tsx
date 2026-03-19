import { useState, useEffect, useRef, useCallback } from 'react'
import type { ApiClient } from '@/api/client'
import type { CommitEntry } from '@/types/api'
import { useGitLog } from '@/hooks/queries/useGitLog'
import { useTranslation } from '@/lib/use-translation'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { notify } from '@/lib/notify'
import { CommitRow } from './CommitRow'

type HistoryTabProps = {
    api: ApiClient
    sessionId: string
    ahead: number
    onRefresh: () => void
}

export function HistoryTab({ api, sessionId, ahead, onRefresh }: HistoryTabProps) {
    const { t } = useTranslation()
    const [allCommits, setAllCommits] = useState<CommitEntry[]>([])
    const [skip, setSkip] = useState(0)
    const [hasMore, setHasMore] = useState(true)
    const { commits, isLoading } = useGitLog(api, sessionId, { limit: 50, skip })
    const scrollRef = useRef<HTMLDivElement>(null)
    const [uncommitTarget, setUncommitTarget] = useState<CommitEntry | null>(null)
    const [uncommitLoading, setUncommitLoading] = useState(false)

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

    return (
        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
            {allCommits.map((commit, index) => (
                <CommitRow
                    key={commit.hash}
                    commit={commit}
                    api={api}
                    sessionId={sessionId}
                    isLocal={index < ahead}
                    onUncommit={() => setUncommitTarget(commit)}
                />
            ))}
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
        </div>
    )
}
