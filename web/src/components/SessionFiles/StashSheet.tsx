import { useState } from 'react'
import { Drawer } from '@arco-design/web-react'
import type { ApiClient } from '@/api/client'
import { useGitStashList } from '@/hooks/queries/useGitStashList'
import { notify } from '@/lib/notify'
import { useTranslation } from '@/lib/use-translation'

type StashSheetProps = {
    api: ApiClient
    sessionId: string
    open: boolean
    onClose: () => void
    onStashChanged: () => void
}

export function StashSheet({ api, sessionId, open, onClose, onStashChanged }: StashSheetProps) {
    const { t } = useTranslation()
    const [stashMessage, setStashMessage] = useState('')
    const [actionLoading, setActionLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    const { stashes, refetch } = useGitStashList(api, sessionId)

    const handleStash = async () => {
        setActionLoading(true)
        setError(null)
        const res = await api.gitStash(sessionId, stashMessage.trim() || undefined)
        setActionLoading(false)
        if (res.success) {
            setStashMessage('')
            onStashChanged()
            refetch()
            notify.success(t('notify.git.stashSaved'))
        } else {
            const msg = res.stderr ?? res.error ?? t('git.stashFailed')
            setError(msg)
            notify.error(msg)
        }
    }

    const handlePop = async (index: number) => {
        setActionLoading(true)
        setError(null)
        const res = await api.gitStashPop(sessionId, index)
        setActionLoading(false)
        if (res.success) {
            onStashChanged()
            refetch()
            notify.success(t('notify.git.stashPopped'))
        } else {
            const msg = res.stderr ?? res.error ?? t('git.stashPopFailed')
            setError(msg)
            notify.error(msg)
        }
    }

    const handleApply = async (index: number) => {
        setActionLoading(true)
        setError(null)
        const res = await api.gitStashApply(sessionId, index)
        setActionLoading(false)
        if (res.success) {
            onStashChanged()
            notify.success(t('notify.git.stashApplied'))
        } else {
            const msg = res.stderr ?? res.error ?? t('git.stashApplyFailed')
            setError(msg)
            notify.error(msg)
        }
    }

    const handleDrop = async (index: number) => {
        setActionLoading(true)
        setError(null)
        const res = await api.gitStashDrop(sessionId, index)
        setActionLoading(false)
        if (res.success) {
            refetch()
            notify.success(t('notify.git.stashDropped'))
        } else {
            const msg = res.stderr ?? res.error ?? t('git.stashDropFailed')
            setError(msg)
            notify.error(msg)
        }
    }

    return (
        <Drawer
            visible={open}
            onCancel={onClose}
            title={t('git.stash')}
            placement="bottom"
            height="60vh"
            footer={null}
            headerStyle={{ borderBottom: '1px solid var(--app-divider)' }}
            bodyStyle={{ padding: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}
        >
            {/* Push section */}
            <div className="px-4 py-3 border-b border-[var(--app-divider)] flex flex-col gap-2">
                <input
                    type="text"
                    value={stashMessage}
                    onChange={e => setStashMessage(e.target.value)}
                    placeholder={t('git.stashOptionalMsg')}
                    className="text-xs border border-[var(--app-border)] rounded-md p-2 bg-[var(--app-bg)] text-[var(--app-fg)] placeholder:text-[var(--app-hint)] focus:outline-none focus:border-[var(--app-link)]"
                />
                {error && <div className="text-xs text-red-500">{error}</div>}
                <button
                    type="button"
                    onClick={handleStash}
                    disabled={actionLoading}
                    className="min-h-[44px] text-sm px-3 rounded-md bg-[var(--app-button)] text-[var(--app-button-text)] disabled:opacity-40 hover:opacity-90 transition-opacity"
                >
                    {actionLoading ? t('git.stashWorking') : t('git.stashChanges')}
                </button>
            </div>

            {/* List section */}
            <div className="overflow-y-auto flex-1">
                {stashes.length === 0 ? (
                    <div className="px-4 py-6 text-xs text-[var(--app-hint)] text-center">{t('git.noStashes')}</div>
                ) : (
                    stashes.map(entry => (
                        <div
                            key={entry.index}
                            className="flex items-center justify-between px-4 py-2 border-b border-[var(--app-divider)] last:border-0"
                        >
                            <div className="flex flex-col gap-0.5 min-w-0 flex-1 mr-2">
                                <span className="text-xs text-[var(--app-hint)]">stash@{`{${entry.index}}`}</span>
                                <span className="text-xs text-[var(--app-fg)] truncate">{entry.message}</span>
                            </div>
                            <div className="flex gap-1 shrink-0">
                                <button
                                    type="button"
                                    onClick={() => handlePop(entry.index)}
                                    disabled={actionLoading}
                                    className="min-h-[32px] text-xs px-2 rounded-md border border-[var(--app-border)] text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] disabled:opacity-40 transition-colors"
                                >
                                    {t('git.stashPop')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleApply(entry.index)}
                                    disabled={actionLoading}
                                    className="min-h-[32px] text-xs px-2 rounded-md border border-[var(--app-border)] text-[var(--app-fg)] hover:bg-[var(--app-subtle-bg)] disabled:opacity-40 transition-colors"
                                >
                                    {t('git.stashApply')}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleDrop(entry.index)}
                                    disabled={actionLoading}
                                    className="min-h-[32px] text-xs px-2 rounded-md border border-[var(--app-border)] text-red-500 hover:bg-red-500/10 disabled:opacity-40 transition-colors"
                                >
                                    {t('git.stashDrop')}
                                </button>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </Drawer>
    )
}
