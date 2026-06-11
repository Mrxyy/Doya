# AI 创作接入 PPT Master 技术方案

## 背景

当前 `AI 创作` 入口是图片生成/图片编辑两种模式。目标调整为：保留 `图像`，把第二个一级模式从 `编辑` 改为 `幻灯片`。用户输入主题、要求或上传资料后，Doya 创建一个本地 agent 任务，由 agent 直接使用 [hugohe3/ppt-master](https://github.com/hugohe3/ppt-master) 生成可编辑 `.pptx`。

这里的关键不是 Doya 自己实现 PPT 生成器，也不是把 PPT Master 做成 daemon 内部服务。Doya 要做的是把 `hugohe3/ppt-master` 作为一个随项目分发的 agent skill 接入：创建幻灯片会话时，把这个 skill 通过 symlink 挂到会话工作目录，让 agent 直接读取 skill 指令、调用其中脚本、生成最终产物。

PPT Master 官方定位是一个 agent workflow/skill：用户在 AI IDE 或 CLI agent 里让模型按它的流程工作，最终在本机生成真实可编辑的 PowerPoint。它的 README 也强调产物是原生可编辑 PPTX，而不是整页图片；它是 `harness + model = agent` 的形态，适合直接接入 Doya 的 agent 生命周期。

## 参考项目技术路线

对齐 `hugohe3/ppt-master` 的主链路：

```text
用户资料（PDF/DOCX/XLSX/PPTX/URL/Markdown/文本）
  → source_to_md/*
  → project_manager.py init/import-sources
  → Strategist 输出 design_spec.md + spec_lock.md
  → Executor 逐页生成 svg_output/*.svg
  → svg_quality_checker.py
  → total_md_split.py
  → finalize_svg.py
  → svg_to_pptx.py
  → exports/*.pptx
```

核心架构：AI 生成 SVG 设计稿，PPT Master 后处理脚本将 SVG 转成 DrawingML，最终得到 PowerPoint 原生对象。Doya 不改这条链路。

## 产品改动

`AI 创作` 首页第二个 Tab：

| 位置     | 当前             | 调整后                 |
| -------- | ---------------- | ---------------------- |
| 模式 Tab | 编辑             | 幻灯片                 |
| 输入占位 | 描述你想要的编辑 | 描述你想制作的演示文稿 |
| 附件按钮 | 参考图           | 资料                   |
| 按钮     | 开始编辑         | 开始创作               |
| 运行占位 | Creating image   | 正在生成幻灯片         |

图片编辑不再作为首页一级模式。如果后续仍要保留，可以放在图片结果页里的“继续编辑”动作。

## 接入方式

Doya 将 `hugohe3/ppt-master` 作为项目内置 skill 分发，创建普通 agent，不新增专门的 PPT 生成服务。预览能力由 Doya daemon 内置提供，不让每个 agent 自己启动 PPT Master 的 Flask preview 进程。

建议目录：

```text
packages/server/assets/skills/ppt-master/
  SKILL.md
  references/
  workflows/
  templates/
  scripts/
  requirements.txt
```

来源同步策略：

- 该目录从 `hugohe3/ppt-master` 的 `skills/ppt-master/` 同步。
- 同步时保留上游版本、commit hash 或 tag，写入 `packages/server/assets/skills/ppt-master/VERSION`。
- 不改上游 skill 内容；Doya 只在外层 prompt/AGENTS.md 里描述如何调用它。

创建幻灯片会话时，daemon 在工作目录创建 system link：

```bash
mkdir -p .paseo/skills
ln -s <paseo_repo_or_installed_assets>/skills/ppt-master .paseo/skills/ppt-master
```

如果目标平台不支持 symlink，则 fallback 为复制 skill 目录到 `.paseo/skills/ppt-master`。这个 fallback 只是文件分发策略，不改变 PPT Master 的执行架构。

agent 的初始 prompt 要求它只读取 `.paseo/skills/ppt-master/SKILL.md`，并按该 skill 的完整串行流程生成 PPT。这个 link 是 Doya 创建 agent 前必须准备好的前置条件，agent 不允许去其他目录搜索 PPT Master，也不允许 web search、`git clone`、fetch 或下载 PPT Master。如果 `.paseo/skills/ppt-master/SKILL.md` 缺失，agent 必须立即终止并返回固定错误：

```text
PPT Master skill link missing: .paseo/skills/ppt-master/SKILL.md
```

首次使用时由 agent 在确认 skill link 存在后，在会话工作目录或 skill 缓存目录安装 Python 依赖：

```bash
pip install -r .paseo/skills/ppt-master/requirements.txt
```

最终 `.pptx` 写到当前会话的 PPT Master project exports 目录。agent 最后一条消息只返回最终 `.pptx` 路径。

## 内置预览服务

PPT Master 原生实时预览是 `scripts/svg_editor/server.py <project_path> --live`：每个 project 启一个 Flask 服务，浏览器读取 `<project>/svg_output/*.svg`，支持翻页、选中元素、直接编辑 SVG 属性、添加 annotation，最后由 agent 根据 annotation 更新 SVG 并重新导出。

Doya 不采用“每个 PPT 会话启动一个 Flask 进程”的形态，而是在 daemon 内置一个共享的 PPT preview service：

```text
packages/server
  ppt-preview-service
  ├─ session/project registry：agentId → projectPath → svg_output
  ├─ HTTP routes：serve editor shell, SVG list, SVG content, images, icons
  ├─ edit API：stage direct edits, apply changes, write svg_output
  ├─ annotation API：write data-edit-target / data-edit-annotation
  └─ auth/proxy：复用 Doya daemon 连接、账号、relay/desktop 能力
```

目标是“体验和 PPT Master preview 一样”，但运行边界属于 Doya：

- 一个 daemon 内置服务承载所有 PPT 预览，不为每个会话额外开 Flask 进程。
- 每个 preview 通过 `agentId` / `projectPath` 隔离，不能跨用户、跨 workspace 访问。
- 前端打开的是 Doya URL，例如 `/ppt-preview/:agentId/:projectId`，不是 `localhost:5050`。
- 移动端、桌面端、relay 远程访问都走 Doya 现有认证和传输。
- 预览服务读取 `svg_output/`，所以 agent 每生成一页 SVG，预览即可刷新看到。
- agent 在 Step 2 项目初始化后必须立即发送一次 `Preview: projects/<project>/svg_output/`，Doya 将其渲染成“打开预览”卡片；用户可在第一页生成前打开预览，后续页面会持续出现在同一个预览页中。
- 直接编辑和 annotation 的语义保持 PPT Master 一致：浏览器内 staged，点击 Apply 后写回 `svg_output/`；PPTX 重新导出仍由 agent 走 `finalize_svg.py` + `svg_to_pptx.py`。
- daemon 可做统一资源控制：限制同时打开的 preview tab、按 idle 清理内存状态、按 agent/archive 生命周期释放 registry。

Doya 的外层 prompt 必须覆盖 PPT Master 原文的 live-preview auto-start 要求：

```text
Doya provides its own built-in slide preview service.
Do not run PPT Master's scripts/svg_editor/server.py.
Do not start Flask or open localhost preview ports.
Continue writing generated SVG pages into projects/<project>/svg_output/.
Doya will preview that directory through the daemon.
Immediately after project initialization creates projects/<project>/svg_output/, send:
Preview: projects/<project>/svg_output/
Then continue without waiting for the user.
```

这样保留 PPT Master 的核心架构：`svg_output` 是实时预览和最终导出的共同源；区别只是 preview server 从 agent sidecar 进程变成 Doya daemon 内置服务。

## Doya 架构分层

```text
packages/app
  AI 创作屏幕
  ├─ mode=image：沿用现有 imagegen flow
  └─ mode=slides：创建 agent + 上传资料 + 构造 PPT Master prompt
       ↓

packages/protocol
  第一阶段复用 create_agent_request
  labels.intent = "ppt_creation"
       ↓

packages/server
  复用现有 agent manager / workspace / attachment / timeline
  创建会话时把内置 ppt-master skill symlink 到工作目录
       ↓

agent 工作区
  user-request.md
  attachments/
  .paseo/skills/ppt-master/    # symlink 到 Doya 分发的 skill
  projects/<slug>/
    sources/
    design_spec.md
    spec_lock.md
    svg_output/
    svg_final/
    notes/
    exports/*.pptx
```

## 任务启动流程

App 侧 `slides` 模式提交后：

1. 使用现有 `createAiCreationWorkspace()` 创建账号项目和工作区。
2. daemon 为该工作区准备 `.paseo/skills/ppt-master` symlink。
3. 将用户输入写成 `user-request.md`，附件保存到工作区 `attachments/`。
4. 创建 agent，labels 使用：

```ts
{
  surface: "ai_creation",
  intent: "ppt_creation"
}
```

5. `initialPrompt` 明确要求 agent 使用 `.paseo/skills/ppt-master`，并严格执行它的 workflow。

建议 prompt 核心：

```text
You are creating a PowerPoint deck for the AI Creation slides surface.

Use the bundled PPT Master skill linked at:
.paseo/skills/ppt-master

Doya prepares this link before the agent starts.
Do not search for PPT Master in other directories.
Do not use web search for PPT Master.
Do not git clone, fetch, or download PPT Master.
If .paseo/skills/ppt-master/SKILL.md is missing, stop immediately and reply exactly:
PPT Master skill link missing: .paseo/skills/ppt-master/SKILL.md

Then read and follow .paseo/skills/ppt-master/SKILL.md exactly.
Use the user's request from ./user-request.md and all files under ./attachments/.

Doya provides its own built-in slide preview service.
Do not run PPT Master's scripts/svg_editor/server.py.
Do not start Flask or open localhost preview ports.
Continue writing generated SVG pages into projects/<project>/svg_output/.
Doya will preview that directory through the daemon.
Immediately after project initialization creates projects/<project>/svg_output/, send:
Preview: projects/<project>/svg_output/
Then continue without waiting for the user.

Only after the skill link exists, install its Python requirements if needed:
pip install -r .paseo/skills/ppt-master/requirements.txt

Run the PPT Master pipeline:
source_to_md → project_manager init/import-sources → Strategist design_spec/spec_lock
→ sequential SVG pages → svg_quality_checker → total_md_split → finalize_svg → svg_to_pptx.

The output must be a native editable PPTX in projects/<project>/exports/.
Do not create a screenshot-only deck.
Final reply: only provide the PPTX path and optional preview path.
```

如果用户只输入主题、没有资料，仍按 PPT Master 的 topic research / free design 流程处理；Doya 不单独实现一套大纲生成器。

## 协议与兼容

第一阶段不新增 RPC，复用 `create_agent_request`。

需要变更的主要是 app 侧 mode 和 labels：

- `CreationMode = "image" | "slides"`
- `slides` 创建 agent 时 `labels.intent = "ppt_creation"`
- 创建 agent 前 server 为 workspace 准备 `.paseo/skills/ppt-master` link
- agent stream 根据 intent 分派结果展示

如果后续要让 app 判断 host 是否支持该入口，再添加：

```ts
server_info.features.aiCreationSlides = true;
```

并在唯一 gate 处加兼容标记：

```ts
// COMPAT(aiCreationSlides): added in v0.1.X, drop the gate when floor >= v0.1.X
```

如果未来需要更强的产物管理，再新增 dotted RPC：

```text
ai_creation.slides.list_outputs.request
ai_creation.slides.list_outputs.response
```

但 MVP 不需要。

## 结果识别与展示

现有图片流只识别图片 Markdown 和图片路径。幻灯片模式新增结果识别：

```text
projects/*/exports/*.pptx
projects/*/exports/*.pdf       # 可选
projects/*/svg_output/*.svg    # daemon 内置实时预览源
projects/*/svg_final/*.svg     # 可选最终 SVG 快照
```

展示策略：

1. agent 运行中显示“正在生成幻灯片”。
2. 当 `projects/<project>/svg_output/` 出现时，展示“打开预览”入口，进入 daemon 内置 PPT preview service。
3. 完成后展示 `.pptx` 下载卡片。
4. 如果有 `svg_final/` 或 PDF，可展示首页预览。
5. Web/Electron 支持打开或下载本地文件；移动端走分享保存。

stream normalization 按 `labels.intent` 分派：

```ts
imagegen/image_edit → normalizeAiCreationImageStream
ppt_creation        → normalizeAiCreationSlidesStream
```

## UI 表单

第一版不做复杂模板系统，只提供足够自然的 PPT 参数：

| 控件       | 选项                           |
| ---------- | ------------------------------ |
| 幻灯片比例 | 16:9、4:3                      |
| 页数       | 自动、5、10、15、20            |
| 风格       | 自动、商务、学术、发布会、杂志 |
| 资料       | PDF/DOCX/XLSX/PPTX/MD/图片     |

参数进入 prompt，由 PPT Master Strategist 阶段锁定到 `design_spec.md` / `spec_lock.md`。不要在 Doya app 里提前做模板匹配，PPT Master 的模板规则是显式路径触发，不能根据风格描述自动猜模板。

## 实施阶段

### Phase 1：入口与 agent prompt

- 把 `AI 创作` 第二个 Tab 从 `编辑` 改成 `幻灯片`。
- 新增 `CreationMode = "image" | "slides"`。
- 将 `hugohe3/ppt-master` 的 `skills/ppt-master` 同步到 Doya 内置 skill assets。
- 创建幻灯片会话时 symlink `.paseo/skills/ppt-master` 到工作目录。
- 新增 slides prompt builder。
- 创建 agent 时打 `intent: "ppt_creation"`。
- 附件保存为工作区文件，并在 prompt 中指向路径。
- 运行中占位文案改为幻灯片生成。

### Phase 2：结果展示

- 新增 PPTX 路径提取。
- 新增 PPTX 下载卡片。
- 新增 daemon 内置 PPT preview service，读取 `svg_output/` 并提供和 PPT Master live preview 等价的翻页、选中、直接编辑、annotation 能力。
- 支持可选 SVG/PDF 最终快照预览。
- 调整 AI 创作 sidebar/title 展示，`ppt_creation` 不再套用图片结果逻辑。

### Phase 3：体验增强

- 支持更新内置 skill 到新的上游 tag/commit。
- 支持在设置里显示当前 PPT Master skill 版本。
- 支持模板 PPTX 上传，prompt 引导 agent 使用 PPT Master 的 template fill 或模板路径流程。
- 支持断点续跑，prompt 引导 agent 使用 `resume-execute` workflow。

## 风险与约束

- 首次 pip install 会慢，失败时由 agent 在详情页展示命令输出。
- `ppt-master` 质量依赖强模型和长上下文，Doya 不应承诺“一次生成最终成品”。
- 不要并行生成页面。PPT Master 明确要求 Executor 逐页串行生成 SVG，避免整套 deck 视觉漂移。
- 不要把 PPT Master 改写成 daemon 内部服务；它应保持 agent skill 形态。
- 不要另写 PPTX 生成器。Doya 只负责接入 agent、工作区、资料、状态和产物展示。

## 验证策略

不跑全量测试。按范围做 targeted verification：

- UI/mode 文案：相关 app 单测。
- prompt builder 和 stream normalization：`ai-creation` 相关 targeted vitest。
- 手动端到端：用一份极小 Markdown 输入生成 2-3 页 PPTX，检查 `projects/*/exports/*.pptx` 存在，并能在 PowerPoint 中打开编辑。
