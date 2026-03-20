import { useState, useEffect } from 'react'
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogDescription
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { useTranslation } from '@/lib/use-translation'

type ConfirmDialogProps = {
    isOpen: boolean
    onClose: () => void
    title: string
    description: string
    confirmLabel: string
    confirmingLabel: string
    onConfirm: () => Promise<void>
    isPending: boolean
    destructive?: boolean
    confirmText?: string
}

export function ConfirmDialog(props: ConfirmDialogProps) {
    const { t } = useTranslation()
    const {
        isOpen,
        onClose,
        title,
        description,
        confirmLabel,
        confirmingLabel,
        onConfirm,
        isPending,
        destructive = false,
        confirmText,
    } = props

    const [error, setError] = useState<string | null>(null)
    const [inputValue, setInputValue] = useState('')

    useEffect(() => {
        if (isOpen) {
            setError(null)
            setInputValue('')
        }
    }, [isOpen])

    const handleConfirm = async () => {
        setError(null)
        try {
            await onConfirm()
            onClose()
        } catch (err) {
            const message =
                err instanceof Error && err.message
                    ? err.message
                    : t('dialog.error.default')
            setError(message)
        }
    }

    return (
        <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
            <DialogContent className="max-w-sm">
                <DialogHeader>
                    <DialogTitle>{title}</DialogTitle>
                    <DialogDescription className="mt-2">
                        {description}
                    </DialogDescription>
                </DialogHeader>

                {confirmText && (
                    <div className="mt-3">
                        <input
                            type="text"
                            value={inputValue}
                            onChange={e => setInputValue(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && inputValue === confirmText) void handleConfirm() }}
                            autoFocus
                            className="w-full text-sm px-3 py-2 rounded border border-[var(--app-border)] bg-[var(--app-subtle-bg)] text-[var(--app-fg)] outline-none focus:border-[var(--app-link)] font-mono"
                            placeholder={t('dialog.confirmTextHint', { text: confirmText })}
                        />
                    </div>
                )}

                {error ? (
                    <div className="mt-3 rounded-md bg-red-50 p-3 text-sm text-red-600 dark:bg-red-900/20 dark:text-red-400">
                        {error}
                    </div>
                ) : null}

                <div className="mt-4 flex gap-2 justify-end">
                    <Button
                        type="button"
                        variant="secondary"
                        onClick={onClose}
                        disabled={isPending}
                    >
                        {t('button.cancel')}
                    </Button>
                    <Button
                        type="button"
                        variant={destructive ? 'destructive' : 'secondary'}
                        onClick={handleConfirm}
                        disabled={isPending || (confirmText !== undefined && inputValue !== confirmText)}
                    >
                        {isPending ? confirmingLabel : confirmLabel}
                    </Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}
