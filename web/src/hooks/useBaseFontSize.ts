import { useCallback, useEffect, useLayoutEffect, useState } from 'react'

export type BaseFontSize = 'sm' | 'md' | 'lg' | 'xl'

type TypographyScale = {
    body: string
    code: string
    caption: string
    badge: string
    chatBody: string
}

const BASE_FONT_SIZE_OPTIONS = [
    { value: 'sm', labelKey: 'settings.display.baseFontSize.small' },
    { value: 'md', labelKey: 'settings.display.baseFontSize.medium' },
    { value: 'lg', labelKey: 'settings.display.baseFontSize.large' },
    { value: 'xl', labelKey: 'settings.display.baseFontSize.extraLarge' },
] as const satisfies ReadonlyArray<{ value: BaseFontSize; labelKey: string }>

const BASE_FONT_SIZE_SCALE: Record<BaseFontSize, TypographyScale> = {
    sm: { body: '14px', code: '12px', caption: '11px', badge: '9px', chatBody: '15px' },
    md: { body: '15px', code: '13px', caption: '12px', badge: '10px', chatBody: '16px' },
    lg: { body: '16px', code: '14px', caption: '13px', badge: '11px', chatBody: '17px' },
    xl: { body: '17px', code: '15px', caption: '14px', badge: '12px', chatBody: '18px' },
}

export const DEFAULT_BASE_FONT_SIZE: BaseFontSize = 'md'

function getBaseFontSizeStorageKey(): string {
    return 'hapi-base-font-size'
}

function isBrowser(): boolean {
    return typeof window !== 'undefined' && typeof document !== 'undefined'
}

const useIsomorphicLayoutEffect = isBrowser() ? useLayoutEffect : useEffect

function safeGetItem(key: string): string | null {
    if (!isBrowser()) return null
    try {
        return localStorage.getItem(key)
    } catch {
        return null
    }
}

function safeSetItem(key: string, value: string): void {
    if (!isBrowser()) return
    try {
        localStorage.setItem(key, value)
    } catch {
        // Ignore storage errors
    }
}

function safeRemoveItem(key: string): void {
    if (!isBrowser()) return
    try {
        localStorage.removeItem(key)
    } catch {
        // Ignore storage errors
    }
}

function parseBaseFontSize(raw: string | null): BaseFontSize {
    return BASE_FONT_SIZE_OPTIONS.find(option => option.value === raw)?.value ?? DEFAULT_BASE_FONT_SIZE
}

function applyBaseFontSize(size: BaseFontSize): void {
    if (!isBrowser()) return

    const scale = BASE_FONT_SIZE_SCALE[size]
    const rootStyle = document.documentElement.style
    rootStyle.setProperty('--text-body', scale.body)
    rootStyle.setProperty('--text-code', scale.code)
    rootStyle.setProperty('--text-caption', scale.caption)
    rootStyle.setProperty('--text-badge', scale.badge)
    rootStyle.setProperty('--text-chat-body', scale.chatBody)
}

export function getBaseFontSizeOptions(): ReadonlyArray<{ value: BaseFontSize; labelKey: string }> {
    return BASE_FONT_SIZE_OPTIONS
}

export function getInitialBaseFontSize(): BaseFontSize {
    return parseBaseFontSize(safeGetItem(getBaseFontSizeStorageKey()))
}

export function initializeBaseFontSize(): void {
    applyBaseFontSize(getInitialBaseFontSize())
}

export function useBaseFontSize(): {
    baseFontSize: BaseFontSize
    setBaseFontSize: (size: BaseFontSize) => void
} {
    const [baseFontSize, setBaseFontSizeState] = useState<BaseFontSize>(getInitialBaseFontSize)

    useIsomorphicLayoutEffect(() => {
        applyBaseFontSize(baseFontSize)
    }, [baseFontSize])

    useEffect(() => {
        if (!isBrowser()) return

        const onStorage = (event: StorageEvent) => {
            if (event.key !== getBaseFontSizeStorageKey()) return
            setBaseFontSizeState(parseBaseFontSize(event.newValue))
        }

        window.addEventListener('storage', onStorage)
        return () => window.removeEventListener('storage', onStorage)
    }, [])

    const setBaseFontSize = useCallback((size: BaseFontSize) => {
        setBaseFontSizeState(size)

        if (size === DEFAULT_BASE_FONT_SIZE) {
            safeRemoveItem(getBaseFontSizeStorageKey())
        } else {
            safeSetItem(getBaseFontSizeStorageKey(), size)
        }
    }, [])

    return { baseFontSize, setBaseFontSize }
}
