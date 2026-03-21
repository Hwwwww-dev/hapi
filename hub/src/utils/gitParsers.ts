/**
 * Server-side git output parsers.
 * Parses raw git stdout into structured JSON for the frontend.
 */

// ─── Types ───────────────────────────────────────────────────────

export interface CommitEntry {
    hash: string
    short: string
    author: string
    email: string
    date: number
    subject: string
    body: string
}

export interface GitTagEntry {
    name: string
    hash: string
    short: string
    date: number
    subject: string
    author: string
}

export interface GitBranchEntry {
    name: string
    isCurrent: boolean
    isRemote: boolean
}

export interface GitRemoteEntry {
    name: string
    fetchUrl: string
    pushUrl: string
}

export interface StashEntry {
    index: number
    message: string
}

export interface ShowStatEntry {
    status: string   // 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U'
    path: string
    oldPath?: string // for renames
    additions: number
    deletions: number
}

export interface GitFileStatus {
    fileName: string
    filePath: string
    fullPath: string
    status: 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted'
    isStaged: boolean
    linesAdded: number
    linesRemoved: number
    oldPath?: string
}

export interface GitStatusFiles {
    stagedFiles: GitFileStatus[]
    unstagedFiles: GitFileStatus[]
    branch: string | null
    totalStaged: number
    totalUnstaged: number
    ahead: number
}

// ─── git log ─────────────────────────────────────────────────────

export function parseGitLog(stdout: string): CommitEntry[] {
    if (!stdout.trim()) return []
    return stdout.split('\x1e').map((record) => {
        const trimmed = record.trim()
        if (!trimmed) return null
        const parts = trimmed.split('\0')
        if (parts.length < 6) return null
        return {
            hash: parts[0],
            short: parts[1],
            author: parts[2],
            email: parts[3],
            date: parseInt(parts[4], 10),
            subject: parts[5],
            body: (parts[6] ?? '').trim()
        }
    }).filter((entry): entry is CommitEntry => entry !== null)
}

// ─── git tag ─────────────────────────────────────────────────────

export function parseTagList(stdout: string): GitTagEntry[] {
    return stdout.split('\n').filter(l => l.trim()).map(line => {
        const [name, hash, short, dateStr, subject, author] = line.split('\t')
        return {
            name: name ?? '',
            hash: hash ?? '',
            short: short ?? '',
            date: parseInt(dateStr ?? '0', 10),
            subject: subject ?? '',
            author: author ?? '',
        }
    })
}

// ─── git branch ──────────────────────────────────────────────────

export function parseBranchList(stdout: string, isRemote: boolean): GitBranchEntry[] {
    if (!stdout.trim()) return []
    return stdout.trim().split('\n').map((line) => {
        const name = line.trim()
        if (!name) return null
        if (name.startsWith('(')) return null
        return { name, isCurrent: false, isRemote }
    }).filter((entry): entry is GitBranchEntry => entry !== null)
}

// ─── git remote ──────────────────────────────────────────────────

export function parseRemoteList(stdout: string): GitRemoteEntry[] {
    const lines = stdout.split('\n').filter(l => l.trim())
    const map = new Map<string, { fetchUrl: string; pushUrl: string }>()
    for (const line of lines) {
        const match = line.match(/^(\S+)\t(\S+)\s+\((fetch|push)\)$/)
        if (!match) continue
        const [, name, url, type] = match
        const entry = map.get(name!) ?? { fetchUrl: '', pushUrl: '' }
        if (type === 'fetch') entry.fetchUrl = url!
        else entry.pushUrl = url!
        map.set(name!, entry)
    }
    return Array.from(map.entries()).map(([name, urls]) => ({ name, ...urls }))
}

// ─── git stash ───────────────────────────────────────────────────

export function parseStashList(stdout: string): StashEntry[] {
    if (!stdout.trim()) return []
    return stdout.trim().split('\n').map((line) => {
        const match = line.match(/^stash@\{(\d+)\}:\s*(.*)$/)
        if (!match) return null
        return { index: parseInt(match[1], 10), message: match[2] }
    }).filter((entry): entry is StashEntry => entry !== null)
}

// ─── git show-stat ───────────────────────────────────────────────

export function parseShowStat(nameStatusStdout: string, numstatStdout: string): ShowStatEntry[] {
    if (!nameStatusStdout.trim()) return []

    // Build numstat lookup: path → { additions, deletions }
    const numstatMap = new Map<string, { additions: number; deletions: number }>()
    for (const line of numstatStdout.trim().split('\n')) {
        const m = line.match(/^(\d+|-)\t(\d+|-)\t(.+)$/)
        if (!m) continue
        const filePath = m[3].includes('\t') ? m[3].split('\t').pop()! : m[3] // rename: old\tnew
        numstatMap.set(filePath, {
            additions: m[1] === '-' ? 0 : parseInt(m[1], 10),
            deletions: m[2] === '-' ? 0 : parseInt(m[2], 10),
        })
    }

    return nameStatusStdout.trim().split('\n').map((line) => {
        const trimmed = line.trim()
        if (!trimmed) return null
        const parts = trimmed.split('\t')
        if (parts.length < 2) return null
        const statusCode = parts[0].charAt(0)
        const stats = { additions: 0, deletions: 0 }
        if (statusCode === 'R' || statusCode === 'C') {
            const path = parts[2] ?? parts[1]
            const ns = numstatMap.get(path)
            if (ns) { stats.additions = ns.additions; stats.deletions = ns.deletions }
            return { status: statusCode, oldPath: parts[1], path, ...stats }
        }
        const ns = numstatMap.get(parts[1])
        if (ns) { stats.additions = ns.additions; stats.deletions = ns.deletions }
        return { status: statusCode, path: parts[1], ...stats }
    }).filter((entry): entry is ShowStatEntry => entry !== null)
}

