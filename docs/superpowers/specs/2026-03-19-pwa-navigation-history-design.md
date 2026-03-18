# PWA 滑动返回导航体验优化

## 问题

在 Safari/Android 的 PWA 模式下，用户滑动返回触发的是浏览器原生 `history.back()`，按时间顺序回退历史栈，而非按路由层级返回上一级。随着使用时间增长，历史栈不断堆叠，返回行为越来越混乱。

## 目标

滑动返回的行为应符合路由层级关系：
- `/sessions/$id` → `/sessions`
- `/sessions/$id/files` → `/sessions/$id`
- `/sessions/$id/file` → `/sessions/$id/files`
- `/settings` → `/sessions`
- `/sessions/new` → `/sessions`

## 方案：两层结合

### 第一层：历史栈控制（replace 策略）

通过在导航调用处区分 push/replace，保证历史栈始终反映路由层级。

#### 路由层级模型

```
/sessions                              (Level 0 - 根)
├── /sessions/new                      (Level 1)
├── /sessions/$sessionId               (Level 1)
│   ├── /sessions/$sessionId/files     (Level 2)
│   ├── /sessions/$sessionId/file      (Level 2)
│   └── /sessions/$sessionId/terminal  (Level 2)
/settings                              (Level 1, 逻辑父级 = /sessions)
```

#### 导航规则

| 场景 | 当前位置 | 目标 | 策略 | 理由 |
|:---|:---|:---|:---|:---|
| 选择会话 | `/sessions` | `/sessions/$id` | push | 进入下一层 |
| 切换会话(桌面侧边栏) | `/sessions/$idA` | `/sessions/$idB` | replace | 同级切换 |
| 进入子页面 | `/sessions/$id` | `.../files` `.../terminal` | push | 进入下一层 |
| 进入设置 | `/sessions` | `/settings` | push | 进入下一层 |
| 新建会话 | `/sessions` | `/sessions/new` | push | 进入下一层 |
| Toast 跳转 | 任意 | `/sessions/$id` | replace | 避免污染栈 |
| 删除会话后 | `/sessions/$id` | `/sessions` | replace | 清理无效历史 |
| goBack 返回 | 任意 | 逻辑父级 | replace | 返回不应入栈 |

#### 需修改的调用点

**加 `replace: true`：**
1. `router.tsx` — `SessionsPage.onSelect`：条件性 replace，判断逻辑：
   ```ts
   const isInSession = !!matchRoute({ to: '/sessions/$sessionId', fuzzy: true })
   navigate({ ..., replace: isInSession }) // 已在会话页=同级切换用replace，从列表进入=push
   ```
2. `router.tsx` — `SessionsPage.onDeletedNavigate`：删除后回列表
3. `router.tsx` — `NewSessionPage.handleCancel`：取消语义等同返回
4. `ToastContainer.tsx` — Toast 点击跳转会话
5. `useAppGoBack.ts` — 所有 navigate 调用（返回操作不应 push）

**保持 push 不变：**
- 设置按钮、新建会话按钮、查看 files/terminal（进入下一层）

### 第二层：popstate 拦截（兜底保护）

新增 `useHistoryGuard` hook，监听 popstate 事件，当浏览器返回到的位置不是逻辑父级时，用 replace 纠正。

#### 逻辑父级计算（`getLogicalParent`）

从 `useAppGoBack` 中抽取为纯函数，共享使用：

```ts
function getLogicalParent(pathname: string): string | null {
  if (pathname === '/sessions' || pathname === '/sessions/') return null
  if (pathname === '/sessions/new') return '/sessions'
  if (pathname === '/settings') return '/sessions'
  if (pathname.match(/^\/sessions\/[^/]+\/file$/)) {
    return pathname.replace(/\/file$/, '/files')
  }
  if (pathname.match(/^\/sessions\/[^/]+\/(files|terminal)$/)) {
    return pathname.replace(/\/[^/]+$/, '')
  }
  if (pathname.startsWith('/sessions/')) {
    return pathname.replace(/\/[^/]+$/, '') || '/sessions'
  }
  return null
}
```

