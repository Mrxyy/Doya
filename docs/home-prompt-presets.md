# 首页快捷 Prompt 预制会话

首页快捷 Prompt 预制会话用于让未登录用户点击公开快捷入口时，打开一段随 App 打包的预录制对话。用户体验上应该像一次正常的 AI 响应，而不是回放功能。用户在这段预制对话后继续输入时，Doya 会创建一个新的 agent 会话，并把预制对话带进新会话的可见记录里。

## 行为约定

- 只有用户未登录时才走预制会话逻辑。已登录用户点击快捷 Prompt 时，保持原来的行为，直接按正常 Prompt 提交。
- 打包的录制文件是 App asset，不是原始 agent 的链接。它不能依赖源 agent 权限、`$DOYA_HOME/recordings` 访问权限，或任何私有 workspace。
- 预制播放用普通 `AgentStreamView` 聊天 UI 渲染。不要暴露 replay 时间线控制器。
- 播放时间要按用户点击时的当前时间重新计算。不要暴露录制时的原始真实时间，也不要暴露原始工具耗时。
- 用户继续输入时创建新会话。用户可见消息是用户的新输入；隐藏的 agent prompt 里包含预制 transcript 作为前文上下文。
- 新会话标题使用快捷 Prompt 的标题，不使用用户后续输入，例如不要把标题变成“你好”。
- 新会话的可见记录应该包含：
  1. 预制会话历史；
  2. 用户后续输入；
  3. 新 agent 的响应。

## 录制文件

1. 用 replay editor 录制并编辑好目标对话。
2. 从下面路径复制最终 JSON 录制文件：

```text
$DOYA_HOME/recordings/{agentId}/{recordingId}.json
```

3. 作为 App asset 提交到：

```text
packages/app/src/data/home-prompt-recordings/{presetId}.json
```

`presetId` 使用稳定的 kebab-case，通常和快捷 Prompt 的 `id` 一致，例如 `search-ai-funding`。

如果录制里包含 AI 生成图片或其他 workspace 文件预览，不要保留本机绝对路径或 `assets/...` 这类依赖原 workspace 的相对路径。预制会话是 App asset，未登录用户没有源 workspace 文件权限；图片结果需要改成可公开访问的 URL，或内嵌为 `data:image/...;base64,...`，否则聊天 UI 会显示 “Unable to load image preview.”。

## 预览和产物资源

预制会话里的预览必须随 App 一起打包。不要依赖录制时的本机 workspace，例如：

```text
projects/<project>/svg_output/
projects/<project>/exports/
/Users/.../.doya/user-workspaces/...
```

这些路径只在录制机器上存在，部署后未登录用户拿不到。

### 预览行为契约

首页预制会话里的预览不是聊天内容里的一张截图，也不是单独做一张“看起来像预览”的卡片。它必须和正常会话的原版预览交互一致：

1. 用户在聊天结果卡上点击预览按钮，也就是结果卡右侧的眼睛按钮。
2. 当前聊天仍留在左侧，右侧打开预览 pane。
3. PPT 结果打开 PPT Master 只读预览。
4. Word、Excel、PDF 结果打开原版 `DocumentViewer` 文件预览。
5. 预览关闭后回到同一个预制会话，用户仍可以继续输入。

实现上不要为首页 preset 另写一套预览 UI。应该复用现有链路：

- PPT：结果卡调用 `onOpenReplayPptPreview`，由 `HomePresetSlidesPreviewPane` 打开内置 PPT Master 只读预览。
- docx/xlsx/pdf：结果卡调用 `onOpenWorkspaceFile`，由 `HomePresetConversation` 按 `presetId + path` 命中 `HomePresetBundledFiles`，再用 `DocumentViewer` 打开。

如果点击预览后出现下面任一情况，都算没有接完整：

- 打开空白或 “Unable to load image preview.”
- 跳到录制时的 workspace 路径。
- 需要用户登录或需要源 agent 权限。
- 只显示一张静态截图，不能用原版预览器查看。
- PPT 预览里出现 Edit 面板、可选中元素、可添加标注或可应用修改。
- 自己写了一个相似样式的假预览卡片。

### PPT 只读预览

PPT 类快捷 Prompt 如果需要打开 PPT Master 预览，需要提交两类资源。首页预制会话里的 PPT 只能查看，不能编辑、不能标注、不能应用修改。

1. 录制回放 JSON：

