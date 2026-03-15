# New Session Directory Picker Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a directory picker to the new-session flow that starts from the selected machine's home directory, supports browsing existing directories, supports creating a child directory immediately from the picker, and only allows session creation from an existing directory.

**Architecture:** Add two machine-scoped filesystem RPCs and HTTP endpoints: one for listing directories and one for creating a child directory before any session exists. In the web app, keep manual input but validate it against machine directory existence, add a dialog-based picker that starts at `machine.metadata.homeDir`, and centralize browser-safe path operations in a tiny platform-aware helper used only by the picker.

**Tech Stack:** Bun workspaces, TypeScript strict, Hono, Socket.IO RPC, React 19, TanStack Query, Radix Dialog, Vitest.

---

## File Structure

### Existing files to modify
- `cli/src/api/apiMachine.ts`
  - Register new machine-scoped RPC handlers for listing directories and creating directories.
- `hub/src/sync/rpcGateway.ts`
  - Add machine RPC wrappers for directory listing and directory creation.
- `hub/src/sync/syncEngine.ts`
  - Expose machine directory operations to web routes.
- `hub/src/web/routes/machines.ts`
  - Add machine directory browse/create HTTP endpoints and stable RPC error handling.
- `web/src/api/client.ts`
  - Add client methods for machine directory listing and machine directory creation.
- `web/src/lib/query-keys.ts`
  - Add cache keys for machine directory queries.
- `web/src/types/api.ts`
  - Extend web `Machine.metadata` with `homeDir` and add machine directory create response type.
- `web/src/components/NewSession/index.tsx`
  - Own picker state, input validation state, and write-back from the picker.
- `web/src/components/NewSession/DirectorySection.tsx`
  - Add the browse trigger and existing-directory validation messaging.
- `web/src/lib/locales/en.ts`
  - Add picker and validation labels.
- `web/src/lib/locales/zh-CN.ts`
  - Add picker and validation labels.

### New files to create
- `cli/src/modules/common/handlers/machineDirectories.ts`
  - Machine-scoped handlers for absolute-path directory listing and absolute-path directory creation.
- `cli/src/modules/common/handlers/machineDirectories.test.ts`
  - Focused tests for machine directory browse/create behavior.
- `web/src/hooks/queries/useMachineDirectory.ts`
  - Query wrapper around the machine directory listing API.
- `web/src/hooks/mutations/useCreateMachineDirectory.ts`
  - Mutation wrapper around machine directory creation.
- `web/src/components/NewSession/pathUtils.ts`
  - Browser-safe path helper for parent/child operations using target machine platform.
- `web/src/components/NewSession/pathUtils.test.ts`
  - Focused tests for POSIX and Windows path semantics.
- `web/src/components/NewSession/DirectoryPickerDialog.tsx`
  - Dialog UI for browsing, going up, creating child directories, and selecting the current directory.
- `web/src/components/NewSession/DirectoryPickerDialog.test.tsx`
  - UI tests for picker navigation, creation, and selection.

### Design constraints to keep
- Keep manual directory input; picker is additive.
- Manual input must resolve to an **existing directory** before session creation is allowed.
- New directory creation is allowed **only inside the picker** and only as an immediate child of the current browsing directory.
- Picker must start from `machine.metadata.homeDir`.
- Machine-scoped filesystem APIs must only accept **absolute paths**.
- Do not reuse machine-scoped `listDirectory` from `registerCommonHandlers(..., process.cwd())`; that handler is cwd-sandboxed and does not satisfy absolute-path browsing from machine home directory.
- Do **not** add path auto-complete, `~` text expansion, recursive tree loading, or “create arbitrary missing path on submit” in this change.
- Web path operations must not depend on Node's `path` module; use a dedicated browser helper that branches on `machine.metadata.platform`.

## Chunk 1: Machine-scoped browse/create APIs and new-session picker

### Task 1: Expose machine home directory and create-response types to web

**Files:**
- Modify: `web/src/types/api.ts`

- [ ] **Step 1: Update the web machine metadata type**

Add `homeDir?: string` to the web `Machine.metadata` shape so the new-session UI can start the picker at the selected machine's home directory.

```ts
metadata: {
    host: string
    platform: string
    happyCliVersion: string
    displayName?: string
    homeDir?: string
} | null
```

