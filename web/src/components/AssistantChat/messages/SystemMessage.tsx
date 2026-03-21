import { memo } from 'react'
import { getEventPresentation, isPillEvent, renderEventLabel } from '@/chat/presentation'
import { MessageTimestamp } from '@/components/AssistantChat/messages/MessageTimestamp'
import type { AgentEventBlock } from '@/chat/types'

export const HappySystemMessage = memo(function HappySystemMessage({ block }: { block: AgentEventBlock }) {
    const event = block.event
    const presentation = getEventPresentation(event)
    const text = renderEventLabel(event)
    const isPill = isPillEvent(event)
    const createdAt = new Date(block.createdAt)

    if (isPill) {
        return (
            <div className="py-1">
                <div className="mx-auto w-fit max-w-[92%]">
                    <div className="inline-flex items-center gap-1.5 rounded-full border border-[var(--app-divider)] bg-[var(--app-secondary-bg)] px-3 py-1 text-xs text-[var(--app-hint)]">
                        {presentation.icon ? <span aria-hidden="true">{presentation.icon}</span> : null}
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
                    {presentation.icon ? <span aria-hidden="true">{presentation.icon}</span> : null}
                    <span>{text}</span>
                    <span aria-hidden="true">·</span>
                    <MessageTimestamp value={createdAt} className="text-[10px] text-[var(--app-hint)] opacity-80" />
                </span>
            </div>
        </div>
    )
})
