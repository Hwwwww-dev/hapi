import type { ToolViewComponent, ToolViewProps } from '@/components/ToolCard/views/_all'
import { type ReactNode, useCallback } from 'react'
import { isObject, safeStringify } from '@hapi/protocol'
import { CodeBlock } from '@/components/CodeBlock'
import { MarkdownRenderer } from '@/components/MarkdownRenderer'
import { ChecklistList, extractTodoChecklist } from '@/components/ToolCard/checklist'
import { canonicalizeToolName } from '@/lib/toolNames'
import { basename, resolveDisplayPath } from '@/utils/path'
import { Collapse } from '@arco-design/web-react'
import { CopyIcon, CheckIcon } from '@/components/icons'
import { useCopyToClipboard } from '@/hooks/useCopyToClipboard'

const CollapseItem = Collapse.Item

/** Wrapper that adds a hover copy button at top-right corner for text content */
function CopyableContent({ text, children }: { text: string; children: ReactNode }) {
    const { copied, copy } = useCopyToClipboard()
    const handleCopy = useCallback((e: React.MouseEvent) => {
        e.stopPropagation()
        copy(text)
    }, [text, copy])
    return (
        <div className="group/copy relative">
            {children}
            <button
                type="button"
                onClick={handleCopy}
                className="absolute right-1.5 top-1.5 rounded-md p-1 text-[var(--app-hint)] hover:bg-[var(--app-subtle-bg)] hover:text-[var(--app-fg)] transition-colors"
                title="Copy"
            >
                {copied ? <CheckIcon className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
            </button>
        </div>
    )
}

// Detect language from file extension
function detectLanguage(filePath: string | null): string {
    if (!filePath) return 'text'
    const ext = filePath.split('.').pop()?.toLowerCase() ?? ''
    const map: Record<string, string> = {
        ts: 'typescript', tsx: 'tsx', js: 'javascript', jsx: 'jsx',
        py: 'python', rs: 'rust', go: 'go', java: 'java', kt: 'kotlin',
        cs: 'csharp', cpp: 'cpp', c: 'c', h: 'c', rb: 'ruby',
        sh: 'bash', bash: 'bash', zsh: 'bash', fish: 'bash',
        json: 'json', yaml: 'yaml', yml: 'yaml', toml: 'toml',
        md: 'markdown', html: 'html', css: 'css', scss: 'scss',
        sql: 'sql', graphql: 'graphql', proto: 'protobuf',
        xml: 'xml', swift: 'swift', dart: 'dart', lua: 'lua',
    }
    return map[ext] ?? 'text'
}

// Strip cat -n style line numbers: "     1→\t" or "     1\t"
function stripLineNumbers(content: string): string {
    // Match lines starting with optional spaces, digits, then → or tab
    const lines = content.split('\n')
    const stripped = lines.map(line => line.replace(/^\s*\d+[→\t]\s?/, ''))
    // Only strip if most lines matched (avoid stripping real content)
    const matchCount = lines.filter(l => /^\s*\d+[→\t]/.test(l)).length
    if (matchCount > lines.length * 0.5) return stripped.join('\n')
    return content
}

function parseToolUseError(message: string): { isToolUseError: boolean; errorMessage: string | null } {
    const regex = /<tool_use_error>(.*?)<\/tool_use_error>/s
    const match = message.match(regex)

    if (match) {
        return {
            isToolUseError: true,
            errorMessage: typeof match[1] === 'string' ? match[1].trim() : ''
        }
    }

    return { isToolUseError: false, errorMessage: null }
}

function extractTextFromContentBlock(block: unknown): string | null {
    if (typeof block === 'string') return block
    if (!isObject(block)) return null
    if (block.type === 'text' && typeof block.text === 'string') return block.text
    if (typeof block.text === 'string') return block.text
    return null
}

export function extractTextFromResult(result: unknown, depth: number = 0): string | null {
    if (depth > 2) return null
    if (result === null || result === undefined) return null
    if (typeof result === 'string') {
        const toolUseError = parseToolUseError(result)
        return toolUseError.isToolUseError ? (toolUseError.errorMessage ?? '') : result
    }

    if (Array.isArray(result)) {
        const parts = result
            .map(extractTextFromContentBlock)
            .filter((part): part is string => typeof part === 'string' && part.length > 0)
        return parts.length > 0 ? parts.join('\n') : null
    }

    if (!isObject(result)) return null

    if (typeof result.content === 'string') return result.content
    if (typeof result.text === 'string') return result.text
    if (typeof result.output === 'string') return result.output
    if (typeof result.error === 'string') return result.error
    if (typeof result.message === 'string') return result.message

    const contentArray = Array.isArray(result.content) ? result.content : null
    if (contentArray) {
        const parts = contentArray
            .map(extractTextFromContentBlock)
            .filter((part): part is string => typeof part === 'string' && part.length > 0)
        return parts.length > 0 ? parts.join('\n') : null
    }

    const nestedOutput = isObject(result.output) ? result.output : null
    if (nestedOutput) {
        if (typeof nestedOutput.content === 'string') return nestedOutput.content
        if (typeof nestedOutput.text === 'string') return nestedOutput.text
    }

    const nestedError = isObject(result.error) ? result.error : null
    if (nestedError) {
        if (typeof nestedError.message === 'string') return nestedError.message
        if (typeof nestedError.error === 'string') return nestedError.error
    }

    const nestedResult = isObject(result.result) ? result.result : null
    if (nestedResult) {
        const nestedText = extractTextFromResult(nestedResult, depth + 1)
        if (nestedText) return nestedText
    }

    const nestedData = isObject(result.data) ? result.data : null
    if (nestedData) {
        const nestedText = extractTextFromResult(nestedData, depth + 1)
        if (nestedText) return nestedText
    }

    return null
}

interface CodexBashOutput {
    exitCode: number | null
    wallTime: string | null
    output: string
}

function parseCodexBashOutput(text: string): CodexBashOutput | null {
    const exitMatch = text.match(/^Exit code:\s*(\d+)/m)
    const wallMatch = text.match(/^Wall time:\s*(.+)$/m)
    const outputMatch = text.match(/^Output:\n([\s\S]*)$/m)

    if (!exitMatch && !wallMatch && !outputMatch) return null

    return {
        exitCode: exitMatch ? parseInt(exitMatch[1], 10) : null,
        wallTime: wallMatch ? wallMatch[1].trim() : null,
        output: outputMatch ? outputMatch[1] : text
    }
}

function looksLikeHtml(text: string): boolean {
    const trimmed = text.trimStart()
    return trimmed.startsWith('<!DOCTYPE') || trimmed.startsWith('<html') || trimmed.startsWith('<div') || trimmed.startsWith('<span')
}

function looksLikeJson(text: string): boolean {
    const trimmed = text.trim()
    return (trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))
}

