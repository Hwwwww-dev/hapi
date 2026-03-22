import { useCallback, useEffect, useLayoutEffect, useState } from 'react'

export type BaseFontSize = 'sm' | 'md' | 'lg' | 'xl'

const BASE_FONT_SIZE_OPTIONS = [
    { value: 'sm', labelKey: 'settings.display.baseFontSize.small' },
    { value: 'md', labelKey: 'settings.display.baseFontSize.medium' },
    { value: 'lg', labelKey: 'settings.display.baseFontSize.large' },
    { value: 'xl', labelKey: 'settings.display.baseFontSize.extraLarge' },
] as const satisfies ReadonlyArray<{ value: BaseFontSize; labelKey: string }>

const BASE_FONT_SIZE_SCALE: Record<BaseFontSize, number> = {
    sm: 0.7,
    md: 1,
    lg: 1.2,
    xl: 1.5,
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
    document.documentElement.style.setProperty('--app-ui-scale', String(BASE_FONT_SIZE_SCALE[size]))
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
