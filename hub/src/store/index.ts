import { Database } from 'bun:sqlite'
import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from 'node:fs'
import { dirname } from 'node:path'

import { CanonicalBlockStore } from './canonicalBlockStore'
import { MachineStore } from './machineStore'
import { NativeSyncStateStore } from './nativeSyncStateStore'
import { PushStore } from './pushStore'
import { RawEventStore } from './rawEventStore'
import { SessionParseStateStore } from './sessionParseStateStore'
import { SessionStore } from './sessionStore'
import { StagedChildRawEventStore } from './stagedChildRawEventStore'
import { UserStore } from './userStore'

export type {
    RawEventIngestResult,
    StoredCanonicalBlock,
    StoredCanonicalRootsPage,
    StoredCanonicalRootsPageInfo,
    StoredMachine,
    StoredNativeSyncState,
    StoredPushSubscription,
    StoredRawEvent,
    StoredSession,
    StoredSessionParseState,
    StoredStagedChildRawEvent,
    StoredStagedChildRawEventPayload,
    StoredUser,
    VersionedUpdateResult
} from './types'
export { CanonicalBlockStore } from './canonicalBlockStore'
export { MachineStore } from './machineStore'
export { NativeSyncStateStore } from './nativeSyncStateStore'
export { PushStore } from './pushStore'
export { RawEventStore } from './rawEventStore'
export { SessionParseStateStore } from './sessionParseStateStore'
export { SessionStore } from './sessionStore'
export { StagedChildRawEventStore } from './stagedChildRawEventStore'
export { UserStore } from './userStore'

const SCHEMA_VERSION: number = 9
const REQUIRED_TABLES = [
    'sessions',
    'session_native_aliases',
    'machines',
    'raw_events',
    'canonical_blocks',
    'session_parse_state',
    'staged_child_raw_events',
    'native_sync_state',
    'users',
    'push_subscriptions'
] as const

export class Store {
    private db: Database
    private readonly dbPath: string

    readonly sessions: SessionStore
    readonly machines: MachineStore
    readonly rawEvents: RawEventStore
    readonly canonicalBlocks: CanonicalBlockStore
    readonly sessionParseState: SessionParseStateStore
    readonly stagedChildRawEvents: StagedChildRawEventStore
    readonly nativeSyncState: NativeSyncStateStore
    readonly users: UserStore
    readonly push: PushStore

    constructor(dbPath: string) {
        this.dbPath = dbPath
        if (dbPath !== ':memory:' && !dbPath.startsWith('file::memory:')) {
            const dir = dirname(dbPath)
            mkdirSync(dir, { recursive: true, mode: 0o700 })
            try {
                chmodSync(dir, 0o700)
            } catch {
            }

            if (!existsSync(dbPath)) {
                try {
                    const fd = openSync(dbPath, 'a', 0o600)
                    closeSync(fd)
                } catch {
                }
            }
        }

        this.db = new Database(dbPath, { create: true, readwrite: true, strict: true })
        this.db.exec('PRAGMA journal_mode = WAL')
        this.db.exec('PRAGMA synchronous = NORMAL')
        this.db.exec('PRAGMA foreign_keys = ON')
        this.db.exec('PRAGMA busy_timeout = 5000')
        this.initSchema()

        if (dbPath !== ':memory:' && !dbPath.startsWith('file::memory:')) {
            for (const path of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
                try {
                    chmodSync(path, 0o600)
                } catch {
                }
            }
        }

        this.sessions = new SessionStore(this.db)
        this.machines = new MachineStore(this.db)
        this.rawEvents = new RawEventStore(this.db)
        this.canonicalBlocks = new CanonicalBlockStore(this.db)
        this.sessionParseState = new SessionParseStateStore(this.db)
        this.stagedChildRawEvents = new StagedChildRawEventStore(this.db)
        this.nativeSyncState = new NativeSyncStateStore(this.db)
        this.users = new UserStore(this.db)
        this.push = new PushStore(this.db)
    }

    private initSchema(): void {
        const currentVersion = this.getUserVersion()
        if (currentVersion === 0) {
            if (this.hasAnyUserTables()) {
                throw this.buildSchemaResetRequiredError('legacy or partially initialized schema detected')
            }

            this.createSchema()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion !== SCHEMA_VERSION) {
            throw this.buildSchemaResetRequiredError(`expected schema version ${SCHEMA_VERSION}, found ${currentVersion}`)
        }

        this.assertRequiredTablesPresent()
    }

