import { useCallback, useEffect, useRef, useState } from 'react'
import { Tree } from '@arco-design/web-react'
import { IconFolder } from '@arco-design/web-react/icon'
import { useQueryClient } from '@tanstack/react-query'
import type { TreeDataType } from '@arco-design/web-react/es/Tree/interface'
import type { ApiClient } from '@/api/client'
import type { DirectoryEntry } from '@/types/api'
import { FileIcon } from '@/components/FileIcon'
import { useSessionDirectory } from '@/hooks/queries/useSessionDirectory'
import { useTranslation } from '@/lib/use-translation'
import { queryKeys } from '@/lib/query-keys'

const folderIcon = <IconFolder className="text-[var(--app-link)]" style={{ fontSize: 'var(--icon-md)', marginRight: 4 }} />

function entriesToTreeData(entries: DirectoryEntry[], parentPath: string): TreeDataType[] {
    const dirs = entries.filter((e) => e.type === 'directory')
    const files = entries.filter((e) => e.type === 'file')

    const dirNodes: TreeDataType[] = dirs.map((entry) => {
        const fullPath = parentPath ? `${parentPath}/${entry.name}` : entry.name
        return {
            key: fullPath,
            title: <span className="text-[length:var(--text-body)] leading-[1.45]">{entry.name}</span>,
            icon: folderIcon,
            isLeaf: false,
            children: [],
        }
    })

    const fileNodes: TreeDataType[] = files.map((entry) => {
        const fullPath = parentPath ? `${parentPath}/${entry.name}` : entry.name
        return {
            key: fullPath,
            title: <span className="text-[length:var(--text-body)] leading-[1.45]">{entry.name}</span>,
            icon: <span style={{ marginRight: 4, display: 'inline-flex' }}><FileIcon fileName={entry.name} size={16} /></span>,
            isLeaf: true,
        }
    })

    return [...dirNodes, ...fileNodes]
}

function mergeChildren(
    treeData: TreeDataType[],
    parentKey: string,
    children: TreeDataType[]
): TreeDataType[] {
    return treeData.map((node) => {
        if (node.key === parentKey) {
            return { ...node, children }
        }
        if (node.children && node.children.length > 0) {
            return { ...node, children: mergeChildren(node.children, parentKey, children) }
        }
        return node
    })
}

