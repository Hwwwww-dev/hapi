import type { ChatBlock } from './types'
import { HappyAssistantMessage, HappyReasoningMessage, HappyCliOutputMessage } from '@/components/AssistantChat/messages/AssistantMessage'
import { HappyUserMessage } from '@/components/AssistantChat/messages/UserMessage'
import { HappySystemMessage } from '@/components/AssistantChat/messages/SystemMessage'
import { HappyToolMessage } from '@/components/AssistantChat/messages/ToolMessage'

/**
 * 根据 block.kind 分发渲染对应的消息组件。
 * 替代 assistant-ui 的 role → component map 机制。
 */
export function renderBlock(block: ChatBlock, isLast: boolean, isRunning: boolean) {
    switch (block.kind) {
        case 'user-text':
            return <HappyUserMessage block={block} />
        case 'agent-text':
            return <HappyAssistantMessage block={block} />
        case 'agent-reasoning':
            return <HappyReasoningMessage block={block} isStreaming={isLast && isRunning} />
        case 'cli-output':
            return <HappyCliOutputMessage block={block} />
        case 'tool-call':
            return <HappyToolMessage block={block} />
        case 'agent-event':
            return <HappySystemMessage block={block} />
        default: {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const _exhaustive: never = block
            return null
        }
    }
}
