import { useState, useEffect, useCallback } from 'react'
import { Timeline, Input } from '@arco-design/web-react'
import type { ApiClient } from '@/api/client'
import { useGitTags } from '@/hooks/queries/useGitTags'
import { useTranslation } from '@/lib/use-translation'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { notify } from '@/lib/notify'

type TagsTabProps = {
    api: ApiClient
    sessionId: string
    onRefresh: () => void
}

export function TagsTab({ api, sessionId, onRefresh: _onRefresh }: TagsTabProps) {
    const { t } = useTranslation()
    const [tagSearchInput, setTagSearchInput] = useState('')
    const [debouncedTagKeyword, setDebouncedTagKeyword] = useState('')
    const [deleteTagTarget, setDeleteTagTarget] = useState<string | null>(null)
    const [deleteTagLoading, setDeleteTagLoading] = useState(false)

    // Debounce keyword input
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedTagKeyword(tagSearchInput.trim()), 300)
        return () => clearTimeout(timer)
    }, [tagSearchInput])

    const { tags, isLoading: tagsLoading, refetch: refetchTags } = useGitTags(api, sessionId, debouncedTagKeyword || undefined)

    const handleDeleteTag = useCallback(async () => {
        if (!deleteTagTarget) return
        setDeleteTagLoading(true)
        const res = await api.gitTagDelete(sessionId, deleteTagTarget)
        setDeleteTagLoading(false)
        if (res.success) {
            setDeleteTagTarget(null)
            notify.success(t('notify.git.tagDeleteOk'))
            refetchTags()
        } else {
            notify.error(res.stderr ?? res.error ?? 'Delete tag failed')
        }
    }, [api, sessionId, deleteTagTarget, t, refetchTags])

    return (
        <div className="flex flex-col h-full">
            {/* Search input bar */}
            <div className="px-3 py-2 border-b border-[var(--app-divider)] shrink-0">
                <Input.Search
                    value={tagSearchInput}
                    onChange={(val: string) => setTagSearchInput(val)}
                    placeholder={t('git.searchTags')}
                    allowClear
                    size="small"
                />
            </div>
            {/* Tags list */}
            <div className="flex-1 overflow-y-auto">
                {tagsLoading ? (
                    <div className="flex justify-center py-4">
                        <span className="w-5 h-5 border-2 border-[var(--app-link)] border-t-transparent rounded-full animate-spin" />
                    </div>
                ) : tags.length === 0 ? (
                    <div className="text-center text-sm text-[var(--app-hint)] py-8">{t('git.noTags')}</div>
                ) : (
                    <Timeline className="px-4 pt-3 pb-1">
                        {tags.map(tag => (
                            <Timeline.Item key={tag.name} dotColor="var(--app-badge-success-text)">
                                <div className="flex items-center gap-3">
                                    <div className="flex-1 min-w-0">
                                        <div className="text-sm text-[var(--app-fg)] font-medium truncate">{tag.name}</div>
                                        <div className="text-xs text-[var(--app-hint)] mt-0.5 flex items-center gap-1">
                                            {tag.author && <><span>{tag.author}</span><span>·</span></>}
                                            <span className="font-mono">{tag.short}</span>
                                            {tag.subject && <><span>·</span><span className="truncate">{tag.subject}</span></>}
                                        </div>
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => setDeleteTagTarget(tag.name)}
                                        className="shrink-0 text-xs text-red-500 hover:bg-[var(--app-subtle-bg)] px-2 py-1 rounded-md transition-colors"
                                    >
                                        {t('git.deleteTag')}
                                    </button>
                                </div>
                            </Timeline.Item>
                        ))}
                    </Timeline>
                )}
            </div>
            {/* Delete tag confirm */}
            <ConfirmDialog
                isOpen={deleteTagTarget !== null}
                onClose={() => setDeleteTagTarget(null)}
                title={t('dialog.git.deleteTag.title')}
                description={t('dialog.git.deleteTag.description', { name: deleteTagTarget ?? '' })}
                confirmLabel={t('dialog.git.deleteTag.confirm')}
                confirmingLabel={t('dialog.git.deleteTag.confirming')}
                onConfirm={handleDeleteTag}
                isPending={deleteTagLoading}
                destructive
            />
        </div>
    )
}