```text
packages/app/src/data/home-prompt-recordings/{presetId}.json
```

2. 预览 deck 文件和 bundle 入口：

```text
packages/app/src/data/home-prompt-recordings/{presetId}/svg_output/*.svg
packages/app/src/data/home-prompt-recordings/{presetId}-preview.ts
```

`{presetId}-preview.ts` 导出稳定的 slide 列表，运行时从这里读取预览内容，而不是从录制事件或本机 `projects/...` 路径临时解析。真实 `.svg` 文件也要提交，方便后续人工检查、替换或重新生成 bundle 入口。

当前 `slides-roadshow` 的接入形态是：

```text
packages/app/src/data/home-prompt-recordings/slides-roadshow.json
packages/app/src/data/home-prompt-recordings/slides-roadshow-preview.ts
packages/app/src/data/home-prompt-recordings/slides-roadshow/svg_output/01_封面.svg
...
packages/app/src/data/home-prompt-recordings/slides-roadshow/svg_output/10_融资请求.svg
```

代码里通过 `getHomePresetBundledSlidePreviews(presetId)` 选择对应的 bundled slide 数据。新增 PPT preset 时，不要复用 `slides-roadshow` 的预览数据；为新 preset 增加自己的目录和 `*-preview.ts`。

PPT Master 预览页面本身也随 App 打包在：

```text
packages/app/src/data/home-prompt-recordings/ppt-preview-static.ts
```

该文件由 PPT Master 的 `svg_editor/static` 资源生成。首页 preset 使用它构建内嵌预览页，并用 fetch shim 读取 bundled slides。首页 preset 会额外注入只读样式和只读 API shim：隐藏 Edit 面板、禁用元素选择，并拒绝 annotate/edit 请求。预览页的语言由 Doya 当前 `locale` 注入，不使用预览器自己的语言切换按钮；不要重新打开本地 Flask 预览服务。

### 文件预览完整接入

Word、Excel、PDF 等最终产物必须随 App 打包。只绑定 recording 不够；recording 里只有结果卡和路径，部署后用户没有录制机器上的 workspace 文件，点击预览会拿不到文件。

这里说的文件预览，指的是 AI 创作结果卡上的眼睛按钮打开右侧文件预览 pane；不是 assistant markdown 里的 `![Image](...)` 图片预览。图片预览如果来自本机绝对路径，需要单独改成公开 URL 或 `data:image/...`。

接入文件预览时按这个顺序做。

#### 1. 找到 recording 里的结果路径

先从 JSONL 或 JSON 里找最终产物路径。结果卡里的路径通常长这样：

```text
output/documents/区域门店经理移动运营看板PRD.docx
output/spreadsheets/餐厅季度预算表_含公式和图表.xlsx
output/documents/retail_market_executive_brief.pdf
projects/b2b_saas_analytics_pitch_ppt169_20260621/exports/b2b_saas_analytics_pitch_20260621_014923.pptx
```

这个路径是运行时匹配 key，后面注册到 `home-preset-files.ts` 时必须保持一致。可以去掉开头的 `./`，但不要改目录、文件名或扩展名。

#### 2. 把文件本体复制进 preset 目录

从录制时的 workspace 把真实文件复制到 preset 专属目录，保留结果卡里的相对路径。多数文档/表格/PDF 产物是 `output/...`，PPT Master 产物通常是 `projects/.../exports/...`：

```text
packages/app/src/data/home-prompt-recordings/{presetId}/output/...
packages/app/src/data/home-prompt-recordings/{presetId}/projects/...
```

例如：

```text
packages/app/src/data/home-prompt-recordings/document-prd/output/documents/区域门店经理移动运营看板PRD.docx
packages/app/src/data/home-prompt-recordings/sheet-budget/output/spreadsheets/餐厅季度预算表_含公式和图表.xlsx
packages/app/src/data/home-prompt-recordings/pdf-brief/output/documents/retail_market_executive_brief.pdf
packages/app/src/data/home-prompt-recordings/slides-roadshow/projects/b2b_saas_analytics_pitch_ppt169_20260621/exports/b2b_saas_analytics_pitch_20260621_014923.pptx
```

不要只把文件留在 `$DOYA_HOME`、`projects/...`、`/Users/.../.doya/...` 或录制 workspace 里。这些路径不会随 App 部署。

#### 3. 生成 bundled file registry

把所有需要预览的最终产物写进：

