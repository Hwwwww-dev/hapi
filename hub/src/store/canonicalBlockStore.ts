import type { Database } from 'bun:sqlite'
import type { CanonicalRootBlock } from '@hapi/protocol'

import {
    getCanonicalRootsPage,
    replaceCanonicalGeneration,
    type GetCanonicalRootsPageOptions
} from './canonicalBlocks'
import type { StoredCanonicalRootsPage } from './types'

export class CanonicalBlockStore {
    private readonly db: Database

    constructor(db: Database) {
        this.db = db
    }

    replaceGeneration(sessionId: string, generation: number, roots: CanonicalRootBlock[]): void {
        replaceCanonicalGeneration(this.db, sessionId, generation, roots)
    }

    getRootsPage(sessionId: string, options: GetCanonicalRootsPageOptions): StoredCanonicalRootsPage {
        return getCanonicalRootsPage(this.db, sessionId, options)
    }
}