- [ ] **Step 2: Add a machine directory create response type**

Add a narrow response type for the new create-directory endpoint.

```ts
export type CreateMachineDirectoryResponse = {
    success: boolean
    path?: string
    error?: string
}
```

- [ ] **Step 3: Run web typecheck**

Run: `bun run typecheck:web`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add web/src/types/api.ts
git commit -m "refactor(web): add machine home dir and create-dir response types"
```

### Task 2: Add CLI machine-scoped directory browse/create handlers

**Files:**
- Create: `cli/src/modules/common/handlers/machineDirectories.ts`
- Create: `cli/src/modules/common/handlers/machineDirectories.test.ts`
- Modify: `cli/src/api/apiMachine.ts`

- [ ] **Step 1: Write the failing CLI unit tests for machine directory browsing and creation**

Cover these behaviors:
1. list succeeds for an absolute existing directory
2. list rejects relative paths
3. create succeeds for an absolute child directory under an existing directory
4. create rejects relative paths
5. create fails when the target already exists
6. create fails when the parent does not exist or the target is not a direct child request generated by the caller

Suggested skeleton:

```ts
it('lists an absolute directory path', async () => {
    const response = await rpc.handleRequest({
        method: 'machine-test:listMachineDirectory',
        params: JSON.stringify({ path: rootDir })
    })
    const parsed = JSON.parse(response)
    expect(parsed.success).toBe(true)
})

it('creates a child directory', async () => {
    const target = join(rootDir, 'child-a')
    const response = await rpc.handleRequest({
        method: 'machine-test:createMachineDirectory',
        params: JSON.stringify({ path: target })
    })
    const parsed = JSON.parse(response)
    expect(parsed.success).toBe(true)
    expect(parsed.path).toBe(target)
})
```

- [ ] **Step 2: Run the CLI test to verify it fails**

Run: `cd cli && bunx vitest run src/modules/common/handlers/machineDirectories.test.ts`
Expected: FAIL because the handler file and RPCs do not exist yet.

- [ ] **Step 3: Implement `listMachineDirectory`**

Create a focused handler that:
- accepts `{ path: string }`
- trims and rejects empty/relative paths
- `stat()`s the target and rejects non-directories
- reads entries with `readdir(..., { withFileTypes: true })`
- maps to the existing directory entry shape
- sorts directories before files, then by name
- skips symlink `stat()` the same way the session-scoped directory handler does

- [ ] **Step 4: Implement `createMachineDirectory`**

Create a sibling handler that:
- accepts `{ path: string }`
- trims and rejects empty/relative paths
- rejects root paths
- validates that the parent exists and is a directory
- uses `mkdir(path, { recursive: false })`
- returns `{ success: true, path }` on success
- returns stable error payloads for already-exists, missing-parent, permission, and invalid-target cases

Keep the API narrow: create exactly one directory, not arbitrary missing ancestor chains.

- [ ] **Step 5: Register the handlers on machine startup**

In `cli/src/api/apiMachine.ts`, import the new helper and register it in the constructor next to `path-exists`.

```ts
registerMachineDirectoryHandlers(this.rpcHandlerManager)
```

- [ ] **Step 6: Run the focused CLI test again**

Run: `cd cli && bunx vitest run src/modules/common/handlers/machineDirectories.test.ts`
Expected: PASS

- [ ] **Step 7: Run CLI typecheck**

Run: `bun run typecheck:cli`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add cli/src/modules/common/handlers/machineDirectories.ts \
        cli/src/modules/common/handlers/machineDirectories.test.ts \
        cli/src/api/apiMachine.ts
git commit -m "feat(cli): add machine directory browse and create handlers"
```

### Task 3: Add hub machine directory browse/create endpoints with stable error handling

**Files:**
- Modify: `hub/src/sync/rpcGateway.ts`
- Modify: `hub/src/sync/syncEngine.ts`
- Modify: `hub/src/web/routes/machines.ts`

- [ ] **Step 1: Add machine RPC wrappers in `rpcGateway.ts`**

Implement:
- `listMachineDirectory(machineId, path)`
- `createMachineDirectory(machineId, path)`

Return normalized payloads and keep thrown exceptions for the route layer to catch.

- [ ] **Step 2: Expose sync engine methods**

Add thin wrappers in `hub/src/sync/syncEngine.ts`:

```ts
async listMachineDirectory(machineId: string, path: string) {
    return await this.rpcGateway.listMachineDirectory(machineId, path)
}

async createMachineDirectory(machineId: string, path: string) {
    return await this.rpcGateway.createMachineDirectory(machineId, path)
}
```

- [ ] **Step 3: Add HTTP schemas and handlers in `machines.ts`**

Add:
- `GET /machines/:id/directory?path=/abs/path`
- `POST /machines/:id/directory` with body `{ path: string }`

Use zod:

```ts
const machineDirectoryQuerySchema = z.object({
    path: z.string().min(1)
})

const machineCreateDirectoryBodySchema = z.object({
    path: z.string().min(1)
})
```

- [ ] **Step 4: Add stable RPC error handling at the route layer**

Wrap both handlers in `try/catch` so machine offline / RPC missing / transport errors become stable payloads instead of uncaught 500s.

Expected pattern:

```ts
try {
    const result = await engine.listMachineDirectory(machineId, parsed.data.path)
    return c.json(result)
} catch (error) {
    return c.json({ success: false, error: error instanceof Error ? error.message : 'Failed to list directory' }, 500)
}
```

Mirror the same approach for create-directory.

- [ ] **Step 5: Run hub typecheck**

Run: `bun run typecheck:hub`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add hub/src/sync/rpcGateway.ts hub/src/sync/syncEngine.ts hub/src/web/routes/machines.ts
git commit -m "feat(hub): add machine directory browse and create routes"
```

### Task 4: Add browser-safe path utilities for POSIX and Windows

**Files:**
- Create: `web/src/components/NewSession/pathUtils.ts`
- Create: `web/src/components/NewSession/pathUtils.test.ts`

- [ ] **Step 1: Write the failing path utility tests**

Cover both platforms:
- POSIX root `/` has no parent beyond `/`
- POSIX child join `/Users/demo` + `project-a` -> `/Users/demo/project-a`
- Windows root `C:\` has no parent beyond `C:\`
- Windows parent `C:\Users\demo` -> `C:\Users`
- Windows child join `C:\Users\demo` + `repo` -> `C:\Users\demo\repo`

- [ ] **Step 2: Run the web test to verify it fails**

Run: `cd web && bunx vitest run src/components/NewSession/pathUtils.test.ts`
Expected: FAIL because the helper file does not exist yet.

- [ ] **Step 3: Implement a tiny platform-aware helper**

Add helpers such as:
- `getPathStyle(platform?: string): 'windows' | 'posix'`
- `getParentPath(path: string, platform?: string): string`
- `joinChildPath(parent: string, child: string, platform?: string): string`
- `isRootPath(path: string, platform?: string): boolean`

Rules:
- no Node `path` import
- treat `win32` as Windows style, everything else as POSIX for this feature
- trim child names before joining
- avoid duplicate separators

- [ ] **Step 4: Run the path utility test again**

Run: `cd web && bunx vitest run src/components/NewSession/pathUtils.test.ts`
Expected: PASS

- [ ] **Step 5: Run web typecheck**

Run: `bun run typecheck:web`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/src/components/NewSession/pathUtils.ts web/src/components/NewSession/pathUtils.test.ts
git commit -m "test(web): add cross-platform path helpers for directory picker"
```

### Task 5: Add machine directory query and mutation support in web

**Files:**
- Modify: `web/src/api/client.ts`
- Modify: `web/src/lib/query-keys.ts`
- Create: `web/src/hooks/queries/useMachineDirectory.ts`
- Create: `web/src/hooks/mutations/useCreateMachineDirectory.ts`

- [ ] **Step 1: Add API client methods**

Implement:

```ts
async listMachineDirectory(machineId: string, path: string): Promise<ListDirectoryResponse>
async createMachineDirectory(machineId: string, path: string): Promise<CreateMachineDirectoryResponse>
```

Route targets:
- `GET /api/machines/:id/directory?path=...`
- `POST /api/machines/:id/directory`

- [ ] **Step 2: Add query keys**

Add:

```ts
machineDirectory: (machineId: string, path: string) => ['machine-directory', machineId, path] as const
```

- [ ] **Step 3: Implement the query hook**

Mirror the structure of `useSessionDirectory`, but fetch by machine ID and absolute path.

- [ ] **Step 4: Implement the create-directory mutation hook**

