# Web Session Title Priority Design

**Goal**

统一会话标题优先级：手动重命名 > MCP 生成标题 > 第一条真实用户消息（最多 50 字符）> 现有路径/原生 fallback。Web、通知、语音文案共用同一逻辑。

## 决策

1. `metadata.name` 只视为手动重命名结果。
2. `metadata.summary` 承载自动标题，并补充 `source`：
   - `generated`
   - `first-message`
3. MCP `change_title` 继续写 `metadata.summary`，但明确标记为 `generated`。
4. 当会话还没有自动标题时，首条真实用户消息写入 `metadata.summary`，并截断到 50 字符。
5. Native session 不再把 provider 提取的标题写入 `metadata.name`，改为写入 `metadata.summary(source=first-message)`，避免压过后续 MCP 生成标题。
6. 展示/通知/语音统一走同一套标题解析 helper。

## 影响范围

- `shared/`: 标题提取、截断、解析 helper；`summary.source` schema
- `cli/`: MCP 生成标题写入 `summary.source=generated`；native sync metadata 改写到 `summary`
- `hub/`: 首条用户消息 fallback；通知标题统一 helper
- `web/`: SessionHeader / SessionList / 语音上下文统一 helper

## 非目标

- 不改消息内容结构
- 不改单独的重命名接口语义
- 不额外改通知模板文案，只改标题来源