#### `useHistoryGuard` hook

利用 TanStack Router 的 `router.subscribe` 避免与其内部 popstate 处理竞争，并通过 history state 中的递增 index 区分前进/后退：

```ts
function useHistoryGuard() {
  const router = useRouter()
  const pathname = useLocation({ select: l => l.pathname })
  const prevPathRef = useRef(pathname)
  const indexRef = useRef(0)

  // 每次正向导航时，在 history state 中写入递增 index
  useEffect(() => {
    const currentState = window.history.state ?? {}
    if (typeof currentState.__navIndex !== 'number') {
      window.history.replaceState(
        { ...currentState, __navIndex: indexRef.current },
        ''
      )
    } else {
      indexRef.current = currentState.__navIndex
    }
  }, [pathname])

  // 订阅 TanStack Router 的导航事件，在路由完成更新后再做纠正
  useEffect(() => {
    const unsubscribe = router.subscribe('onResolved', (event) => {
      const state = window.history.state ?? {}
      const navIndex = typeof state.__navIndex === 'number' ? state.__navIndex : 0

      // 只在后退时触发（index 减小）
      if (navIndex >= indexRef.current) {
        // 前进或同级，更新 index 并记录路径
        indexRef.current = navIndex
        prevPathRef.current = event.toLocation.pathname
        return
      }

      const currentPath = event.toLocation.pathname
      const expectedParent = getLogicalParent(prevPathRef.current)

      // 更新状态
      indexRef.current = navIndex
      prevPathRef.current = currentPath

      // 如果返回到的位置不是逻辑父级，纠正
      if (expectedParent && currentPath !== expectedParent) {
        router.navigate({ to: expectedParent, replace: true })
      }
    })

    return unsubscribe
  }, [router])

  // 正向导航时递增 index
  useEffect(() => {
    indexRef.current++
    const currentState = window.history.state ?? {}
    window.history.replaceState(
      { ...currentState, __navIndex: indexRef.current },
      ''
    )
    prevPathRef.current = pathname
  }, [pathname])
}
```

挂载位置：`App.tsx` 的 `AppInner` 组件中。

## 改动文件清单

| 文件 | 操作 | 说明 |
|:---|:---|:---|
| `web/src/lib/route-hierarchy.ts` | 新增 | `getLogicalParent` 纯函数 |
| `web/src/hooks/useHistoryGuard.ts` | 新增 | popstate 拦截 hook |
| `web/src/hooks/useAppGoBack.ts` | 修改 | 复用 `getLogicalParent`，navigate 加 `replace: true` |
| `web/src/router.tsx` | 修改 | onSelect/onDeletedNavigate 加 replace |
| `web/src/components/ToastContainer.tsx` | 修改 | Toast 跳转加 `replace: true` |
| `web/src/App.tsx` | 修改 | 挂载 `useHistoryGuard` |

## 边界情况

- 外部链接直接进入深层页面：历史栈只有一条，PWA 中 `history.back()` 可能不触发 popstate（无处可退）。此时第一层 replace 策略已保证栈干净，不依赖第二层。
- 根路径 `/sessions`：`getLogicalParent` 返回 `null`，guard 不做任何操作。
- 桌面端：replace 策略对桌面端侧边栏切换无负面影响（侧边栏切换本就不需要堆叠历史）。
- Telegram WebApp：已有独立的 BackButton 处理逻辑，不受影响。
- 浏览器前进操作：通过 history state 中的 `__navIndex` 区分前进/后退，前进时不拦截。
- `/sessions/$id/terminal` 返回：命中 `getLogicalParent` 的 `/(files|terminal)$/` 分支，正确返回 `/sessions/$id`。
