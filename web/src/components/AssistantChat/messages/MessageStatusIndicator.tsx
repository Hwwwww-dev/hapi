import { IconExclamationCircleFill } from '@arco-design/web-react/icon'
import type { MessageStatus } from '@/types/api'

export function MessageStatusIndicator(props: {
    status?: MessageStatus
    onRetry?: () => void
}) {
    if (props.status !== 'failed') {
        return null
    }

    return (
        <span className="inline-flex items-center gap-1">
            <span className="text-red-500">
                <IconExclamationCircleFill style={{ fontSize: 14 }} />
            </span>
            {props.onRetry ? (
                <button
                    type="button"
                    onClick={props.onRetry}
                    className="text-xs text-blue-500 hover:underline"
                >
                    Retry
                </button>
            ) : null}
        </span>
    )
}