```text
packages/app/src/data/home-prompt-recordings/home-preset-files.ts
```

每一项包含：

- `presetId`：快捷 Prompt 的稳定 id，例如 `document-prd`。
- `path`：recording 结果卡里的相对路径，例如 `output/documents/区域门店经理移动运营看板PRD.docx`。
- `fileName`：展示和下载用文件名。
- `mimeType`：预览器判断类型用。
- `base64`：文件本体，保证部署后无需访问本机 workspace。

当前支持的 MIME：

```text
.docx application/vnd.openxmlformats-officedocument.wordprocessingml.document
.xlsx application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
.pptx application/vnd.openxmlformats-officedocument.presentationml.presentation
.pdf  application/pdf
```

如果手动生成，结构必须是：

```ts
export interface HomePresetBundledFile {
  presetId: string;
  path: string;
  fileName: string;
  mimeType: string;
  base64: string;
}

export const HomePresetBundledFiles: readonly HomePresetBundledFile[] = [
  {
    presetId: "document-prd",
    path: "output/documents/区域门店经理移动运营看板PRD.docx",
    fileName: "区域门店经理移动运营看板PRD.docx",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    base64: "...",
  },
] as const;
```

运行时点击结果卡里的预览按钮时，`HomePresetConversation` 会用 `presetId + path` 查找 `HomePresetBundledFiles`，解码为 `Uint8Array`，再交给现有 `DocumentViewer` 打开右侧文件预览。这里复用真实文件预览器，不要为预制会话手写一个相似卡片或截图假预览。

#### 4. 注册 prompt 和 recording

文件预览 registry 只解决“点击文件能打开”。preset recording 本身注册在 `packages/app/src/data/home-prompt-recordings/home-preset-recordings.ts`，首页入口注册在 `packages/app/src/screens/new-session-draft-screen.tsx`：

1. `home-preset-recordings.ts` 的 `HomePresetReplayId` 加上 `{presetId}`。
2. `home-preset-recordings.ts` 用 `ConversationRecordingSchema.parse(require("./{presetId}.json"))` 加载 recording。
3. `home-preset-recordings.ts` 的 `getHomePresetReplayRecording` 返回 recording。
4. `HOME_PROMPT_SUGGESTIONS` 对应项添加 `presetReplayId: "{presetId}"`。

#### 5. 验证

至少检查四件事：

1. 未登录点击快捷 Prompt 后，会走预制播放；已登录仍走原来的正常提交。
2. 播放结束后，结果卡显示预览按钮。
3. 点击预览按钮后，右侧打开真实 `DocumentViewer`，不是 “Unable to load image preview.”，也不是空白。
4. 关闭并重新打开页面后仍能预览，因为文件来自项目内置数据，不依赖本机 workspace。

当前已接入的 bundled file preset：

```text
slides-roadshow/projects/b2b_saas_analytics_pitch_ppt169_20260621/exports/b2b_saas_analytics_pitch_20260621_014923.pptx
document-prd/output/documents/区域门店经理移动运营看板PRD.docx
sheet-budget/output/spreadsheets/餐厅季度预算表_含公式和图表.xlsx
pdf-brief/output/documents/retail_market_executive_brief.pdf
```

## 代码注册

主要接入点在：

```text
packages/app/src/screens/new-session-draft-screen.tsx
```

### 新增一个 preset 的完整 checklist

每新增一个首页快捷 Prompt，按下面顺序完成。不要跳过预览资源；否则聊天回放能播放，但结果卡打开不了文件。

1. 准备录制：
   - 原始录制可以是 `.jsonl`。
   - App 运行时加载的是解析后的 `.json`。
   - 最终文件放到 `packages/app/src/data/home-prompt-recordings/{presetId}.json`。
2. 准备最终产物：
   - 如果 recording 里有 docx、xlsx、pdf、pptx 等结果卡，找到结果卡里的相对路径。
   - 把真实文件复制到 `packages/app/src/data/home-prompt-recordings/{presetId}/output/...`。
   - `output/...` 后面的路径必须和结果卡里显示的路径一致。
3. 准备预览 registry：
   - docx、xlsx、pdf 写进 `home-preset-files.ts`。
   - PPT Master 预览写进 `{presetId}-preview.ts` 和 `{presetId}/svg_output/*.svg`。
