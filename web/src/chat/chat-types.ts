/**
 * 替代 @assistant-ui/react 和 @assistant-ui/react-markdown 中的类型。
 */

/** 替代 @assistant-ui/react-markdown 的 SyntaxHighlighterProps */
export type SyntaxHighlighterProps = {
    code: string
    language: string
}

/** 替代 @assistant-ui/react-markdown 的 CodeHeaderProps */
export type CodeHeaderProps = {
    language: string
    code: string
}

/** 自建附件类型，替代 @assistant-ui/react 的 PendingAttachment/CompleteAttachment */
export type HappyAttachment = {
    id: string
    name: string
    contentType: string
    file?: File
    status: 'pending' | 'uploading' | 'complete' | 'error'
    progress?: number
    /** 上传后的服务端路径 */
    path?: string
    /** 图片预览 data URL */
    previewUrl?: string
    /** 错误信息 */
    error?: string
}