function renderText(text: string, opts: { mode: 'markdown' | 'code' | 'auto'; language?: string } = { mode: 'auto' }) {
    if (opts.mode === 'code') {
        return <CodeBlock code={text} language={opts.language ?? 'text'} />
    }

    if (opts.mode === 'markdown') {
        return <CopyableContent text={text}><MarkdownRenderer content={text} /></CopyableContent>
    }

    if (looksLikeHtml(text) || looksLikeJson(text)) {
        return <CodeBlock code={text} language={looksLikeJson(text) ? 'json' : 'html'} />
    }

    // Text with markdown syntax → markdown renderer
    if (text.includes('```') || text.includes('**') || text.includes('##') || /^\s*[-*]\s/m.test(text) || /^\s*\d+\.\s/m.test(text)) {
        return <CopyableContent text={text}><MarkdownRenderer content={text} /></CopyableContent>
    }

    // Plain text → unified monospace pre-formatted style
    return (
        <CopyableContent text={text}>
            <div className="text-[length:var(--text-body)] text-[var(--app-fg)] font-mono whitespace-pre-wrap break-words">
                {text}
            </div>
        </CopyableContent>
    )
}

function placeholderForState(state: ToolViewProps['block']['tool']['state']): string {
    if (state === 'pending') return 'Waiting for permission…'
    if (state === 'running') return 'Running…'
    return '(no output)'
}

/** Raw JSON is now rendered at ToolCard Dialog level, not inside individual result views */
function RawJsonDevOnly(_props: { value: unknown }) {
    return null
}

