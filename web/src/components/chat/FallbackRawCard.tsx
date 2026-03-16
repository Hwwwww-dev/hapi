import type { CanonicalFallbackRawRenderBlock } from '@/chat/canonical'
import { safeStringify } from '@hapi/protocol'
import { CodeBlock } from '@/components/CodeBlock'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

function truncateJson(text: string, limit = 600): string {
    if (text.length <= limit) return text
    return `${text.slice(0, limit)}\n…`
}

export function FallbackRawCard(props: { block: CanonicalFallbackRawRenderBlock }) {
    const { block } = props
    const previewText = safeStringify(block.preview)
    const compactPreview = truncateJson(previewText)
    const hasExpandedPreview = compactPreview !== previewText
    const previewLanguage = typeof block.preview === 'string' ? 'text' : 'json'

    return (
        <Card className="overflow-hidden border-dashed shadow-sm">
            <CardHeader className="p-3 pb-2">
                <CardTitle className="text-sm font-medium leading-tight">
                    Fallback raw
                </CardTitle>
                <CardDescription className="font-mono text-xs break-all opacity-80">
                    {block.provider ?? 'unknown-provider'} · {block.rawType ?? 'unknown-raw-type'}
                </CardDescription>
            </CardHeader>

            <CardContent className="px-3 pb-3 pt-0">
                {block.summary ? (
                    <div className="mb-3 text-xs text-[var(--app-hint)] break-words">
                        {block.summary}
                    </div>
                ) : null}

                <div className="space-y-2">
                    <div>
                        <div className="mb-1 text-xs font-medium text-[var(--app-hint)]">JSON preview</div>
                        <CodeBlock code={compactPreview} language={previewLanguage} />
                    </div>

                    {hasExpandedPreview ? (
                        <details>
                            <summary className="cursor-pointer text-xs text-[var(--app-hint)]">
                                Show full JSON
                            </summary>
                            <div className="mt-2">
                                <CodeBlock code={previewText} language={previewLanguage} />
                            </div>
                        </details>
                    ) : null}

                    {block.sourceRawEventIds.length > 0 ? (
                        <div className="text-[11px] font-mono text-[var(--app-hint)] break-all opacity-80">
                            raw: {block.sourceRawEventIds.join(', ')}
                        </div>
                    ) : null}
                </div>
            </CardContent>
        </Card>
    )
}
