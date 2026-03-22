function normalizeDate(value: Date | number | string | null | undefined): Date | null {
    if (value instanceof Date) {
        return Number.isNaN(value.getTime()) ? null : value
    }

    if (typeof value === 'number' || typeof value === 'string') {
        const parsed = new Date(value)
        return Number.isNaN(parsed.getTime()) ? null : parsed
    }

    return null
}

function pad(value: number): string {
    return value.toString().padStart(2, '0')
}

export function formatMessageTimestamp(value: Date | number | string | null | undefined): string | null {
    const date = normalizeDate(value)
    if (!date) {
        return null
    }

    return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export function MessageTimestamp(props: {
    value: Date | number | string | null | undefined
    className?: string
}) {
    const date = normalizeDate(props.value)
    const text = formatMessageTimestamp(date)

    if (!date || !text) {
        return null
    }

    return (
        <time
            dateTime={date.toISOString()}
            title={date.toLocaleString()}
            className={props.className ?? 'text-[length:var(--text-badge)] text-[var(--app-hint)] opacity-80'}
        >
            {text}
        </time>
    )
}