    private createSchema(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                tag TEXT,
                namespace TEXT NOT NULL DEFAULT 'default',
                machine_id TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                metadata TEXT,
                metadata_version INTEGER DEFAULT 1,
                agent_state TEXT,
                agent_state_version INTEGER DEFAULT 1,
                todos TEXT,
                todos_updated_at INTEGER,
                team_state TEXT,
                team_state_updated_at INTEGER,
                active INTEGER DEFAULT 0,
                active_at INTEGER,
                seq INTEGER DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_tag ON sessions(tag);
            CREATE INDEX IF NOT EXISTS idx_sessions_tag_namespace ON sessions(tag, namespace);

            CREATE TABLE IF NOT EXISTS session_native_aliases (
                namespace TEXT NOT NULL,
                provider TEXT NOT NULL,
                native_session_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (namespace, provider, native_session_id),
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_session_native_aliases_session_provider
            ON session_native_aliases(session_id, provider);
            CREATE INDEX IF NOT EXISTS idx_session_native_aliases_session_id
            ON session_native_aliases(session_id);

            CREATE TABLE IF NOT EXISTS machines (
                id TEXT PRIMARY KEY,
                namespace TEXT NOT NULL DEFAULT 'default',
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                metadata TEXT,
                metadata_version INTEGER DEFAULT 1,
                runner_state TEXT,
                runner_state_version INTEGER DEFAULT 1,
                active INTEGER DEFAULT 0,
                active_at INTEGER,
                seq INTEGER DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS idx_machines_namespace ON machines(namespace);

            CREATE TABLE IF NOT EXISTS raw_events (
                ingest_seq INTEGER PRIMARY KEY AUTOINCREMENT,
                id TEXT NOT NULL UNIQUE,
                session_id TEXT NOT NULL,
                provider TEXT NOT NULL,
                source TEXT NOT NULL,
                source_session_id TEXT NOT NULL,
                source_key TEXT NOT NULL,
                observation_key TEXT,
                channel TEXT NOT NULL,
                source_order INTEGER NOT NULL,
                occurred_at INTEGER NOT NULL,
                ingested_at INTEGER NOT NULL,
                raw_type TEXT NOT NULL,
                payload TEXT NOT NULL,
                ingest_schema_version INTEGER NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
            CREATE UNIQUE INDEX IF NOT EXISTS idx_raw_events_identity
            ON raw_events(provider, source, source_session_id, source_key);
            CREATE INDEX IF NOT EXISTS idx_raw_events_session_ingest_seq
            ON raw_events(session_id, ingest_seq);

            CREATE TABLE IF NOT EXISTS canonical_blocks (
                id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                generation INTEGER NOT NULL,
                timeline_seq INTEGER NOT NULL,
                sibling_seq INTEGER NOT NULL,
                parent_block_id TEXT,
                root_block_id TEXT NOT NULL,
                depth INTEGER NOT NULL,
                kind TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                state TEXT NOT NULL,
                payload TEXT NOT NULL,
                source_raw_event_ids TEXT NOT NULL,
                parser_version INTEGER NOT NULL,
                PRIMARY KEY (session_id, generation, id)
            );
            CREATE INDEX IF NOT EXISTS idx_canonical_blocks_generation_timeline
            ON canonical_blocks(session_id, generation, timeline_seq, sibling_seq, id);

            CREATE TABLE IF NOT EXISTS session_parse_state (
                session_id TEXT PRIMARY KEY,
                parser_version INTEGER NOT NULL,
                active_generation INTEGER NOT NULL,
                state_json TEXT NOT NULL,
                last_processed_raw_sort_key TEXT,
                last_processed_raw_event_id TEXT,
                latest_stream_seq INTEGER NOT NULL,
                rebuild_required INTEGER NOT NULL,
                last_rebuild_started_at INTEGER,
                last_rebuild_completed_at INTEGER
            );

            CREATE TABLE IF NOT EXISTS staged_child_raw_events (
                id TEXT PRIMARY KEY,
                provider TEXT NOT NULL,
                child_identity TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                staged_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_staged_child_raw_events_child_identity
            ON staged_child_raw_events(child_identity, staged_at, id);

            CREATE TABLE IF NOT EXISTS native_sync_state (
                session_id TEXT PRIMARY KEY,
                provider TEXT NOT NULL,
                native_session_id TEXT NOT NULL,
                machine_id TEXT NOT NULL,
                cursor TEXT,
                file_path TEXT,
                mtime INTEGER,
                last_synced_at INTEGER,
                sync_status TEXT NOT NULL,
                last_error TEXT,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_native_sync_state_machine_id
            ON native_sync_state(machine_id, last_synced_at DESC);

            CREATE TABLE IF NOT EXISTS users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                platform TEXT NOT NULL,
                platform_user_id TEXT NOT NULL,
                namespace TEXT NOT NULL DEFAULT 'default',
                created_at INTEGER NOT NULL,
                UNIQUE(platform, platform_user_id)
            );
            CREATE INDEX IF NOT EXISTS idx_users_platform ON users(platform);
            CREATE INDEX IF NOT EXISTS idx_users_platform_namespace ON users(platform, namespace);

            CREATE TABLE IF NOT EXISTS push_subscriptions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                namespace TEXT NOT NULL,
                endpoint TEXT NOT NULL,
                p256dh TEXT NOT NULL,
                auth TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                UNIQUE(namespace, endpoint)
            );
            CREATE INDEX IF NOT EXISTS idx_push_subscriptions_namespace ON push_subscriptions(namespace);
        `)
    }

    private getUserVersion(): number {
        const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number } | undefined
        return row?.user_version ?? 0
    }

    private setUserVersion(version: number): void {
        this.db.exec(`PRAGMA user_version = ${version}`)
    }

    private hasAnyUserTables(): boolean {
        const row = this.db.prepare(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' LIMIT 1"
        ).get() as { name?: string } | undefined
        return Boolean(row?.name)
    }

    private assertRequiredTablesPresent(): void {
        const placeholders = REQUIRED_TABLES.map(() => '?').join(', ')
        const rows = this.db.prepare(
            `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${placeholders})`
        ).all(...REQUIRED_TABLES) as Array<{ name: string }>
        const existing = new Set(rows.map((row) => row.name))
        const missing = REQUIRED_TABLES.filter((table) => !existing.has(table))

        if (missing.length > 0) {
            throw new Error(
                `SQLite schema is missing required tables (${missing.join(', ')}). ` +
                'Reset the database and let HAPI rebuild the canonical store schema.'
            )
        }
    }

    private buildSchemaResetRequiredError(reason: string): Error {
        const location = (this.dbPath === ':memory:' || this.dbPath.startsWith('file::memory:'))
            ? 'in-memory database'
            : this.dbPath
        return new Error(
            `SQLite schema reset required for ${location}: ${reason}. ` +
            `This build expects canonical store schema version ${SCHEMA_VERSION} and does not migrate pre-canonical databases. ` +
            'Delete the database and let HAPI rebuild it, or restore from a compatible backup.'
        )
    }
}
