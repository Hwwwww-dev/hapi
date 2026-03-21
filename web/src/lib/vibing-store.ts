import { useSyncExternalStore } from 'react'

/**
 * Global store for per-session vibing messages.
 * When a session enters "thinking" state, a random word is picked and stored here.
 * Both StatusBar and SessionList read from the same store to stay in sync.
 */

const VIBING_MESSAGES = [
    'Accomplishing', 'Actioning', 'Actualizing', 'Baking', 'Booping', 'Brewing',
    'Calculating', 'Cerebrating', 'Channelling', 'Churning', 'Clauding', 'Coalescing',
    'Cogitating', 'Computing', 'Combobulating', 'Concocting', 'Conjuring', 'Considering',
    'Contemplating', 'Cooking', 'Crafting', 'Creating', 'Crunching', 'Deciphering',
    'Deliberating', 'Determining', 'Discombobulating', 'Divining', 'Doing', 'Effecting',
    'Elucidating', 'Enchanting', 'Envisioning', 'Finagling', 'Flibbertigibbeting',
    'Forging', 'Forming', 'Frolicking', 'Generating', 'Germinating', 'Hatching',
    'Herding', 'Honking', 'Ideating', 'Imagining', 'Incubating', 'Inferring',
    'Manifesting', 'Marinating', 'Meandering', 'Moseying', 'Mulling', 'Mustering',
    'Musing', 'Noodling', 'Percolating', 'Perusing', 'Philosophising', 'Pontificating',
    'Pondering', 'Processing', 'Puttering', 'Puzzling', 'Reticulating', 'Ruminating',
    'Scheming', 'Schlepping', 'Shimmying', 'Simmering', 'Smooshing', 'Spelunking',
    'Spinning', 'Stewing', 'Sussing', 'Synthesizing', 'Thinking', 'Tinkering',
    'Transmuting', 'Unfurling', 'Unravelling', 'Vibing', 'Wandering', 'Whirring',
    'Wibbling', 'Wizarding', 'Working', 'Wrangling',
]

function pickRandom(): string {
    return VIBING_MESSAGES[Math.floor(Math.random() * VIBING_MESSAGES.length)]
}

// sessionId → vibing word (lowercase + …)
const vibingMessages = new Map<string, string>()
const listeners = new Set<() => void>()

// Monotonically increasing version for useSyncExternalStore snapshot identity
let version = 0

function notify() {
    version++
    for (const cb of listeners) cb()
}

function subscribe(callback: () => void): () => void {
    listeners.add(callback)
    return () => listeners.delete(callback)
}

function getSnapshot(): number {
    return version
}

/**
 * Set vibing message for a session. If `thinking` is true and no message exists
 * yet, a random word is picked. If `thinking` is false, the message is cleared.
 */
export function setSessionVibing(sessionId: string, thinking: boolean): void {
    if (thinking) {
        if (!vibingMessages.has(sessionId)) {
            vibingMessages.set(sessionId, pickRandom().toLowerCase() + '…')
            notify()
        }
    } else {
        if (vibingMessages.has(sessionId)) {
            vibingMessages.delete(sessionId)
            notify()
        }
    }
}

/**
 * Get current vibing message for a session, or null if not thinking.
 */
export function getSessionVibingMessage(sessionId: string): string | null {
    return vibingMessages.get(sessionId) ?? null
}

/**
 * React hook to read a session's vibing message reactively.
 */
export function useSessionVibing(sessionId: string): string | null {
    useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
    return vibingMessages.get(sessionId) ?? null
}