// ─── git status --porcelain=v2 ───────────────────────────────────

const BRANCH_HEAD_REGEX = /^# branch\.head (.+)$/
const BRANCH_AB_REGEX = /^# branch\.ab \+(\d+) -(\d+)$/
const ORDINARY_REGEX = /^1 (.)(.) \S+ \S+ \S+ \S+ \S+ \S+ (.+)$/
const RENAME_REGEX = /^2 (.)(.) \S+ \S+ \S+ \S+ \S+ \S+ \S+ (.+)$/
const UNMERGED_REGEX = /^u (.)(.) \S+ \S+ \S+ \S+ \S+ \S+ \S+ \S+ (.+)$/
const UNTRACKED_REGEX = /^\? (.+)$/
const NUMSTAT_REGEX = /^(\d+|-)\t(\d+|-)\t(.+)$/

interface StatusFileEntry {
    path: string
    from?: string
    index: string
    workingDir: string
}

function parseStatusV2(output: string): { files: StatusFileEntry[]; notAdded: string[]; branchHead: string | null; ahead: number } {
    const lines = output.trim().split('\n').filter(l => l.length > 0)
    const files: StatusFileEntry[] = []
    const notAdded: string[] = []
    let branchHead: string | null = null
    let ahead = 0

    for (const line of lines) {
        {
            const m = BRANCH_HEAD_REGEX.exec(line)
            if (m) { branchHead = m[1] === '(detached)' ? `HEAD:${m[1]}` : m[1]; continue }
        }
        {
            const m = BRANCH_AB_REGEX.exec(line)
            if (m) { ahead = parseInt(m[1], 10); continue }
        }
        {
            const m = ORDINARY_REGEX.exec(line)
            if (m) { files.push({ index: m[1], workingDir: m[2], path: m[3] }); continue }
        }
        {
            const m = RENAME_REGEX.exec(line)
            if (m) {
                const pathParts = m[3].split('\t')
                files.push({ index: m[1], workingDir: m[2], path: pathParts[0], from: pathParts[1] })
                continue
            }
        }
        {
            const m = UNMERGED_REGEX.exec(line)
            if (m) { files.push({ index: m[1], workingDir: m[2], path: m[3] }); continue }
        }
        {
            const m = UNTRACKED_REGEX.exec(line)
            if (m) { notAdded.push(m[1]); continue }
        }
    }

    return { files, notAdded, branchHead, ahead }
}

interface DiffStats { [path: string]: { added: number; removed: number; binary: boolean } }

function parseNumStat(output: string): DiffStats {
    const stats: DiffStats = {}
    for (const line of output.trim().split('\n')) {
        const m = NUMSTAT_REGEX.exec(line)
        if (!m) continue
        const isBinary = m[1] === '-' || m[2] === '-'
        stats[m[3]] = {
            added: isBinary ? 0 : parseInt(m[1], 10),
            removed: isBinary ? 0 : parseInt(m[2], 10),
            binary: isBinary
        }
    }
    return stats
}

function statusLabel(code: string): GitFileStatus['status'] {
    switch (code) {
        case 'A': return 'added'
        case 'D': return 'deleted'
        case 'R': return 'renamed'
        case 'U': return 'conflicted'
        case '?': return 'untracked'
        default: return 'modified'
    }
}

function splitPath(fullPath: string): { fileName: string; filePath: string } {
    const parts = fullPath.split('/')
    return { fileName: parts[parts.length - 1] || fullPath, filePath: parts.slice(0, -1).join('/') }
}

export function buildGitStatusFiles(
    statusOutput: string,
    unstagedDiffOutput: string,
    stagedDiffOutput: string
): GitStatusFiles {
    const status = parseStatusV2(statusOutput)
    const unstagedStats = parseNumStat(unstagedDiffOutput)
    const stagedStats = parseNumStat(stagedDiffOutput)

    const stagedFiles: GitFileStatus[] = []
    const unstagedFiles: GitFileStatus[] = []

    for (const file of status.files) {
        const { fileName, filePath } = splitPath(file.path)

        if (file.index !== ' ' && file.index !== '.' && file.index !== '?') {
            const stats = stagedStats[file.path] ?? { added: 0, removed: 0, binary: false }
            stagedFiles.push({
                fileName, filePath, fullPath: file.path,
                status: statusLabel(file.index),
                isStaged: true,
                linesAdded: stats.added,
                linesRemoved: stats.removed,
                oldPath: file.from
            })
        }

        if (file.workingDir !== ' ' && file.workingDir !== '.') {
            const stats = unstagedStats[file.path] ?? { added: 0, removed: 0, binary: false }
            unstagedFiles.push({
                fileName, filePath, fullPath: file.path,
                status: statusLabel(file.workingDir),
                isStaged: false,
                linesAdded: stats.added,
                linesRemoved: stats.removed,
                oldPath: file.from
            })
        }
    }

    for (const untrackedPath of status.notAdded) {
        const cleanPath = untrackedPath.endsWith('/') ? untrackedPath.slice(0, -1) : untrackedPath
        if (untrackedPath.endsWith('/')) continue
        const { fileName, filePath } = splitPath(cleanPath)
        unstagedFiles.push({
            fileName, filePath, fullPath: cleanPath,
            status: 'untracked', isStaged: false,
            linesAdded: 0, linesRemoved: 0
        })
    }

    return {
        stagedFiles, unstagedFiles,
        branch: status.branchHead,
        totalStaged: stagedFiles.length,
        totalUnstaged: unstagedFiles.length,
        ahead: status.ahead
    }
}
