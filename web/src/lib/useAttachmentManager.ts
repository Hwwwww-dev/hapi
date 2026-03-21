import { useCallback, useEffect, useRef, useState } from 'react'
import type { ApiClient } from '@/api/client'
import type { HappyAttachment } from '@/chat/chat-types'
import type { AttachmentMetadata } from '@/types/api'
import { isImageMimeType } from '@/lib/fileAttachments'

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024
const MAX_PREVIEW_BYTES = 5 * 1024 * 1024

async function fileToBase64(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
            const result = reader.result as string
            const base64 = result.split(',')[1]
            if (!base64) {
                reject(new Error('Failed to read file'))
                return
            }
            resolve(base64)
        }
        reader.onerror = reject
        reader.readAsDataURL(file)
    })
}

async function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
            resolve(reader.result as string)
        }
        reader.onerror = reject
        reader.readAsDataURL(file)
    })
}

export interface AttachmentManager {
    attachments: HappyAttachment[]
    addAttachment: (file: File) => void
    removeAttachment: (id: string) => void
    /** 从已完成的附件中构建发送用元数据 */
    toMetadata: () => AttachmentMetadata[]
    /** 发送后清空全部附件 */
    clear: () => void
    /** 所有附件是否都已就绪（无附件也算就绪） */
    allReady: boolean
}

export function useAttachmentManager(api: ApiClient, sessionId: string, active: boolean): AttachmentManager {
    const [attachments, setAttachments] = useState<HappyAttachment[]>([])
    const cancelledRef = useRef(new Set<string>())
    const apiRef = useRef(api)
    const sessionIdRef = useRef(sessionId)

    useEffect(() => {
        apiRef.current = api
        sessionIdRef.current = sessionId
    }, [api, sessionId])

    // Reset on session change
    useEffect(() => {
        setAttachments([])
        cancelledRef.current.clear()
    }, [sessionId])

    const deleteUpload = useCallback(async (path?: string) => {
        if (!path) return
        try {
            await apiRef.current.deleteUploadFile(sessionIdRef.current, path)
        } catch {
            // Best effort cleanup
        }
    }, [])

    const addAttachment = useCallback((file: File) => {
        if (!active) return

        const id = crypto.randomUUID()
        const contentType = file.type || 'application/octet-stream'

        // Add as uploading immediately
        setAttachments(prev => [...prev, {
            id,
            name: file.name,
            contentType,
            file,
            status: 'uploading',
            progress: 0
        }])

        // Start async upload
        void (async () => {
            try {
                if (file.size > MAX_UPLOAD_BYTES) {
                    setAttachments(prev => prev.map(a =>
                        a.id === id ? { ...a, status: 'error' as const, error: 'File too large' } : a
                    ))
                    return
                }

                if (cancelledRef.current.has(id)) return

                const content = await fileToBase64(file)
                if (cancelledRef.current.has(id)) return

                setAttachments(prev => prev.map(a =>
                    a.id === id ? { ...a, progress: 50 } : a
                ))

                const result = await apiRef.current.uploadFile(sessionIdRef.current, file.name, content, contentType)
                if (cancelledRef.current.has(id)) {
                    if (result.success && result.path) {
                        void deleteUpload(result.path)
                    }
                    return
                }

                if (!result.success || !result.path) {
                    setAttachments(prev => prev.map(a =>
                        a.id === id ? { ...a, status: 'error' as const } : a
                    ))
                    return
                }

                // Generate preview URL for images under 5MB
                let previewUrl: string | undefined
                if (isImageMimeType(contentType) && file.size <= MAX_PREVIEW_BYTES) {
                    previewUrl = await fileToDataUrl(file)
                }

                setAttachments(prev => prev.map(a =>
                    a.id === id
                        ? { ...a, status: 'complete' as const, progress: 100, path: result.path, previewUrl }
                        : a
                ))
            } catch {
                if (!cancelledRef.current.has(id)) {
                    setAttachments(prev => prev.map(a =>
                        a.id === id ? { ...a, status: 'error' as const } : a
                    ))
                }
            }
        })()
    }, [active, deleteUpload])

    const removeAttachment = useCallback((id: string) => {
        cancelledRef.current.add(id)
        setAttachments(prev => {
            const target = prev.find(a => a.id === id)
            if (target?.path) {
                void deleteUpload(target.path)
            }
            return prev.filter(a => a.id !== id)
        })
    }, [deleteUpload])

    const toMetadata = useCallback((): AttachmentMetadata[] => {
        return attachments
            .filter(a => a.status === 'complete' && a.path)
            .map(a => ({
                id: a.id,
                filename: a.name,
                mimeType: a.contentType,
                size: a.file?.size ?? 0,
                path: a.path!,
                previewUrl: a.previewUrl
            }))
    }, [attachments])

    const clear = useCallback(() => {
        setAttachments([])
        cancelledRef.current.clear()
    }, [])

    const allReady = attachments.length === 0 || attachments.every(a => a.status === 'complete')

    return { attachments, addAttachment, removeAttachment, toMetadata, clear, allReady }
}
