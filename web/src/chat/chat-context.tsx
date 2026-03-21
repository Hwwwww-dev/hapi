import { createContext, useContext, type ReactNode } from 'react'
import type { ChatBlock } from './types'

export interface ChatContextValue {
    /** 协调后的消息块列表 */
    blocks: ChatBlock[]
    /** 助手是否正在思考/生成 */
    isRunning: boolean
    /** 是否禁用发送（发送中或会话不活跃） */
    isDisabled: boolean
}

const ChatContext = createContext<ChatContextValue | null>(null)

export function ChatProvider(props: ChatContextValue & { children: ReactNode }) {
    const { children, ...value } = props
    return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>
}

export function useChatContext(): ChatContextValue {
    const ctx = useContext(ChatContext)
    if (!ctx) throw new Error('useChatContext must be used within a ChatProvider')
    return ctx
}