Add a mutation that calls the create-directory API and invalidates the current machine directory query on success.

- [ ] **Step 5: Run web typecheck**

Run: `bun run typecheck:web`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add web/src/api/client.ts \
        web/src/lib/query-keys.ts \
        web/src/hooks/queries/useMachineDirectory.ts \
        web/src/hooks/mutations/useCreateMachineDirectory.ts
git commit -m "refactor(web): add machine directory browse and create data hooks"
```

### Task 6: Build the directory picker dialog with immediate child-directory creation

**Files:**
- Create: `web/src/components/NewSession/DirectoryPickerDialog.tsx`
- Create: `web/src/components/NewSession/DirectoryPickerDialog.test.tsx`
- Modify: `web/src/lib/locales/en.ts`
- Modify: `web/src/lib/locales/zh-CN.ts`

- [ ] **Step 1: Write the failing picker dialog tests**

Cover these behaviors:
1. opens at the provided home directory
2. only directory rows are navigable
3. clicking a directory enters it
4. clicking “上一级” goes to the correct parent path for the machine platform
5. entering a child directory name and confirming triggers create-directory immediately
6. successful creation refreshes the directory list and updates current path to the new directory
7. clicking “选择当前目录” returns the current absolute path

Suggested skeleton:

```tsx
it('creates a child directory immediately and selects it', async () => {
    render(<DirectoryPickerDialog ... />)
    await user.type(screen.getByLabelText(/新建目录名/i), 'project-a')
    await user.click(screen.getByRole('button', { name: /新建并进入/i }))
    expect(api.createMachineDirectory).toHaveBeenCalledWith('m1', '/Users/demo/project-a')
})
```

- [ ] **Step 2: Run the dialog test to verify it fails**

Run: `cd web && bunx vitest run src/components/NewSession/DirectoryPickerDialog.test.tsx`
Expected: FAIL because the dialog component does not exist yet.

- [ ] **Step 3: Implement the dialog component**

Required props:

```ts
{
    api: ApiClient | null
    machineId: string | null
    machinePlatform?: string | null
    initialPath: string | null
    open: boolean
    onOpenChange: (open: boolean) => void
    onSelect: (path: string) => void
}
```

Required behavior:
- when opened, initialize `currentPath` from `initialPath`
- use `useMachineDirectory` for the current path
- show current absolute path
- support parent navigation via `getParentPath`
- render only directory entries as navigation targets
- include a child-directory creation form with local input state
- call `useCreateMachineDirectory` with `joinChildPath(currentPath, childName, machinePlatform)`
- on successful creation: clear the child-name input, refresh the directory query, move `currentPath` to the newly created directory
- show loading, empty, mutation-pending, and error states

- [ ] **Step 4: Add translation keys**

Add labels for:
- browse button
- dialog title
- current path label
- up button
- select current directory button
- new child directory name label
- create-and-enter button
- loading, empty, invalid machine-home, and error states
- manual-input existing-directory validation message

- [ ] **Step 5: Run the picker dialog test again**

Run: `cd web && bunx vitest run src/components/NewSession/DirectoryPickerDialog.test.tsx`
Expected: PASS

- [ ] **Step 6: Run web typecheck**

Run: `bun run typecheck:web`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add web/src/components/NewSession/DirectoryPickerDialog.tsx \
        web/src/components/NewSession/DirectoryPickerDialog.test.tsx \
        web/src/lib/locales/en.ts \
        web/src/lib/locales/zh-CN.ts
git commit -m "feat(web): add directory picker dialog with create-child flow"
```

### Task 7: Wire the picker into `NewSession` and enforce existing-directory-only manual input

**Files:**
- Modify: `web/src/components/NewSession/index.tsx`
- Modify: `web/src/components/NewSession/DirectorySection.tsx`
- Test: extend `web/src/components/NewSession/DirectoryPickerDialog.test.tsx` only if needed, otherwise add a narrow assertion in the same file against `NewSession`

- [ ] **Step 1: Extend the failing UI test for `NewSession` integration**

Cover two behaviors:
1. selecting a directory from the picker writes it back into the text input
2. manual input with a non-existing path disables or blocks the Create action with a visible validation message

Suggested assertion target:

```tsx
expect(screen.getByDisplayValue('/Users/demo/project-a')).toBeInTheDocument()
expect(screen.getByText(/目录必须已存在/i)).toBeInTheDocument()
```

- [ ] **Step 2: Run the affected web test to verify it fails**

Run: `cd web && bunx vitest run src/components/NewSession/DirectoryPickerDialog.test.tsx`
Expected: FAIL because `NewSession` and `DirectorySection` are not wired yet.

- [ ] **Step 3: Add browse trigger and validation UI in `DirectorySection`**

Add props such as:

```ts
canBrowse: boolean
onBrowseClick: () => void
pathExists?: boolean | null
showPathValidation?: boolean
```

UI rules:
- disable browse when form disabled, no machine selected, or no `homeDir`
- show validation text only once the user has typed a non-empty path and the existence check result is known false

- [ ] **Step 4: Update `NewSession` state and validation logic**

Implement:
- `isPickerOpen`
- `pickerStartPath = selectedMachine?.metadata?.homeDir ?? null`
- `machinePlatform = selectedMachine?.metadata?.platform ?? null`
- current directory existence for the typed input using the existing `checkMachinePathsExists` call result
- `canCreate` must require `machineId`, non-empty directory, known path existence `true`, and form not disabled
- selecting a picker path sets `directory`, clears suggestions, and closes the dialog

This task intentionally changes old behavior: manual input for a non-existing path no longer creates a session.

- [ ] **Step 5: Render the picker dialog from `NewSession`**

Mount `DirectoryPickerDialog` with:
- `api={props.api}`
- `machineId={machineId}`
- `machinePlatform={machinePlatform}`
- `initialPath={pickerStartPath}`
- `open={isPickerOpen}`
- `onOpenChange={setIsPickerOpen}`
- `onSelect={handleDirectoryPicked}`

- [ ] **Step 6: Run the web integration test again**

Run: `cd web && bunx vitest run src/components/NewSession/DirectoryPickerDialog.test.tsx`
Expected: PASS

- [ ] **Step 7: Run broader web verification**

Run: `bun run test:web && bun run typecheck:web && bun run build:web`
Expected:
- Vitest PASS
- TypeScript PASS
- Vite build PASS

- [ ] **Step 8: Commit**

```bash
git add web/src/components/NewSession/index.tsx web/src/components/NewSession/DirectorySection.tsx
git commit -m "feat(web): require existing directories in new session flow"
```

### Task 8: Cross-package verification and manual acceptance

**Files:**
- No new product files unless verification exposes issues

- [ ] **Step 1: Run targeted tests for changed areas**

Run:

```bash
cd /home/hwwwww/Project/hapi
cd cli && bunx vitest run src/modules/common/handlers/machineDirectories.test.ts
cd ../web && bunx vitest run src/components/NewSession/pathUtils.test.ts src/components/NewSession/DirectoryPickerDialog.test.tsx
```

Expected: PASS

- [ ] **Step 2: Run changed-package safety checks**

Run:

```bash
cd /home/hwwwww/Project/hapi
bun run typecheck:cli
bun run typecheck:hub
bun run typecheck:web
bun run test:cli
bun run test:web
```

Expected: PASS

- [ ] **Step 3: Manually verify the UX in dev mode**

Run:

```bash
cd /home/hwwwww/Project/hapi
bun run dev
```

Manual checks:
- choose a machine with `homeDir`
- click “浏览” in new session
- dialog opens at machine home directory
- enter child folders and return to parent
- create a child directory from the picker and confirm it appears immediately
- choose current directory and confirm the input updates
- type a non-existing path manually and confirm Create is blocked with validation text
- type an existing path manually and confirm Create is allowed
- create a session from the selected directory
- switch machine and confirm the picker restarts from that machine's home directory
- repeat a quick check on Windows-style machine metadata if available

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: add new session directory picker with create-child support"
```

## Notes for implementers
- The new picker flow is the only supported directory-creation flow in this feature. Do not reintroduce submit-time creation for non-existing manual input.
- If the existing typed-path existence batch check becomes awkward for a single active input path, keep the current hook structure but make the create-button gating derive from the typed path's existence entry only.
- Keep hub route responses stable and explicit. RPC/network failures must not leak as raw uncaught exceptions.
- If `homeDir` is temporarily unavailable in machine metadata, disable browsing and show a clear message instead of inventing a fallback path.
