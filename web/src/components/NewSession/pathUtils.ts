function isWindowsPlatform(platform?: string | null): boolean {
    return platform === 'win32'
}

function normalizePosixPath(path: string): string {
    if (!path.startsWith('/')) {
        return path
    }

    const collapsed = path.replace(/\/+/g, '/')
    if (collapsed.length > 1 && collapsed.endsWith('/')) {
        return collapsed.slice(0, -1)
    }
    return collapsed || '/'
}

function normalizeWindowsPath(path: string): string {
    const collapsed = path.replace(/[\\/]+/g, '\\')
    if (/^[A-Za-z]:$/.test(collapsed)) {
        return `${collapsed}\\`
    }
    if (/^[A-Za-z]:\\$/.test(collapsed)) {
        return collapsed
    }
    if (collapsed.length > 3 && collapsed.endsWith('\\')) {
        return collapsed.slice(0, -1)
    }
    return collapsed
}

function normalizePath(path: string, platform?: string | null): string {
    return isWindowsPlatform(platform)
        ? normalizeWindowsPath(path)
        : normalizePosixPath(path)
}

export function isRootPath(path: string, platform?: string | null): boolean {
    const normalized = normalizePath(path, platform)
    if (isWindowsPlatform(platform)) {
        return /^[A-Za-z]:\\$/.test(normalized)
    }
    return normalized === '/'
}

export function getParentPath(path: string, platform?: string | null): string {
    const normalized = normalizePath(path, platform)
    if (isRootPath(normalized, platform)) {
        return normalized
    }

    const separator = isWindowsPlatform(platform) ? '\\' : '/'
    const lastIndex = normalized.lastIndexOf(separator)
    if (lastIndex <= 0) {
        return isWindowsPlatform(platform) ? normalized : '/'
    }

    const parent = normalized.slice(0, lastIndex)
    if (!parent) {
        return separator
    }

    if (isWindowsPlatform(platform) && /^[A-Za-z]:$/.test(parent)) {
        return `${parent}\\`
    }

    return parent
}

export function joinChildPath(parent: string, child: string, platform?: string | null): string {
    const normalizedParent = normalizePath(parent, platform)
    const trimmedChild = child.trim()
    if (!trimmedChild) {
        return normalizedParent
    }

    const separator = isWindowsPlatform(platform) ? '\\' : '/'
    if (isRootPath(normalizedParent, platform)) {
        return isWindowsPlatform(platform)
            ? `${normalizedParent}${trimmedChild}`
            : `${normalizedParent}${trimmedChild}`
    }

    return `${normalizedParent}${separator}${trimmedChild}`
}
