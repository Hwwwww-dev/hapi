import { useState, useEffect, useRef, useCallback } from 'react'
import type { ApiClient } from '@/api/client'
import type { CommitEntry } from '@/types/api'
import { useGitLog } from '@/hooks/queries/useGitLog'
import { CommitRow } from './CommitRow'

type HistoryTabProps = {
    api: ApiClient
    sessionId: string
}

export function HistoryTab({ api, sessionId }: HistoryTabProps) {
    const [allCommits, setAllCommits] = useState<CommitEntry[]>([])
    const [skip, setSkip] = useState(0)
    const [hasMore, setHasMore] = useState(true)
    const { commits, isLoading } = useGitLog(api, sessionId, { limit: 50, skip })
    const scrollRef = useRef<HTMLDivElement>(null)

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

    return (
        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
            {allCommits.map(commit => (
                <CommitRow key={commit.hash} commit={commit} />
            ))}
            {isLoading && (
                <div className="flex justify-center py-4">
                    <span className="w-5 h-5 border-2 border-[var(--app-link)] border-t-transparent rounded-full animate-spin" />
                </div>
            )}
            {!hasMore && allCommits.length > 0 && (
                <div className="text-center text-xs text-[var(--app-hint)] py-4">No more commits</div>
            )}
            {!isLoading && allCommits.length === 0 && (
                <div className="text-center text-sm text-[var(--app-hint)] py-8">No commit history</div>
            )}
        </div>
    )
}
