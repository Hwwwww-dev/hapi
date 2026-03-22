import { memo } from 'react'
import { MarkdownText } from '@/components/assistant-ui/markdown-text'
import { Reasoning, ReasoningGroup } from '@/components/assistant-ui/reasoning'
import { MessageTimestamp } from '@/components/AssistantChat/messages/MessageTimestamp'
import { CliOutputBlock } from '@/components/CliOutputBlock'
import type { AgentTextBlock, AgentReasoningBlock, CliOutputBlock as CliOutputBlockType } from '@/chat/types'

/** 渲染 agent-text 块 */
export const HappyAssistantMessage = memo(function HappyAssistantMessage({ block }: { block: AgentTextBlock }) {
    return (
        <div className="px-1 min-w-0 max-w-full">
            <div className="flex flex-col gap-2">
                <MarkdownText text={block.text} size="chat" />
                <MessageTimestamp value={new Date(block.createdAt)} />
            </div>
        </div>
    )
})

/** 渲染 agent-reasoning 块 */
export const HappyReasoningMessage = memo(function HappyReasoningMessage({ block, isStreaming }: { block: AgentReasoningBlock; isStreaming: boolean }) {
    return (
        <div className="px-1 min-w-0 max-w-full">
            <ReasoningGroup isStreaming={isStreaming} isTruncated={block.truncated ?? false}>
                <Reasoning text={block.text} />
            </ReasoningGroup>
        </div>
    )
})

/** 渲染 cli-output 块 */
export const HappyCliOutputMessage = memo(function HappyCliOutputMessage({ block }: { block: CliOutputBlockType }) {
    const isUser = block.source === 'user'

    return (
        <div className="px-1 min-w-0 max-w-full overflow-x-hidden">
            <div className={isUser ? 'ml-auto w-full max-w-[92%]' : ''}>
                <CliOutputBlock text={block.text} />
                <div className={isUser ? 'mt-1 flex justify-end' : 'mt-1'}>
                    <MessageTimestamp value={new Date(block.createdAt)} />
                </div>
            </div>
        </div>
    )
})
