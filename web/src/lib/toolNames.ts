export function canonicalizeToolName(toolName: string): string {
    const stripped = toolName.replace(/^functions\./, '')

    if (stripped === 'hapi_change_title') {
        return 'hapi__change_title'
    }

    return stripped
}

export function isToolName(toolName: string, ...candidates: string[]): boolean {
    const canonical = canonicalizeToolName(toolName)
    return candidates.some(candidate => canonical === canonicalizeToolName(candidate))
}

export function canonicalizePermissionToolIdentifier(toolIdentifier: string): string {
    const match = toolIdentifier.match(/^([^()]+)\(([\s\S]*)\)$/)
    if (!match) {
        return canonicalizeToolName(toolIdentifier)
    }

    const [, toolName, suffix] = match
    return `${canonicalizeToolName(toolName)}(${suffix})`
}
