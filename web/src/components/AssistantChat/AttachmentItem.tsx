import { AttachmentPrimitive, useThreadComposerAttachment } from '@assistant-ui/react'
import { IconExclamationCircleFill, IconClose } from '@arco-design/web-react/icon'
import { Spinner } from '@/components/Spinner'

export function AttachmentItem() {
    const { name, status } = useThreadComposerAttachment()
    const isUploading = status.type === 'running'
    const isError = status.type === 'incomplete'

    return (
        <AttachmentPrimitive.Root className="flex items-center gap-2 rounded-lg bg-[var(--app-subtle-bg)] px-3 py-2 text-base text-[var(--app-fg)]">
            {isUploading ? <Spinner size="sm" label={null} className="text-[var(--app-hint)]" /> : null}
            {isError ? (
                <span className="text-red-500">
                    <IconExclamationCircleFill style={{ fontSize: 16 }} />
                </span>
            ) : null}
            <span className="max-w-[150px] truncate">{name}</span>
            <AttachmentPrimitive.Remove
                className="ml-auto flex h-5 w-5 items-center justify-center rounded-md text-[var(--app-hint)] transition-colors hover:text-[var(--app-fg)]"
                aria-label="Remove attachment"
                title="Remove attachment"
            >
                <IconClose style={{ fontSize: 12 }} />
            </AttachmentPrimitive.Remove>
        </AttachmentPrimitive.Root>
    )
}