export function DirectoryTree(props: {
    api: ApiClient | null
    sessionId: string
    rootLabel: string
    onOpenFile: (path: string) => void
    expandedPaths?: string[]
    onExpandedChange?: (paths: string[]) => void
}) {
    const { t } = useTranslation()
    const queryClient = useQueryClient()
    const apiRef = useRef(props.api)
    apiRef.current = props.api

    const { entries: rootEntries, isLoading: rootLoading } = useSessionDirectory(
        props.api, props.sessionId, '', { enabled: true }
    )

    const [treeData, setTreeData] = useState<TreeDataType[]>([])
    const rootSyncedRef = useRef<DirectoryEntry[] | null>(null)

    // Sync root entries into treeData only when rootEntries actually changes
    useEffect(() => {
        if (rootLoading || rootEntries.length === 0) return
        if (rootSyncedRef.current === rootEntries) return
        rootSyncedRef.current = rootEntries

        const rootChildren = entriesToTreeData(rootEntries, '')
        setTreeData((prev) => {
            // Preserve already-loaded deep children from loadMore
            const existingRoot = prev.find((n) => n.key === '')
            if (existingRoot?.children && existingRoot.children.length > 0) {
                const existingMap = new Map<string, TreeDataType>()
                for (const child of existingRoot.children) {
                    if (child.key != null) existingMap.set(String(child.key), child)
                }
                const merged = rootChildren.map((newChild) => {
                    const existing = existingMap.get(String(newChild.key))
                    if (existing?.children && existing.children.length > 0 && !newChild.isLeaf) {
                        return { ...newChild, children: existing.children }
                    }
                    return newChild
                })
                return [{ key: '', title: props.rootLabel, icon: folderIcon, children: merged }]
            }
            return [{ key: '', title: props.rootLabel, icon: folderIcon, children: rootChildren }]
        })
    }, [rootEntries, rootLoading, props.rootLabel])

    // Keep rootLabel in sync without destroying children
    const prevLabelRef = useRef(props.rootLabel)
    useEffect(() => {
        if (prevLabelRef.current !== props.rootLabel) {
            prevLabelRef.current = props.rootLabel
            setTreeData((prev) =>
                prev.map((node) => (node.key === '' ? { ...node, title: props.rootLabel } : node))
            )
        }
    }, [props.rootLabel])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const loadMore = useCallback((node: any): Promise<void> => {
        // Arco Tree passes NodeInstance; extract key from props._key
        const dirPath = String(node.props?._key ?? node.props?.dataRef?.key ?? node.key ?? '')
        const api = apiRef.current
        if (!api) return Promise.resolve()

        return api.listSessionDirectory(props.sessionId, dirPath).then((response) => {
            if (!response.success || !response.entries) return

            queryClient.setQueryData(
                queryKeys.sessionDirectory(props.sessionId, dirPath),
                { entries: response.entries, error: null }
            )

            const children = entriesToTreeData(response.entries, dirPath)
            if (children.length === 0) {
                const emptyNode: TreeDataType = {
                    key: `${dirPath}/__empty__`,
                    title: <span className="text-[length:var(--text-caption)] text-[var(--app-hint)]">{t('git.emptyDirectory')}</span>,
                    isLeaf: true,
                    selectable: false,
                }
                setTreeData((prev) => mergeChildren(prev, dirPath, [emptyNode]))
            } else {
                setTreeData((prev) => mergeChildren(prev, dirPath, children))
            }
        }).catch(() => {
            // silently fail - user can retry by collapsing/expanding
        })
    }, [props.sessionId, queryClient, t])

    const [internalExpanded, setInternalExpanded] = useState<string[]>([''])
    const expandedKeys = props.expandedPaths ?? internalExpanded

    const handleExpand = useCallback((keys: string[]) => {
        if (props.onExpandedChange) {
            props.onExpandedChange(keys)
        } else {
            setInternalExpanded(keys)
        }
    }, [props.onExpandedChange])

    // Re-populate expanded directories when component remounts with existing expandedKeys
    const didRestoreRef = useRef(false)
    useEffect(() => {
        if (didRestoreRef.current) return
        if (treeData.length === 0) return
        const keysToLoad = expandedKeys.filter((k) => k !== '')
        if (keysToLoad.length === 0) return
        didRestoreRef.current = true

        // Sort by depth so parents load before children
        const sorted = [...keysToLoad].sort((a, b) => a.split('/').length - b.split('/').length)
        let chain = Promise.resolve()
        for (const key of sorted) {
            chain = chain.then(() => {
                const api = apiRef.current
                if (!api) return
                return api.listSessionDirectory(props.sessionId, key).then((response) => {
                    if (!response.success || !response.entries) return
                    const children = entriesToTreeData(response.entries, key)
                    setTreeData((prev) => mergeChildren(prev, key, children.length > 0 ? children : [{
                        key: `${key}/__empty__`,
                        title: <span className="text-[length:var(--text-caption)] text-[var(--app-hint)]">{t('git.emptyDirectory')}</span>,
                        isLeaf: true,
                        selectable: false,
                    }]))
                }).catch(() => {})
            })
        }
    }, [treeData, expandedKeys, props.sessionId, t])

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handleSelect = useCallback((_keys: string[], extra: { node: any }) => {
        const node = extra.node
        const key = String(node.props?._key ?? node.props?.dataRef?.key ?? node.key ?? '')
        const isLeaf = node.props?.isLeaf ?? node.props?.dataRef?.isLeaf ?? false
        if (isLeaf && key && !key.endsWith('/__empty__')) {
            props.onOpenFile(key)
        } else if (!isLeaf && key !== undefined) {
            // Toggle expand/collapse when clicking folder name
            const isExpanded = expandedKeys.includes(key)
            handleExpand(isExpanded ? expandedKeys.filter((k) => k !== key) : [...expandedKeys, key])
        }
    }, [props.onOpenFile, expandedKeys, handleExpand])

    return (
        <div className="flex-1 overflow-y-auto border-t border-[var(--app-divider)] directory-tree-wrapper">
            <style>{`
                .directory-tree-wrapper .arco-tree { background: transparent; font-size: var(--text-body); }
                .directory-tree-wrapper .arco-tree-node { padding: 4px 8px; }
                .directory-tree-wrapper .arco-tree-node:hover { background: var(--app-subtle-bg); }
                .directory-tree-wrapper .arco-tree-node-title { color: var(--app-fg); font-weight: 500; display: inline-flex; align-items: center; vertical-align: middle; }
                .directory-tree-wrapper .arco-tree-node-switcher { color: var(--app-hint); }
                .directory-tree-wrapper .arco-tree-node-selected .arco-tree-node-title { color: var(--app-link); }
                .directory-tree-wrapper .arco-tree-node-icon { display: inline-flex; align-items: center; vertical-align: middle; }
            `}</style>
            <Tree
                treeData={treeData}
                loadMore={loadMore}
                expandedKeys={expandedKeys}
                onExpand={handleExpand}
                onSelect={handleSelect}
                blockNode
                showLine
            />
        </div>
    )
}
