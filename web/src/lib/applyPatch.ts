import { isObject } from '@hapi/protocol'

export function extractApplyPatchText(input: unknown): string | null {
    if (typeof input === 'string') {
        return input.length > 0 ? input : null
    }

    if (!isObject(input)) return null

    const patch = input.patch
    return typeof patch === 'string' && patch.length > 0 ? patch : null
}

export function extractApplyPatchFiles(input: unknown): string[] {
    const patch = extractApplyPatchText(input)
    if (!patch) return []

    const matches = patch.matchAll(/^\*\*\* (?:Update|Add|Delete) File: (.+)$/gm)
    const files: string[] = []
    for (const match of matches) {
        const file = match[1]?.trim()
        if (!file || files.includes(file)) continue
        files.push(file)
    }

    return files
}
