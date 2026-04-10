import { Database } from 'bun:sqlite'
import { chmodSync, closeSync, existsSync, mkdirSync, openSync } from 'node:fs'
import { dirname } from 'node:path'

import { MachineStore } from './machineStore'
import { MessageStore } from './messageStore'
import { NativeSyncStateStore } from './nativeSyncStateStore'
import { PushStore } from './pushStore'
import { SessionStore } from './sessionStore'
import { UserStore } from './userStore'

export type {
    StoredMachine,
    StoredMessage,
    StoredNativeSyncState,
    StoredPushSubscription,
    StoredSession,
    StoredUser,
    VersionedUpdateResult
} from './types'
export { MachineStore } from './machineStore'
export { MessageStore } from './messageStore'
export { NativeSyncStateStore } from './nativeSyncStateStore'
export { PushStore } from './pushStore'
export { SessionStore } from './sessionStore'
export { UserStore } from './userStore'

const SCHEMA_VERSION: number = 10
const REQUIRED_TABLES = [
    'sessions',
    'session_native_aliases',
    'machines',
    'messages',
    'native_sync_state',
    'users',
    'push_subscriptions'
] as const

export class Store {
    private db: Database
    private readonly dbPath: string

    readonly sessions: SessionStore
    readonly machines: MachineStore
    readonly messages: MessageStore
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
            } catch (error) {
                console.error('[Store] Failed to chmod database directory:', error)
            }

            if (!existsSync(dbPath)) {
                try {
                    const fd = openSync(dbPath, 'a', 0o600)
                    closeSync(fd)
                } catch (error) {
                    console.error('[Store] Failed to create database file:', error)
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
                } catch (error) {
                    console.error(`[Store] Failed to chmod database file ${path}:`, error)
                }
            }
        }

        this.sessions = new SessionStore(this.db)
        this.machines = new MachineStore(this.db)
        this.messages = new MessageStore(this.db)
        this.nativeSyncState = new NativeSyncStateStore(this.db)
        this.users = new UserStore(this.db)
        this.push = new PushStore(this.db)
    }

    private initSchema(): void {
        const currentVersion = this.getUserVersion()
        if (currentVersion === 0) {
            if (this.hasAnyUserTables()) {
                this.migrateLegacySchemaIfNeeded()
                this.createSchema()
                this.setUserVersion(SCHEMA_VERSION)
                return
            }

            this.createSchema()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 1 && SCHEMA_VERSION === 2) {
            this.migrateFromV1ToV2()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 2 && SCHEMA_VERSION === 3) {
            this.migrateFromV2ToV3()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 3 && SCHEMA_VERSION === 4) {
            this.migrateFromV3ToV4()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 3 && SCHEMA_VERSION === 5) {
            this.migrateFromV3ToV4()
            this.migrateFromV4ToV5()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 4 && SCHEMA_VERSION === 5) {
            this.migrateFromV4ToV5()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 3 && SCHEMA_VERSION === 6) {
            this.migrateFromV3ToV4()
            this.migrateFromV4ToV5()
            this.migrateFromV5ToV6()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 4 && SCHEMA_VERSION === 6) {
            this.migrateFromV4ToV5()
            this.migrateFromV5ToV6()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 5 && SCHEMA_VERSION === 6) {
            this.migrateFromV5ToV6()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 5 && SCHEMA_VERSION === 7) {
            this.migrateFromV5ToV6()
            this.migrateFromV6ToV7()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 6 && SCHEMA_VERSION === 7) {
            this.migrateFromV6ToV7()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 5 && SCHEMA_VERSION === 8) {
            this.migrateFromV5ToV6()
            this.migrateFromV6ToV7()
            this.migrateFromV7ToV8()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 6 && SCHEMA_VERSION === 8) {
            this.migrateFromV6ToV7()
            this.migrateFromV7ToV8()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 7 && SCHEMA_VERSION === 9) {
            this.migrateFromV7ToV8()
            this.migrateFromV8ToV9()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 8 && SCHEMA_VERSION === 9) {
            this.migrateFromV8ToV9()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 8 && SCHEMA_VERSION === 10) {
            this.migrateFromV8ToV9()
            this.migrateFromV9ToV10()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 9 && SCHEMA_VERSION === 10) {
            this.migrateFromV9ToV10()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 4 && SCHEMA_VERSION === 7) {
            this.migrateFromV4ToV5()
            this.migrateFromV5ToV6()
            this.migrateFromV6ToV7()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion === 5 && SCHEMA_VERSION === 7) {
            this.migrateFromV5ToV6()
            this.migrateFromV6ToV7()
            this.setUserVersion(SCHEMA_VERSION)
            return
        }

        if (currentVersion !== SCHEMA_VERSION) {
            throw this.buildSchemaMismatchError(currentVersion)
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
                model TEXT,
                model_reasoning_effort TEXT,
                effort TEXT,
                todos TEXT,
                todos_updated_at INTEGER,
                team_state TEXT,
                team_state_updated_at INTEGER,
                active INTEGER DEFAULT 0,
                active_at INTEGER,
                seq INTEGER DEFAULT 0,
                deleted_at INTEGER DEFAULT NULL
            );
            CREATE INDEX IF NOT EXISTS idx_sessions_tag ON sessions(tag);
            CREATE INDEX IF NOT EXISTS idx_sessions_tag_namespace ON sessions(tag, namespace);
            CREATE INDEX IF NOT EXISTS idx_sessions_namespace_active ON sessions(namespace, updated_at DESC) WHERE deleted_at IS NULL;

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

            CREATE TABLE IF NOT EXISTS messages (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                seq INTEGER NOT NULL,
                local_id TEXT,
                source_provider TEXT,
                source_session_id TEXT,
                source_key TEXT,
                is_sidechain INTEGER NOT NULL DEFAULT 0,
                sidechain_group_id TEXT,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            );
            CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id, seq);
            CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_local_id ON messages(session_id, local_id) WHERE local_id IS NOT NULL;
            CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_native_source
            ON messages(session_id, source_provider, source_session_id, source_key)
            WHERE source_key IS NOT NULL;
            CREATE INDEX IF NOT EXISTS idx_messages_sidechain_group ON messages(session_id, sidechain_group_id) WHERE sidechain_group_id IS NOT NULL;
            CREATE INDEX IF NOT EXISTS idx_messages_root ON messages(session_id, seq DESC) WHERE is_sidechain = 0;

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

    private migrateLegacySchemaIfNeeded(): void {
        const columns = this.getMachineColumnNames()
        if (columns.size === 0) {
            return
        }

        const hasDaemon = columns.has('daemon_state') || columns.has('daemon_state_version')
        const hasRunner = columns.has('runner_state') || columns.has('runner_state_version')

        if (hasDaemon && hasRunner) {
            throw new Error('SQLite schema has both daemon_state and runner_state columns in machines; manual cleanup required.')
        }

        if (hasDaemon && !hasRunner) {
            this.migrateFromV1ToV2()
        }
    }

    private migrateFromV1ToV2(): void {
        const columns = this.getMachineColumnNames()
        if (columns.size === 0) {
            throw new Error('SQLite schema missing machines table for v1 to v2 migration.')
        }

        const hasDaemon = columns.has('daemon_state') && columns.has('daemon_state_version')
        const hasRunner = columns.has('runner_state') && columns.has('runner_state_version')

        if (hasRunner && !hasDaemon) {
            return
        }

        if (!hasDaemon) {
            throw new Error('SQLite schema missing daemon_state columns for v1 to v2 migration.')
        }

        try {
            this.db.exec('BEGIN')
            this.db.exec('ALTER TABLE machines RENAME COLUMN daemon_state TO runner_state')
            this.db.exec('ALTER TABLE machines RENAME COLUMN daemon_state_version TO runner_state_version')
            this.db.exec('COMMIT')
            return
        } catch (error) {
            this.db.exec('ROLLBACK')
        }

        try {
            this.db.exec('BEGIN')
            this.db.exec(`
                CREATE TABLE machines_new (
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
            `)
            this.db.exec(`
                INSERT INTO machines_new (
                    id, namespace, created_at, updated_at,
                    metadata, metadata_version,
                    runner_state, runner_state_version,
                    active, active_at, seq
                )
                SELECT id, namespace, created_at, updated_at,
                       metadata, metadata_version,
                       daemon_state, daemon_state_version,
                       active, active_at, seq
                FROM machines;
            `)
            this.db.exec('DROP TABLE machines')
            this.db.exec('ALTER TABLE machines_new RENAME TO machines')
            this.db.exec('CREATE INDEX IF NOT EXISTS idx_machines_namespace ON machines(namespace)')
            this.db.exec('COMMIT')
        } catch (error) {
            this.db.exec('ROLLBACK')
            const message = error instanceof Error ? error.message : String(error)
            throw new Error(`SQLite schema migration v1->v2 failed: ${message}`)
        }
    }

    private migrateFromV2ToV3(): void {
        return
    }

    private migrateFromV3ToV4(): void {
        const columns = this.getSessionColumnNames()
        if (!columns.has('team_state')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN team_state TEXT')
        }
        if (!columns.has('team_state_updated_at')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN team_state_updated_at INTEGER')
        }
    }

    private migrateFromV4ToV5(): void {
        const sessionColumns = this.getSessionColumnNames()
        if (!sessionColumns.has('model')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN model TEXT')
        }

        const messageColumns = this.getMessageColumnNames()
        if (!messageColumns.has('source_provider')) {
            this.db.exec('ALTER TABLE messages ADD COLUMN source_provider TEXT')
        }
        if (!messageColumns.has('source_session_id')) {
            this.db.exec('ALTER TABLE messages ADD COLUMN source_session_id TEXT')
        }
        if (!messageColumns.has('source_key')) {
            this.db.exec('ALTER TABLE messages ADD COLUMN source_key TEXT')
        }

        this.db.exec(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_native_source
            ON messages(session_id, source_provider, source_session_id, source_key)
            WHERE source_key IS NOT NULL
        `)
        this.db.exec(`
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
            )
        `)
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_native_sync_state_machine_id
            ON native_sync_state(machine_id, last_synced_at DESC)
        `)
    }

    private migrateFromV5ToV6(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS session_native_aliases (
                namespace TEXT NOT NULL,
                provider TEXT NOT NULL,
                native_session_id TEXT NOT NULL,
                session_id TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                PRIMARY KEY (namespace, provider, native_session_id),
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )
        `)
        this.db.exec(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_session_native_aliases_session_provider
            ON session_native_aliases(session_id, provider)
        `)
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_session_native_aliases_session_id
            ON session_native_aliases(session_id)
        `)
    }

    private migrateFromV6ToV7(): void {
        this.db.exec(`
            ALTER TABLE sessions ADD COLUMN deleted_at INTEGER DEFAULT NULL
        `)
    }

    private migrateFromV7ToV8(): void {
        // Add is_sidechain column
        this.db.exec(`ALTER TABLE messages ADD COLUMN is_sidechain INTEGER NOT NULL DEFAULT 0`)
        // Backfill existing messages
        this.db.exec(`
            UPDATE messages SET is_sidechain = 1
            WHERE COALESCE(json_extract(content, '$.content.data.isSidechain'), 0) = 1
               OR COALESCE(json_extract(content, '$.data.isSidechain'), 0) = 1
        `)
        // Create index for efficient filtering
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_sidechain ON messages(session_id, is_sidechain, seq)`)
    }

    private migrateFromV8ToV9(): void {
        // Add sidechain_group_id column for precise sidechain grouping
        this.db.exec(`ALTER TABLE messages ADD COLUMN sidechain_group_id TEXT`)
        // Backfill from JSON content (3 possible paths)
        this.db.exec(`
            UPDATE messages SET sidechain_group_id = COALESCE(
                json_extract(content, '$.sidechainGroupId'),
                json_extract(content, '$.data.sidechainGroupId'),
                json_extract(content, '$.content.data.sidechainGroupId')
            )
            WHERE is_sidechain = 1
        `)
        // Replace old sidechain index with group-based index
        this.db.exec(`DROP INDEX IF EXISTS idx_messages_sidechain`)
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_sidechain_group ON messages(session_id, sidechain_group_id) WHERE sidechain_group_id IS NOT NULL`)
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_messages_root ON messages(session_id, seq DESC) WHERE is_sidechain = 0`)
    }

    private migrateFromV9ToV10(): void {
        const columns = this.getSessionColumnNames()
        if (!columns.has('effort')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN effort TEXT')
        }
        if (!columns.has('model_reasoning_effort')) {
            this.db.exec('ALTER TABLE sessions ADD COLUMN model_reasoning_effort TEXT')
        }
    }

    private getSessionColumnNames(): Set<string> {
        const rows = this.db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>
        return new Set(rows.map((row) => row.name))
    }

    private getMachineColumnNames(): Set<string> {
        const rows = this.db.prepare('PRAGMA table_info(machines)').all() as Array<{ name: string }>
        return new Set(rows.map((row) => row.name))
    }

    private getMessageColumnNames(): Set<string> {
        const rows = this.db.prepare('PRAGMA table_info(messages)').all() as Array<{ name: string }>
        return new Set(rows.map((row) => row.name))
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
                'Back up and rebuild the database, or run an offline migration to the expected schema version.'
            )
        }
    }

    private buildSchemaMismatchError(currentVersion: number): Error {
        const location = (this.dbPath === ':memory:' || this.dbPath.startsWith('file::memory:'))
            ? 'in-memory database'
            : this.dbPath
        return new Error(
            `SQLite schema version mismatch for ${location}. ` +
            `Expected ${SCHEMA_VERSION}, found ${currentVersion}. ` +
            'This build does not run compatibility migrations. ' +
            'Back up and rebuild the database, or run an offline migration to the expected schema version.'
        )
    }
}
