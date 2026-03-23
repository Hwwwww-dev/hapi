import { useEffect, useMemo, useState } from 'react'
import { Input } from '@arco-design/web-react'
import type { ApiClient } from '@/api/client'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useCreateMachineDirectory } from '@/hooks/mutations/useCreateMachineDirectory'
import { useMachineDirectory } from '@/hooks/queries/useMachineDirectory'
import { useTranslation } from '@/lib/use-translation'
import { getParentPath, isRootPath, joinChildPath } from './pathUtils'

export function DirectoryPickerDialog(props: {
    api: ApiClient | null
    machineId: string | null
    machinePlatform?: string | null
    initialPath: string | null
    open: boolean
    onOpenChange: (open: boolean) => void
    onSelect: (path: string) => void
}) {
    const { t } = useTranslation()
    const [currentPath, setCurrentPath] = useState<string | null>(props.initialPath)
    const [newDirectoryName, setNewDirectoryName] = useState('')
    const [localError, setLocalError] = useState<string | null>(null)
    const [filterText, setFilterText] = useState('')
    const [showHidden, setShowHidden] = useState(false)

    useEffect(() => {
        if (props.open) {
            setCurrentPath(props.initialPath)
            setNewDirectoryName('')
            setLocalError(null)
            setFilterText('')
        }
    }, [props.open, props.initialPath])

    // Reset filter when navigating to a different directory
    useEffect(() => {
        setFilterText('')
    }, [currentPath])

    const { entries, error, isLoading, refetch } = useMachineDirectory(
        props.api,
        props.machineId,
        currentPath,
        { enabled: props.open && Boolean(currentPath) }
    )
    const {
        createMachineDirectory,
        isPending: isCreating,
        error: createError
    } = useCreateMachineDirectory(props.api)

    const directories = useMemo(() => {
        let dirs = entries.filter((entry) => entry.type === 'directory')

        // Hide dotfiles unless toggled on
        if (!showHidden) {
            dirs = dirs.filter((entry) => !entry.name.startsWith('.'))
        }

        // Apply search filter
        if (filterText.trim()) {
            const lowered = filterText.trim().toLowerCase()
            dirs = dirs.filter((entry) => entry.name.toLowerCase().includes(lowered))
        }

        return dirs
    }, [entries, showHidden, filterText])

    const hiddenCount = useMemo(() => {
        if (showHidden) return 0
        return entries.filter((e) => e.type === 'directory' && e.name.startsWith('.')).length
    }, [entries, showHidden])

    const isRoot = currentPath ? isRootPath(currentPath, props.machinePlatform) : true
    const effectiveError = localError ?? createError ?? error

    async function handleCreateDirectory(event: React.FormEvent) {
        event.preventDefault()
        if (!props.machineId || !currentPath) return

        setLocalError(null)
        const result = await createMachineDirectory({
            machineId: props.machineId,
            parentPath: currentPath,
            name: newDirectoryName
        })

        if (!result.success) {
            setLocalError(result.error ?? t('newSession.directoryPicker.createFailed'))
            return
        }

        const nextPath = result.path ?? joinChildPath(currentPath, newDirectoryName, props.machinePlatform)
        setNewDirectoryName('')
        setCurrentPath(nextPath)
        await refetch()
    }

    function handleSelectCurrent() {
        if (!currentPath) return
        props.onSelect(currentPath)
    }

    function handleGoUp() {
        if (!currentPath || isRoot) return
        setCurrentPath(getParentPath(currentPath, props.machinePlatform))
        setLocalError(null)
    }

    return (
        <Dialog open={props.open} onOpenChange={props.onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>{t('newSession.directoryPicker.title')}</DialogTitle>
                    <DialogDescription>{t('newSession.directoryPicker.description')}</DialogDescription>
                </DialogHeader>

                {!props.machineId || !props.initialPath ? (
                    <div className="rounded-md bg-amber-500/10 p-3 text-sm text-amber-700">
                        {t('newSession.directoryPicker.unavailable')}
                    </div>
                ) : (
                    <div className="mt-4 flex flex-col gap-4">
                        <div className="flex items-center justify-between gap-2">
                            <div className="min-w-0">
                                <div className="text-xs text-[var(--app-hint)]">
                                    {t('newSession.directoryPicker.currentPath')}
                                </div>
                                <div className="truncate text-sm font-medium">{currentPath}</div>
                            </div>
                            <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                onClick={handleGoUp}
                                disabled={!currentPath || isRoot}
                            >
                                {t('newSession.directoryPicker.up')}
                            </Button>
                        </div>

                        <div className="flex gap-2 items-center">
                            <Input
                                placeholder={t('newSession.directoryPicker.filterPlaceholder')}
                                value={filterText}
                                onChange={(val) => setFilterText(val)}
                                size="small"
                                allowClear
                            />
                            <button
                                type="button"
                                onClick={() => setShowHidden((v) => !v)}
                                className={`shrink-0 rounded-md px-2 py-1 text-xs transition-colors ${
                                    showHidden
                                        ? 'bg-[var(--app-button)] text-[var(--app-button-text)]'
                                        : 'bg-[var(--app-subtle-bg)] text-[var(--app-hint)] hover:bg-[var(--app-secondary-bg)]'
                                }`}
                                title={showHidden
                                    ? t('newSession.directoryPicker.hideHidden')
                                    : t('newSession.directoryPicker.showHidden')
                                }
                            >
                                {showHidden ? t('newSession.directoryPicker.hideHidden') : t('newSession.directoryPicker.showHidden')}
                                {!showHidden && hiddenCount > 0 ? ` (${hiddenCount})` : ''}
                            </button>
                        </div>

                        <form onSubmit={handleCreateDirectory} className="flex flex-col gap-2">
                            <label className="text-xs font-medium text-[var(--app-hint)]" htmlFor="new-session-picker-name">
                                {t('newSession.directoryPicker.newName')}
                            </label>
                            <div className="flex gap-2">
                                <Input
                                    id="new-session-picker-name"
                                    value={newDirectoryName}
                                    onChange={(val) => setNewDirectoryName(val)}
                                    placeholder={t('newSession.directoryPicker.newPlaceholder')}
                                    className="w-full"
                                    disabled={isCreating}
                                />
                                <Button type="submit" disabled={!newDirectoryName.trim() || isCreating || !currentPath}>
                                    {isCreating ? t('newSession.directoryPicker.creatingDir') : t('newSession.directoryPicker.createAndEnter')}
                                </Button>
                            </div>
                        </form>

                        {effectiveError ? (
                            <div className="rounded-md bg-red-500/10 p-3 text-sm text-red-600">
                                {effectiveError}
                            </div>
                        ) : null}

                        <div className="max-h-72 overflow-y-auto rounded-lg border border-[var(--app-border)]">
                            {isLoading ? (
                                <div className="p-3 text-sm text-[var(--app-hint)]">
                                    {t('newSession.directoryPicker.loading')}
                                </div>
                            ) : directories.length === 0 ? (
                                <div className="p-3 text-sm text-[var(--app-hint)]">
                                    {filterText.trim()
                                        ? t('newSession.directoryPicker.noMatch')
                                        : t('newSession.directoryPicker.empty')
                                    }
                                </div>
                            ) : (
                                directories.map((entry) => {
                                    const nextPath = currentPath
                                        ? joinChildPath(currentPath, entry.name, props.machinePlatform)
                                        : entry.name
                                    return (
                                        <button
                                            key={nextPath}
                                            type="button"
                                            onClick={() => {
                                                setCurrentPath(nextPath)
                                                setLocalError(null)
                                            }}
                                            className="flex w-full items-center justify-between border-b border-[var(--app-divider)] px-3 py-2 text-left text-sm last:border-b-0 hover:bg-[var(--app-subtle-bg)]"
                                        >
                                            <span>{entry.name}</span>
                                        </button>
                                    )
                                })
                            )}
                        </div>

                        <div className="flex justify-end gap-2">
                            <Button
                                type="button"
                                variant="secondary"
                                onClick={() => props.onOpenChange(false)}
                            >
                                {t('button.cancel')}
                            </Button>
                            <Button
                                type="button"
                                onClick={handleSelectCurrent}
                                disabled={!currentPath}
                            >
                                {t('newSession.directoryPicker.selectCurrent')}
                            </Button>
                        </div>
                    </div>
                )}
            </DialogContent>
        </Dialog>
    )
}
