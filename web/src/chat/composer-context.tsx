import { createContext, useContext, type ReactNode } from 'react'
import type { HappyAttachment } from './chat-types'

export interface ComposerContextValue {
    /** 输入框文本 */
    text: string
    /** 设置输入框文本 */
    setText: (text: string) => void
    /** 当前附件列表 */
    attachments: HappyAttachment[]
    /** 添加附件 */
    addAttachment: (file: File) => void
    /** 移除附件 */
    removeAttachment: (id: string) => void
    /** 发送消息（附件由内部自动获取） */
    send: (text: string) => void
    /** 取消当前运行 */
    cancelRun: () => void
}

const ComposerContext = createContext<ComposerContextValue | null>(null)

export function ComposerProvider(props: { value: ComposerContextValue; children: ReactNode }) {
    return <ComposerContext.Provider value={props.value}>{props.children}</ComposerContext.Provider>
}

export function useComposerContext(): ComposerContextValue {
    const ctx = useContext(ComposerContext)
    if (!ctx) throw new Error('useComposerContext must be used within a ComposerProvider')
    return ctx
}