function extractStdoutStderr(result: unknown): { stdout: string | null; stderr: string | null } | null {
    if (!isObject(result)) return null

    const stdout = typeof result.stdout === 'string' ? result.stdout : null
    const stderr = typeof result.stderr === 'string' ? result.stderr : null
    if (stdout !== null || stderr !== null) {
        return { stdout, stderr }
    }

    const nested = isObject(result.output) ? result.output : null
    if (nested) {
        const nestedStdout = typeof nested.stdout === 'string' ? nested.stdout : null
        const nestedStderr = typeof nested.stderr === 'string' ? nested.stderr : null
        if (nestedStdout !== null || nestedStderr !== null) {
            return { stdout: nestedStdout, stderr: nestedStderr }
        }
    }

    return null
}

function extractReadFileContent(result: unknown): { filePath: string | null; content: string } | null {
    if (!isObject(result)) return null
    const file = isObject(result.file) ? result.file : null
    if (!file) return null

    const content = typeof file.content === 'string' ? file.content : null
    if (content === null) return null

    const filePath = typeof file.filePath === 'string'
        ? file.filePath
        : typeof file.file_path === 'string'
            ? file.file_path
            : null

    return { filePath, content }
}

const AskUserQuestionResultView: ToolViewComponent = (props: ToolViewProps) => {
    const answers = props.block.tool.permission?.answers ?? null

    // If answers exist, AskUserQuestionView already shows them with highlighting
    // Return null to avoid duplicate display
    if (answers && Object.keys(answers).length > 0) {
        return null
    }

    // Fallback for tools without structured answers
    return <MarkdownResultView {...props} />
}

const BashResultView: ToolViewComponent = (props: ToolViewProps) => {
    const result = props.block.tool.result

    if (result === undefined || result === null) {
        return <div className="text-sm text-[var(--app-hint)]">{placeholderForState(props.block.tool.state)}</div>
    }

    if (typeof result === 'string') {
        const toolUseError = parseToolUseError(result)
        const display = toolUseError.isToolUseError ? (toolUseError.errorMessage ?? '') : result
        return (
            <>
                <CodeBlock code={display} language="text" />
                <RawJsonDevOnly value={result} />
            </>
        )
    }

    const stdio = extractStdoutStderr(result)
    if (stdio) {
        return (
            <>
                <div className="flex flex-col gap-2">
                    {stdio.stdout ? <CodeBlock code={stdio.stdout} language="text" /> : null}
                    {stdio.stderr ? <CodeBlock code={stdio.stderr} language="text" /> : null}
                </div>
                <RawJsonDevOnly value={result} />
            </>
        )
    }

    const text = extractTextFromResult(result)
    if (text) {
        return (
            <>
                {renderText(text, { mode: 'code', language: 'text' })}
                <RawJsonDevOnly value={result} />
            </>
        )
    }

    return (
        <>
            <div className="text-sm text-[var(--app-hint)]">(no output)</div>
            <RawJsonDevOnly value={result} />
        </>
    )
}

const MarkdownResultView: ToolViewComponent = (props: ToolViewProps) => {
    const result = props.block.tool.result

    if (result === undefined || result === null) {
        return <div className="text-sm text-[var(--app-hint)]">{placeholderForState(props.block.tool.state)}</div>
    }

    const text = extractTextFromResult(result)
    if (text) {
        return (
            <>
                {renderText(text, { mode: 'auto' })}
                <RawJsonDevOnly value={result} />
            </>
        )
    }

    return (
        <>
            <div className="text-sm text-[var(--app-hint)]">(no output)</div>
            <RawJsonDevOnly value={result} />
        </>
    )
}