4. 注册代码：
   - `home-preset-recordings.ts` 里的 `HomePresetReplayId`
   - `home-preset-recordings.ts` 里的 `{PRESET}_RECORDING`
   - `home-preset-recordings.ts` 里的 `getHomePresetReplayRecording`
   - `HOME_PROMPT_SUGGESTIONS[].presetReplayId`
   - 有 PPT 预览时注册 `getHomePresetBundledSlidePreviews`
5. 本地验证：
   - 未登录点击快捷 Prompt 能播放。
   - 点击文件结果卡预览能打开右侧真实预览。
   - 继续输入会创建新会话，并保留前面的预制记录。
   - 已登录点击同一个快捷 Prompt 仍走原始正常提交逻辑。

每新增一个预制 Prompt，需要做这些事：

1. 把 id 加到 `home-preset-recordings.ts` 的 `HomePresetReplayId`。
2. 在 `home-preset-recordings.ts` 用 `ConversationRecordingSchema.parse` 加载并校验打包的 JSON。
3. 在 `home-preset-recordings.ts` 的 `getHomePresetReplayRecording` 里返回对应 recording。
4. 在 `HOME_PROMPT_SUGGESTIONS` 对应项里加 `presetReplayId`。
5. 如果该 preset 有独立预览资源，在 `getHomePresetBundledSlidePreviews` 或对应资源选择函数里注册 bundled 数据。
6. 如果该 preset 有最终文件产物，提交文件本体并在 `home-preset-files.ts` 注册路径、MIME 和 base64。

代码形态示例：

```ts
type HomePresetReplayId = "search-ai-funding" | "new-preset-id";

const NEW_PRESET_RECORDING = ConversationRecordingSchema.parse(require("./new-preset-id.json"));

function getHomePresetReplayRecording(id: HomePresetReplayId): ConversationRecording {
  switch (id) {
    case "search-ai-funding":
      return SEARCH_AI_FUNDING_RECORDING;
    case "new-preset-id":
      return NEW_PRESET_RECORDING;
  }
}

const HOME_PROMPT_SUGGESTIONS = [
  {
    id: "new-preset-id",
    promptKey: "home.newSession.prompt.someKey",
    presetReplayId: "new-preset-id",
    // icon/accent/border as usual
  },
];
```

PPT 预览数据示例：

```ts
import { NewPresetPreviewSlides } from "@/data/home-prompt-recordings/new-preset-preview";

function getHomePresetBundledSlidePreviews(id: HomePresetReplayId): HomePresetSlidePreview[] {
  if (id === "new-preset-id") {
    return NewPresetPreviewSlides.map((slide) => ({
      path: slide.path,
      svg: slide.svg,
    }));
  }
  return [];
}
```

## 运行时流程

未登录用户点击带 `presetReplayId` 的快捷 Prompt 时，会创建一个 `activePresetReplay`，里面保存：

- `id`
- 用户可见的 `prompt`
- 解析后的 `recording`
- `startedAtMs`，也就是点击时刻

`HomePresetConversation` 用下面参数投影 recording：

- `HOME_PRESET_REPLAY_SPEED` 控制播放速度；
- `timestampBaseMs: preset.startedAtMs`；
- `timestampScale: 1 / HOME_PRESET_REPLAY_SPEED`。

这样消息时间、工具耗时、turn 耗时都会相对当前会话重新计算，而不是使用原始录制时间。

## 继续输入流程

用户在预制会话里继续输入时：

- `displayText` 是用户实际输入，用于用户气泡。
- `titleText` 是快捷 Prompt 标题，用于新会话名称。
- `agentText` 由 `buildHomePresetContinuationPrompt` 生成，里面包含精简 transcript 和用户新消息，给 agent 作为隐藏上下文。
- `visibleHistory` 由 `buildHomePresetVisibleHistory` 生成，里面是要显示在聊天记录里的预制 stream items。
- 如果 preset 有 bundled files，continuation 上下文只传 `bundledPresetReplayId`。创建/打开新 workspace 后，App 会调用 `materializeHomePresetBundledFilesToWorkspace`，把 `home-preset-files.ts` 里的文件按 recording 结果卡里的相对路径静默写入 workspace。不要把这些文件转换成 composer attachments，也不要把它们放进用户消息。
- PPT preview panel 打开时也会根据 agent label 的 `homePresetReplayId` 再执行一次同样的 bundled 文件写入，并在写入后刷新 iframe。这用于修复旧会话、刷新恢复 tab、或创建流程中途未写入资源导致的空预览。

