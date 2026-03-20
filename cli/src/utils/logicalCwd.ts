import { isAbsolute } from 'node:path'

function getAbsoluteEnvPath(name: 'HAPI_CLI_WORKDIR' | 'HAPI_INVOKED_CWD'): string | null {
    const value = process.env[name]?.trim()
    if (!value || !isAbsolute(value)) {
        return null
    }
    return value
}

export function getLogicalCwd(): string {
    return getAbsoluteEnvPath('HAPI_CLI_WORKDIR')
        ?? getAbsoluteEnvPath('HAPI_INVOKED_CWD')
        ?? process.cwd()
}