// File type icon based on extension
function fileIcon(name: string): string {
    const ext = name.split('.').pop()?.toLowerCase() ?? ''
    if (['ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs'].includes(ext)) return '📜'
    if (['py', 'rb', 'go', 'rs', 'java', 'kt', 'cs', 'cpp', 'c', 'h'].includes(ext)) return '📜'
    if (['json', 'yaml', 'yml', 'toml', 'xml'].includes(ext)) return '⚙️'
    if (['md', 'txt', 'rst'].includes(ext)) return '📝'
    if (['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) return '🖼️'
    if (['sh', 'bash', 'zsh', 'fish'].includes(ext)) return '⚡'
    if (name.endsWith('/') || !ext) return '📁'
    return '📄'
}

// Parse grep output line: "file:linenum:content" or "file:content"
function parseGrepLine(line: string): { file: string; lineNum: string | null; content: string } | null {
    // Match "path/to/file.ts:42:    some content"
    const m = line.match(/^([^:]+):(\d+):(.*)$/)
    if (m) return { file: m[1], lineNum: m[2], content: m[3] }
    // Match "path/to/file.ts:    some content"
    const m2 = line.match(/^([^:]+):(.+)$/)
    if (m2) return { file: m2[1], lineNum: null, content: m2[2] }
    return null
}

const GrepResultView: ToolViewComponent = (props: ToolViewProps) => {
    const result = props.block.tool.result

    if (result === undefined || result === null) {
        return <div className="text-sm text-[var(--app-hint)]">{placeholderForState(props.block.tool.state)}</div>
    }

    const text = extractTextFromResult(result)
    if (!text || text.trim().length === 0) {
        return (
            <>
                <div className="text-sm text-[var(--app-hint)]">(no matches)</div>
                <RawJsonDevOnly value={result} />
            </>
        )
    }

    const lines = text.split('\n').filter(l => l.trim().length > 0)
    const parsed = lines.map(l => parseGrepLine(l))
    const allParsed = parsed.every(p => p !== null)

    if (!allParsed) {
        // Fallback to plain list
        return (
            <CopyableContent text={text}>
                <div className="flex flex-col gap-0.5">
                    {lines.map((line, i) => (
                        <div key={i} className="font-mono text-[length:var(--text-code)] text-[var(--app-fg)] break-all">{line}</div>
                    ))}
                </div>
            </CopyableContent>
        )
    }

    // Group by file
    const groups = new Map<string, Array<{ lineNum: string | null; content: string }>>()
    for (const p of parsed) {
        if (!p) continue
        if (!groups.has(p.file)) groups.set(p.file, [])
        groups.get(p.file)!.push({ lineNum: p.lineNum, content: p.content })
    }

    return (
        <CopyableContent text={text}>
            <div className="flex flex-col gap-2">
                {Array.from(groups.entries()).map(([file, matches]) => (
                    <div key={file} className="rounded-md border border-[var(--app-divider)] overflow-hidden">
                        <div className="flex items-center gap-1.5 bg-[var(--app-secondary-bg)] px-2 py-1">
                            <span className="text-[length:var(--text-badge)]">{fileIcon(file)}</span>
                            <span className="font-mono text-xs text-[var(--app-hint)] truncate flex-1">{file}</span>
                            <span className="shrink-0 text-[length:var(--text-badge)] text-[var(--app-hint)]">{matches.length}</span>
                        </div>
                        <div className="divide-y divide-[var(--app-divider)]">
                            {matches.map((m, i) => (
                                <div key={i} className="flex items-baseline gap-2 px-2 py-0.5">
                                    {m.lineNum ? (
                                        <span className="shrink-0 w-8 text-right font-mono text-[length:var(--text-badge)] text-[var(--app-hint)] select-none">{m.lineNum}</span>
                                    ) : null}
                                    <span className="font-mono text-[length:var(--text-code)] text-[var(--app-fg)] break-all">{m.content}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                ))}
            </div>
        </CopyableContent>
    )
}

const GlobResultView: ToolViewComponent = (props: ToolViewProps) => {
    const result = props.block.tool.result

    if (result === undefined || result === null) {
        return <div className="text-sm text-[var(--app-hint)]">{placeholderForState(props.block.tool.state)}</div>
    }

    const text = extractTextFromResult(result)
    if (!text || text.trim().length === 0) {
        return (
            <>
                <div className="text-sm text-[var(--app-hint)]">(no files)</div>
                <RawJsonDevOnly value={result} />
            </>
        )
    }

    const lines = text.split('\n').filter(l => l.trim().length > 0)

    return (
        <CopyableContent text={text}>
            <div className="flex flex-col gap-0.5">
                {lines.map((line, i) => {
                    const name = line.split('/').pop() ?? line
                    return (
                        <div key={i} className="flex items-center gap-1.5">
                            <span className="shrink-0 text-[length:var(--text-badge)]">{fileIcon(name)}</span>
                            <span className="font-mono text-[length:var(--text-caption)] text-[var(--app-fg)] break-all">{line}</span>
                        </div>
                    )
                })}
            </div>
        </CopyableContent>
    )
}

const ReadResultView: ToolViewComponent = (props: ToolViewProps) => {
    const result = props.block.tool.result

    if (result === undefined || result === null) {
        return <div className="text-sm text-[var(--app-hint)]">{placeholderForState(props.block.tool.state)}</div>
    }

    const file = extractReadFileContent(result)
    if (file) {
        const path = file.filePath ? resolveDisplayPath(file.filePath, props.metadata) : null
        const language = detectLanguage(file.filePath)
        const cleanContent = stripLineNumbers(file.content)
        return (
            <>
                {path ? (
                    <div className="mb-1.5 flex items-center gap-1.5 text-xs text-[var(--app-hint)] font-mono">
                        <span className="opacity-60">📄</span>
                        <span className="truncate">{basename(path)}</span>
                        <span className="shrink-0 rounded-md bg-[var(--app-secondary-bg)] px-1 py-0.5 text-[length:var(--text-badge)]">{language}</span>
                    </div>
                ) : null}
                <CodeBlock code={cleanContent} language={language} />
                <RawJsonDevOnly value={result} />
            </>
        )
    }

    const text = extractTextFromResult(result)
    if (text) {
        return (
            <>
                {renderText(stripLineNumbers(text), { mode: 'code', language: 'text' })}
                <RawJsonDevOnly value={result} />
            </>
        )
    }

    return (
        <>
            <div className="text-sm text-[var(--app-hint)]">(no output)</div>
            <RawJsonDevOnly value={result} />
        </>
    )
}

const MutationResultView: ToolViewComponent = (props: ToolViewProps) => {
    const { state, result, input } = props.block.tool

    const filePath = isObject(input)
        ? (typeof input.file_path === 'string' ? input.file_path
            : typeof input.path === 'string' ? input.path
            : typeof input.notebook_path === 'string' ? input.notebook_path
            : null)
        : null
    const displayPath = filePath ? resolveDisplayPath(filePath, props.metadata) : null
    const label = displayPath ? basename(displayPath) : 'Done'

    if (result === undefined || result === null) {
        if (state === 'completed') {
            return (
                <div className="flex items-center gap-1.5 text-xs text-[var(--app-badge-success-text)]">
                    <span>✓</span>
                    <span>{label}</span>
                </div>
            )
        }
        return <div className="text-sm text-[var(--app-hint)]">{placeholderForState(state)}</div>
    }

    const text = extractTextFromResult(result)

    // Error state: show full error text
    if (state === 'error' && typeof text === 'string' && text.trim().length > 0) {
        return (
            <>
                <div className="text-sm text-red-600">
                    {renderText(text, { mode: 'code' })}
                </div>
                <RawJsonDevOnly value={result} />
            </>
        )
    }

    // Success: show compact "✓ filename" indicator
    return (
        <>
            <div className="flex items-center gap-1.5 text-xs text-[var(--app-badge-success-text)]">
                <span>✓</span>
                <span>{label}</span>
            </div>
            <RawJsonDevOnly value={result} />
        </>
    )
}

const CodexPatchResultView: ToolViewComponent = (props: ToolViewProps) => {
    const result = props.block.tool.result
    const text = extractTextFromResult(result)
    if (text) {
        return (
            <>
                {renderText(text, { mode: 'auto' })}
                <RawJsonDevOnly value={result} />
            </>
        )
    }

    if (result === undefined || result === null) {
        return props.block.tool.state === 'completed'
            ? <div className="text-sm text-[var(--app-hint)]">Done</div>
            : <div className="text-sm text-[var(--app-hint)]">{placeholderForState(props.block.tool.state)}</div>
    }

    return (
        <>
            <div className="text-sm text-[var(--app-hint)]">(no output)</div>
            <RawJsonDevOnly value={result} />
        </>
    )
}

const CodexReasoningResultView: ToolViewComponent = (props: ToolViewProps) => {
    const result = props.block.tool.result
    if (result === undefined || result === null) {
        return <div className="text-sm text-[var(--app-hint)]">{placeholderForState(props.block.tool.state)}</div>
    }

    const text = extractTextFromResult(result)
    if (text) {
        return (
            <>
                {renderText(text, { mode: 'auto' })}
                <RawJsonDevOnly value={result} />
            </>
        )
    }

    return (
        <>
            <div className="text-sm text-[var(--app-hint)]">(no output)</div>
            <RawJsonDevOnly value={result} />
        </>
    )
}

const CodexDiffResultView: ToolViewComponent = (props: ToolViewProps) => {
    const result = props.block.tool.result
    if (result === undefined || result === null) {
        return props.block.tool.state === 'completed'
            ? <div className="text-sm text-[var(--app-hint)]">Done</div>
            : <div className="text-sm text-[var(--app-hint)]">{placeholderForState(props.block.tool.state)}</div>
    }

    const text = extractTextFromResult(result)
    if (text) {
        return (
            <>
                {renderText(text, { mode: 'code', language: 'diff' })}
                <RawJsonDevOnly value={result} />
            </>
        )
    }

    return (
        <>
            <div className="text-sm text-[var(--app-hint)]">Done</div>
            <RawJsonDevOnly value={result} />
        </>
    )
}

const TodoWriteResultView: ToolViewComponent = (props: ToolViewProps) => {
    const todos = extractTodoChecklist(props.block.tool.input, props.block.tool.result)
    if (todos.length === 0) {
        return <div className="text-sm text-[var(--app-hint)]">{placeholderForState(props.block.tool.state)}</div>
    }

    return <ChecklistList items={todos} />
}

const GenericResultView: ToolViewComponent = (props: ToolViewProps) => {
    const result = props.block.tool.result

    if (result === undefined || result === null) {
        return <div className="text-sm text-[var(--app-hint)]">{placeholderForState(props.block.tool.state)}</div>
    }

    // Detect codex bash output format and render accordingly
    if (typeof result === 'string') {
        const parsed = parseCodexBashOutput(result)
        if (parsed) {
            return (
                <>
                    <div className="text-xs text-[var(--app-hint)] mb-2">
                        {parsed.exitCode !== null && `Exit code: ${parsed.exitCode}`}
                        {parsed.exitCode !== null && parsed.wallTime && ' · '}
                        {parsed.wallTime && `Wall time: ${parsed.wallTime}`}
                    </div>
                    {renderText(parsed.output.trim(), { mode: 'code' })}
                    <RawJsonDevOnly value={result} />
                </>
            )
        }
    }

    const text = extractTextFromResult(result)
    if (text) {
        return (
            <>
                {renderText(text, { mode: 'auto' })}
                {typeof result === 'object' ? <RawJsonDevOnly value={result} /> : null}
            </>
        )
    }

    if (typeof result === 'string') {
        return renderText(result, { mode: 'auto' })
    }

    return <CodeBlock code={safeStringify(result)} language="json" />
}

const AGENT_ID_RE = /agentId:\s*([a-f0-9]+)\s*\(use SendMessage[^\n)]*\)\s*/
const USAGE_RE = /<usage>(.*?)<\/usage>/s

export function parseAgentMeta(text: string): { agentId: string | null; usage: Record<string, string> | null; cleanText: string } {
    let clean = text
    let agentId: string | null = null
    let usage: Record<string, string> | null = null

    const agentIdMatch = clean.match(AGENT_ID_RE)
    if (agentIdMatch) {
        agentId = agentIdMatch[1]
        clean = clean.replace(AGENT_ID_RE, '').trim()
    }

    const usageMatch = clean.match(USAGE_RE)
    if (usageMatch) {
        usage = {}
        const pairRe = /(\w+):\s*(\S+)/g
        let m
        while ((m = pairRe.exec(usageMatch[1])) !== null) {
            usage[m[1]] = m[2]
        }
        clean = clean.replace(USAGE_RE, '').trim()
    }

    return { agentId, usage, cleanText: clean }
}

const USAGE_LABELS: Record<string, string> = {
    total_tokens: 'tokens',
    tool_uses: 'tools',
    duration_ms: 'time',
}

function formatUsageValue(key: string, value: string): string {
    if (key === 'duration_ms') {
        const ms = parseInt(value, 10)
        if (!isNaN(ms)) return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`
    }
    if (key === 'total_tokens') {
        const n = parseInt(value, 10)
        if (!isNaN(n) && n >= 1000) return `${(n / 1000).toFixed(1)}k`
    }
    return value
}

export function AgentUsageBadges({ agentId, usage }: { agentId: string | null; usage: Record<string, string> | null }) {
    if (!agentId && !usage) return null
    return (
        <div className="flex flex-wrap items-center gap-1.5 text-[length:var(--text-badge)]">
            {usage && Object.entries(usage).map(([k, v]) => (
                <span key={k} className="inline-flex items-center gap-1 rounded-full bg-[var(--app-secondary-bg)] px-2 py-0.5 text-[var(--app-hint)]">
                    <span>{USAGE_LABELS[k] ?? k}</span>
                    <span className="font-mono text-[var(--app-fg)]">{formatUsageValue(k, v)}</span>
                </span>
            ))}
        </div>
    )
}

const TaskResultView: ToolViewComponent = (props: ToolViewProps) => {
    const { state, result } = props.block.tool

    if (result === undefined || result === null) {
        if (state === 'running') {
            return (
                <div className="flex items-center gap-2 text-xs text-amber-600">
                    <span className="animate-pulse">●</span>
                    <span>Running…</span>
                </div>
            )
        }
        return <div className="text-sm text-[var(--app-hint)]">{placeholderForState(state)}</div>
    }

    const text = extractTextFromResult(result)
    if (text) {
        const { cleanText } = parseAgentMeta(text)
        return (
            <div className="flex flex-col gap-2">
                {cleanText && (
                    <CopyableContent text={cleanText}>
                        <div className="rounded-lg border border-[var(--app-divider)] bg-[var(--app-secondary-bg)] p-3">
                            <MarkdownRenderer content={cleanText} />
                        </div>
                    </CopyableContent>
                )}
                <RawJsonDevOnly value={result} />
            </div>
        )
    }

    return (
        <>
            <div className="text-sm text-[var(--app-hint)]">(no output)</div>
            <RawJsonDevOnly value={result} />
        </>
    )
}

const SkillResultView: ToolViewComponent = (props: ToolViewProps) => {
    const { state, result } = props.block.tool

    if (result === undefined || result === null) {
        return <div className="text-sm text-[var(--app-hint)]">{placeholderForState(state)}</div>
    }

    const text = extractTextFromResult(result)
    if (!text || text.trim().length === 0) {
        return <div className="text-sm text-[var(--app-hint)]">(no content)</div>
    }

    return (
        <CopyableContent text={text}>
            <Collapse bordered={false} defaultActiveKey={text.length <= 300 ? ['skill-output'] : []} className="toolcard-collapse rounded-lg border border-[var(--app-divider)]">
                <CollapseItem
                    name="skill-output"
                    header={<span className="text-xs text-[var(--app-hint)]">Skill output{text.length > 300 ? ` (${Math.round(text.length / 100) / 10}K chars)` : ''}</span>}
                >
                <div className="p-3">
                    <MarkdownRenderer content={text} />
                </div>
            </CollapseItem>
        </Collapse>
        </CopyableContent>
    )
}

export const toolResultViewRegistry: Record<string, ToolViewComponent> = {
    Task: TaskResultView,
    Agent: TaskResultView,
    Skill: SkillResultView,
    Bash: BashResultView,
    exec_command: BashResultView,
    CodexBash: BashResultView,
    shell_command: BashResultView,
    Glob: GlobResultView,
    Grep: GrepResultView,
    LS: GlobResultView,
    Read: ReadResultView,
    Edit: MutationResultView,
    MultiEdit: MutationResultView,
    Write: MutationResultView,
    WebFetch: MarkdownResultView,
    WebSearch: MarkdownResultView,
    NotebookRead: ReadResultView,
    NotebookEdit: MutationResultView,
    TodoWrite: TodoWriteResultView,
    CodexReasoning: CodexReasoningResultView,
    apply_patch: MutationResultView,
    CodexPatch: CodexPatchResultView,
    CodexDiff: CodexDiffResultView,
    AskUserQuestion: AskUserQuestionResultView,
    ExitPlanMode: MarkdownResultView,
    ask_user_question: AskUserQuestionResultView,
    exit_plan_mode: MarkdownResultView
}

export function getToolResultViewComponent(toolName: string): ToolViewComponent {
    const canonicalToolName = canonicalizeToolName(toolName)
    if (canonicalToolName.startsWith('mcp__')) {
        return GenericResultView
    }
    return toolResultViewRegistry[canonicalToolName] ?? GenericResultView
}