隐藏上下文必须保持轻量。不要把完整 `visibleHistory`、`<doya-ui>` 渲染块、SVG、图片、base64、确认 UI JSON 或完整文件内容塞进 `agentText`。`buildHomePresetContinuationPrompt` 只保留：

- 用户消息文本；
- 简短 assistant 文本；
- 工具调用摘要；
- todo/activity 摘要；
- 最终产物路径摘要。

当前隐藏上下文有硬上限：整体 transcript 最多约 24k 字符，单条消息最多约 1.2k 字符。可见历史仍然可以保留完整渲染用 stream items，因为它只用于 App 侧展示，不作为新 agent 的输入 prompt。这个限制是为了避免用户继续输入“你好”时，把整段 PPT/SVG/UI payload 带进新会话，触发输入长度上限。

如果 preset 有文件产物，必须同时满足这些事：

1. 文件注册在 `home-preset-files.ts`，用于 replay 内预览，也用于 continuation 时写入 workspace；
2. `path` 必须保持 recording 结果卡里的相对路径，例如 `projects/.../exports/...pptx` 或 `output/...xlsx`；
3. PPT preset 还必须把 bundled slide SVG 按原路径写入 workspace，例如 `projects/<project>/svg_output/*.svg`。右侧 PPT Master preview 读的是 `svg_output`，不是最终 `.pptx`；只写入 PPTX 会导致预览面板显示空页 `— / —`。
4. 用户继续输入后，新 agent 的工作区里能看到由 `workspace.attachments.materialize.request` 写入的真实文件。

这些 continuation 文件只用于恢复上下文和写入新 workspace，不属于用户本次手动上传的附件。实现时不要使用 `HomeAiCreationSubmitContext.hiddenAttachments`、不要合并到 `createAgent.attachments`，也不要进入 `displayAttachments` 或乐观用户消息。否则用户发送“你好”时会看到一张内置 PPTX/DOCX/XLSX/PDF 附件卡，体验上就不像正常续聊。

`workspace.attachments.materialize.request.files[].path` 支持写入 workspace 内的指定相对路径。daemon 会校验该路径不能为空、不能包含 `..`、不能逃出 workspace。没有 `path` 的普通用户附件仍写到 `attachments/{uuid}-filename`，所以首页 preset 文件落盘不会影响常规附件上传。

注意这里依赖 server 运行产物里的 `workspace.attachments.materialize.request.files[].path` 支持。改动 `packages/server/src/server/session.ts` 后必须同步 `packages/server/dist`，至少运行 `npm run build:server`。如果运行产物还是旧逻辑，preset 文件会被写进 `attachments/`，PPT Master 预览读不到 `projects/<project>/svg_output/`，右侧会出现空页 `— / —`。

`createAgent` 成功后：

1. `buildHomeAiCreationLabels` 会把 `homePresetReplayId` 写入 agent labels；这是刷新恢复 preset 前文的路由信息。对 AI creation preset，还要从 preset id 或 mode 写入 `surface: "ai_creation"` 和对应 `intent`，例如 PPT preset 必须带 `intent: "ppt_creation"`，否则新建会话里的 PPT Master 预览会被服务端拒绝。
2. 用 `setAgentStreamState` 把新 agent 的 tail 初始化成 `visibleHistory + optimisticUserMessage`。
3. `AgentPanel` 渲染 stream 时会 prepend 这份 preset history，避免 authoritative timeline refresh 后预制前文马上消失。

## 当前限制

预制前文的 source of truth 始终是 `packages/app/src/data/home-prompt-recordings/` 里的 bundled recording 和 bundled 预览/文件资源。不要把完整 `StreamItem[]`、SVG、图片、base64 文件或渲染后的 UI payload 持久化到 AsyncStorage/localStorage；这些内容很容易超过浏览器 storage quota，也会让刷新恢复依赖一份重复数据。

刷新恢复只使用 agent label 作为路由：`AgentPanel` 从 `agent.labels.homePresetReplayId` 找到 preset id，再调用 `buildHomePresetVisibleHistory` 从项目内置 recording 重新生成可见前文。当前会话刚创建、agent labels 还没回到 store 前，可以短暂用内存 store 做 handoff，但这不是持久记录。

如果后续要求跨设备可见，或通过 daemon history API 分享，就需要给 agent creation 增加协议级的 seed/history 字段；不要退回到 App 侧持久化整段 history。
