import { memo } from 'react'
import { useAssistantState } from '@assistant-ui/react'
import { getEventPresentation, isPillEvent } from '@/chat/presentation'
import { MessageTimestamp } from '@/components/AssistantChat/messages/MessageTimestamp'
import type { HappyChatMessageMetadata } from '@/lib/assistant-runtime'

export const HappySystemMessage = memo(function HappySystemMessage() {
    const role = useAssistantState(({ message }) => message.role)
    const text = useAssistantState(({ message }) => {
        if (message.role !== 'system') return ''
        return message.content[0]?.type === 'text' ? message.content[0].text : ''
    })
    const icon = useAssistantState(({ message }) => {
        if (message.role !== 'system') return null
        const custom = message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        const event = custom?.kind === 'event' ? custom.event : undefined
        return event ? getEventPresentation(event).icon : null
    })
    const isPill = useAssistantState(({ message }) => {
        if (message.role !== 'system') return false
        const custom = message.metadata.custom as Partial<HappyChatMessageMetadata> | undefined
        const event = custom?.kind === 'event' ? custom.event : undefined
        return event ? isPillEvent(event) : false
    })
    const createdAt = useAssistantState(({ message }) => message.createdAt)

    if (role !== 'system') return null

    if (isPill) {
        return (
            <div className="py-1">
                <div className="mx-auto w-fit max-w-[92%]">
                    <div className="inline-flex items-center gap-1.5 rounded-full border border-[var(--app-divider)] bg-[var(--app-secondary-bg)] px-3 py-1 text-xs text-[var(--app-hint)]">
                        {icon ? <span aria-hidden="true">{icon}</span> : null}
                        <span>{text}</span>
                        <span aria-hidden="true">·</span>
                        <MessageTimestamp value={createdAt} className="text-[10px] text-[var(--app-hint)] opacity-80" />
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className="py-1">
            <div className="mx-auto w-fit max-w-[92%] px-2 text-center text-xs text-[var(--app-hint)] opacity-80">
                <span className="inline-flex items-center gap-1">
                    {icon ? <span aria-hidden="true">{icon}</span> : null}
                    <span>{text}</span>
                    <span aria-hidden="true">·</span>
                    <MessageTimestamp value={createdAt} className="text-[10px] text-[var(--app-hint)] opacity-80" />
                </span>
            </div>
        </div>
    )
})
