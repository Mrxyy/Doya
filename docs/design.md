# 设计

所有颜色、字号、字重、间距、圆角、图标尺寸和主题变体 token 都在 `packages/app/src/styles/theme.ts`。

本文档是 Doya 的产品设计契约。它说明 app 代码里应该复用什么、避免什么，以及升级后的品牌应该给人什么感觉。

---

## 1. 品牌性格

Doya 是装进口袋里的本地 AI 编程环境。品牌核心是一颗豆芽：小、有生命力、实用，并且安静乐观。

UI 应该具备这些气质：

- **轻盈**：留白充足，表面柔和，阅读路径清楚。
- **有生命力**：绿色点缀、细微的生长隐喻、对用户动作有回应的表面，但不要为了炫技而动画化。
- **可靠能干**：足够承载真实工程工作，绝不能像玩具。
- **平静**：不要赛博朋克，不要霓虹 agent 剧场，不要仪表盘噪音。
- **本地优先**：可信、直接、实用。用户的代码和环境是中心，不是模型。

豆芽不是吉祥物。真实控制界面里不要加入可爱口吻、农场隐喻、机器人脸、装饰叶子或品牌插画。Doya 的个性来自克制、清晰和少量温暖时刻。

---

## 2. 视觉方向

Doya 默认是浅色视觉系统，以分层中性色为基础，用绿色作为品牌强调色。

使用语义表面层级：

- `surface0`：app/workspace 背景。
- `surface1`：轻微 hover 和安静的分组区域。
- `surface2`：输入框、徽章、控件、抬升面板。
- `surface3`：更强的控件或选中 affordance。
- `surface4`：少量额外强调。
- `surfaceSidebar` / `surfaceSidebarHover`：侧边栏专属层次。
- `surfaceWorkspace`：主工作画布。

主 Doya 操作使用 `accent`。当前浅色主题的 accent 是沉稳豆芽绿（`theme.ts` 中的 `#20744A`），`accentBright` 用于少量更活泼的点缀。绿色应该表达生命力和就绪感，而不是到处刷成功状态。成功状态使用语义 status token，不要随手拿任意绿色。

避免：

- 紫色渐变和 AI glow 风格。
- 默认产品感使用暗色赛博面板。
- 米色、棕色、咖啡色大面积主导。
- 以通用蓝色 SaaS 风格作为主要品牌信号。
- 装饰 blob、玻璃卡片、bokeh、过度阴影和新奇 chrome。
- 在 token 定义或明确的一次性资产之外使用裸 hex。

app 可以有 dark、zinc、midnight、claude 或 ghostty 主题，但产品设计仍然遵循同一套克制原则：表面、文字、控件，然后才是强调色。

---

## 3. 组件复用

一致性来自 primitive，而不是手工对齐样式。

一个语义元素如果在三个或更多地方使用，它就是 primitive。一次性场景才属于具体 screen。

Primitive 位置：

- `packages/app/src/components/ui/`
- `packages/app/src/components/headers/`
- `packages/app/src/styles/settings.ts`
- `packages/app/src/screens/settings/settings-section.tsx`

新增组件前先读 `components/ui/`。通常 primitive 已经存在。

默认使用这些 primitive：

- Button：`<Button>`
- 页面 alert：`<Alert>`
- Loading：`<LoadingSpinner>`
- 状态 pill：`<StatusBadge>`
- 触发菜单：`<DropdownMenu>`
- 右键/长按菜单：`<ContextMenu>`
- 可搜索 picker：`<Combobox>`
- 二元设置：`<Switch>`
- 分段选择：`<SegmentedControl>`
- 聚焦任务：`<AdaptiveModalSheet>`
- 破坏性确认：`confirmDialog`
- Header：`<BackHeader>`、`<MenuHeader>`、`<ScreenHeader>`、`<ScreenTitle>`、`<HeaderIconBadge>`

把 styled `Pressable` 伪装成按钮是错的。把裸 `Text` 伪装成 section label 是错的。聚焦任务使用 raw `Modal` 是错的。自定义状态 pill 是错的。

---

## 4. Logo 和品牌资产

品牌资产规则在 [brand.md](brand.md)。修改 logo、favicon、app icon 或产品名之前先读它。

主 logo 是填充豆芽 tile：

- `packages/app/assets/icons/doya.svg`
- `packages/app/assets/icons/doya-24.png`
- `packages/app/assets/icons/doya-app-icon.svg`

默认使用填充 tile。只有周围表面已经提供合适背景时，才使用透明豆芽。

不要在 React 组件里硬编码产品名。运行时文案走 i18n：

- 单独品牌名用 `brand.name`。
- 翻译句子里用 `{brand}`。

英文界面使用 `Doya`。中文界面使用 `豆芽`。不要写 `Douya`、`DoYa`、`DOYA`、`Bean Sprout` 或 `BeanSprout`。

---

## 5. 类型层级

层级主要靠字重、颜色、间距和位置，而不是一味放大字号。

大多数 app 文本使用 `fontSize.base` 或 `fontSize.xs`。更大的字号只留给首次使用、营销和真正的空开始场景。高密度 app 表面不应该像 landing page。

字重三层：

- **Screen title** 使用 `<ScreenTitle>`，不要覆盖它的响应式字重。
- **结构标签** 使用 `fontWeight.medium`：section label、modal/sheet title、高密度 metadata 强调、紧凑 action label。
- **内容** 使用 `fontWeight.normal`：row title、正文、button label、badge text、sidebar callout title、list item title。

前景角色：

- `foreground`：用户首先阅读或正在操作的内容。
- `foregroundMuted`：上下文、次级 metadata、placeholder、空闲 row、helper text、状态说明。

如果屏幕显得平，不要先放大字号；优先修复分组、顺序、间距或文案。

---

## 6. 布局密度

Doya 应该宽松但不稀疏：给思考留空间，同时保持重复工作的速度。

设置、项目详情等阅读/详情页放在居中的最大宽度列中，约 720px。Workspace、chat、file、terminal、diff 和 document 表面使用完整可用画布。

节奏：

- Page：宽松。
- Section：宽松。
- Card：紧凑。
- Row：触控目标充足。

卡片内 row 相互贴合，从第二行开始用一个 top divider 分隔。作为页面主体的列表靠间距和表面组织，不要给每个 row 都加卡片边框。

不要为了塞更多信息压缩 row。信息更多时，应通过更好的分组、渐进展开、tabs、搜索或专门详情面来解决。

---

## 7. 表面、边框和层级

优先使用层次，而不是阴影。

边框用于分组和分隔：

- 一个逻辑 card 外围一条边框。
- card 内 row 之间从第二行开始一条 top divider。
- pane chrome 下方一条 bottom border。
- 低强调 outline button 和 input 使用轻微边框。

不要卡片套卡片。不要把页面 section 做成漂浮卡片。不要为了“看起来有设计”随意给单个元素描边。

阴影很少使用。如果一个表面不是 modal、floating 或高于其他内容，通常不需要阴影。

圆角是实用的，不是卖萌的。大多数 app card 和 control 保持紧凑平静。大 pill 形状只用于真正的 pill 或紧凑控件，不要套给所有容器。

---

## 8. 按钮和动作

`<Button>` 是唯一按钮 primitive。

变体：

- `default`：一个表面上的唯一主操作，使用 `accent` 填充。
- `secondary`：常见配对操作，使用 `surface3` 填充。
- `outline`：低频 row 或详情操作。
- `ghost`：结构 chrome、导航和低强调 affordance。
- `destructive`：只在确认 UI 中使用。

一个表面最多只有一个 `default` button。很多表面没有主按钮。composer、active pane 或当前 selection 本身往往已经是主操作。

Destructive 是确认状态，不是页面装饰。Restart、remove、delete、archive with local risk 等动作使用安静的页面控件，并在 `confirmDialog` 内展示红色破坏性操作。

工具型或空间型动作使用图标。可用时使用 lucide icon。文本按钮用于明确命令。不要用 `Pressable` 包 `Text` 做第六种按钮变体。

---

## 9. 导航和响应式

Compact-first。小屏布局是被设计过的，桌面只是增加空间和 chrome。

标准模式：

- **List + detail**：compact 从列表 push 到详情，使用 `<BackHeader>`；桌面使用 320px sidebar 加 detail pane，配 `<ScreenHeader>`、`<HeaderIconBadge>` 和 `<ScreenTitle>`。
- **Workspace**：compact 折叠 tabs；桌面支持 split panes。
- **Sidebar**：compact 覆盖；桌面固定。
- **Focused task**：compact 用 bottom sheet；桌面用居中 modal card。

布局使用 `useIsCompactFormFactor()`。不要用 `Platform.OS` 代替屏幕尺寸。compact 和 desktop 共享 list/detail 组件，只改变 shell。

新的 list/detail 功能参考 settings/projects shell。新的 workspace 形态功能参考 workspace shell。第三种模式需要设计评审。

---

## 10. 工作表面

Doya 是 agent workbench。主表面不是营销页。

Workspace、terminal、diff、file explorer、browser、document viewer 和 agent timeline 应优先考虑：

- 扫描。
- 选择。
- 快速切换。
- 清晰的当前状态。
- 低延迟反馈。
- 稳定几何结构。

Toolbar 要紧凑、图标优先。Pane chrome 使用一条边框和小控件。重复工作表面里避免 hero 级标题、解释性卡片、装饰插画或 onboarding 文案。

Composer 是命令表面。保持聚焦、可读、易触达。Provider/model/mode 控件是 agent controls，不是状态装饰。

---

## 11. 文案和语气

文案冷静、具体、短。

英文使用 sentence case，例如：

- `Pair a device`
- `Danger zone`
- `Restart daemon`
- `Inject Doya tools`
- `No sessions yet`
- `Load more`

Row title、label、button、单句 hint 不加句号。多句说明使用正常标点。

按钮使用命令式：

- Save
- Cancel
- Restart
- Remove
- Update
- Install update
- Add host
- Load more

进行中标签使用三个普通点：

- `Saving...`
- `Restarting...`
- `Removing...`
- `Loading...`

错误文案要直接。写 `Unable to remove host`，不要写 `Sorry, we couldn't remove the host.` 恢复说明要具体。

所有新增用户可见 app 文案都进入 `packages/app/src/i18n/translations.ts`，使用 `domain.surface.intent` 这类扁平 key。见 [i18n.md](i18n.md)。不要在组件中新增硬编码中文或英文 UI 字符串。

术语来自 [glossary.md](glossary.md)。UI label 优先。尤其注意：

- Project，不用 repo 或 repository。
- Workspace，不用 checkout、folder 或 directory。
- Host，除非面向用户的概念确实是 daemon process。
- Provider，不用 model provider。
- Agent，不用 task、job 或 run。
- Session 和 agent 是不同概念。
- Composer 是整个 prompt 表面；composer input 只指文本输入区。

---

## 12. 状态和反馈

状态应出现在它影响的最小范围。

Loading：

- 默认 inline：`<LoadingSpinner size={14} color={foregroundMuted} />`。
- 只有整个页面不可用时才用 page-level loading。
- Card-level loading 通常是短的 muted 文案，不是大 spinner。
- Dropdown item 使用自己的 pending state。

Empty state：

- 使用短名词短语或短句。
- 只有整个区域为空时才 muted 居中。
- 最多一个明显恢复动作。
- 除非是首次使用或品牌级场景，否则不要插画。

Error：

- Field error 放在字段下方。
- Page error 使用 `<Alert>`。
- 阻断流程的 error 使用 React Native `Alert.alert`。
- 局部失败保留可用内容，并为失败来源显示小 banner。

Disabled state 使用外层 pressable opacity。不要发明 disabled color。

侧边栏全局 notice 使用通过 `useSidebarCallouts()` 注册的 `<SidebarCallout>`。页面局部 notice 使用 `<Alert>`。不要把 `<SidebarCallout>` import 到页面内容里。

---

## 13. Row、列表和菜单

Row 包含内容列和可选 trailing slot。

Card 内使用 `settingsStyles.row`。Sidebar list 使用既有 sidebar row 形态，包括 per-row radius 和 hover/selected state。

导航 row 使用 trailing chevron。Kebab menu 是 row action，不是导航。一个 row 可以同时有两者：kebab 在 chevron 前。

Switch 和 segmented control 放在 trailing slot。如果 row 同时导航和 toggle，control 需要 stop propagation。

Kebab action 使用：

- `<DropdownMenu>`
- `<MoreVertical size={14} />`
- `align="end"`
- `<DropdownMenuItem leading={<Icon size={14} ... />} />`

Hover 展开的 row control 遵循 [hover.md](hover.md)：外层 plain `View` 使用 `onPointerEnter` / `onPointerLeave`，内部单独 `Pressable`，几何结构稳定，并用 `isHovered || isNative || isCompact` 控制可见性。

---

## 14. Picker 和 modal

按交互形态选择 primitive：

- 小而固定的集合：`<DropdownMenu>`。
- 大集合或可搜索集合：`<Combobox>`。
- 右键或长按目标动作：`<ContextMenu>`。
- 多字段聚焦任务：`<AdaptiveModalSheet>`。
- 破坏性 yes/no：`confirmDialog`。

三个主题是 dropdown。三十个 host 是 combobox。label/value 编辑任务是 adaptive modal sheet。`Are you sure?` 是 confirm dialog。

普通 app 任务不要使用 raw `Modal`。

---

## 15. 状态和语义颜色

状态是语义，不是装饰。

Status pill 使用 `<StatusBadge>`。模式是语义前景色加同色 10% alpha 背景。Success 是绿色，warning 是琥珀色，danger 是红色，muted 是 zinc，merged 在 git/review 状态需要时可用紫色。

Status dot 使用 `statusSuccess`、`statusWarning`、`statusDanger` 或 `foregroundMuted`，出现在 row trailing slot 或状态 label 旁。

不要把所有正向内容都做成绿色。品牌绿用于 Doya 身份和主操作；状态绿只用于真实成功/健康状态。

---

## 16. Theme 和 Unistyles

主题感知样式使用 Unistyles，但它有锋利边界。改主题行为前先读 [unistyles.md](unistyles.md)。

规则：

- 永远不要新增 `useUnistyles()`。
- 默认使用 `StyleSheet.create((theme) => ...)`。
- 真正静态的值用静态常量。
- 只有必须响应主题的 leaf 第三方组件 props 才使用 `withUnistyles(Component)`。
- web 上高频测量样式使用 `inlineUnistylesStyle`，例如 pointer-driven position、dimension 和 transform。
- themed background 放在 wrapper view 上，不要放在 themed `ScrollView.contentContainerStyle`。

不要为了绕过一个高频 style 值，把组件拆成 plain/web/native 变体。只给具体 style object 标记 inline escape hatch。

---

## 17. 平台 gate

app 运行在 iOS、Android、browser web 和 Electron web。

默认写跨平台代码。只有具体能力需要时才 gate：

- DOM APIs：`isWeb`。
- Native-only APIs：`isNative`。
- Electron bridge APIs：`getIsElectron()`。
- 布局变化：`useIsCompactFormFactor()`。

实现本质不同的时候优先使用 Metro 文件扩展：

- `.web.ts` / `.web.tsx`
- `.native.ts` / `.native.tsx`
- `.electron.ts` / `.electron.tsx`

没有 `isWeb` guard 的裸 DOM API 禁止使用。`Platform.OS` 不是布局断点。

---

## 18. 禁止项

- 在 React 组件中新增硬编码 UI 字符串。
- 用硬编码产品名代替 i18n brand key。
- 在 row title、body text、button label、badge text 或 sidebar callout title 上使用 `fontWeight.medium`。
- 用 `<Pressable>` 包 `<Text>` 做按钮。
- 用裸 `<Text>` 做 settings section header。
- 聚焦任务使用 raw `Modal`。
- 自定义 status pill。
- 直接 import `ActivityIndicator`。
- 没有 `isWeb` guard 的裸 DOM API。
- 用 `Platform.OS` 代替布局判断。
- 在 token 定义外新增 color token 或裸 hex。
- 紫色 AI 渐变、霓虹 glow、装饰 blob、机器人脸、豆芽吉祥物 UI。
- 使用 theme scale 之外的 spacing。
- Placeholder 比 `foregroundMuted` 更暗。
- Disabled state 改颜色；应使用 opacity。
- 破坏性动作没有 `confirmDialog`。
- 嵌套 pressable 场景用 `Pressable.onHoverIn` / `onHoverOut` 驱动 hover-to-reveal state。
- 卡片套卡片，或把页面 section 做成 floating card。
- 与当前任务无关的顺手视觉重做。

---

## 19. 标准参考表面

| 模式                                                 | 参考                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List + detail（compact stack，desktop sidebar+pane） | `packages/app/src/screens/settings-screen.tsx`、`packages/app/src/screens/projects-screen.tsx`                                                                                                                                                                                                           |
| Detail card + row                                    | `packages/app/src/screens/settings/host-page.tsx`、`packages/app/src/screens/settings/providers-section.tsx`                                                                                                                                                                                             |
| Card list 内 section 分组                            | `packages/app/src/screens/settings/settings-section.tsx`                                                                                                                                                                                                                                                 |
| Form modal                                           | `packages/app/src/components/add-host-modal.tsx`、`packages/app/src/components/pair-link-modal.tsx`、`packages/app/src/components/project-picker-modal.tsx`                                                                                                                                              |
| 破坏性确认                                           | `packages/app/src/utils/confirm-dialog.ts` 中的 `confirmDialog`                                                                                                                                                                                                                                          |
| 首次使用品牌时刻                                     | `packages/app/src/components/welcome-screen.tsx`                                                                                                                                                                                                                                                         |
| Sidebar lists                                        | `packages/app/src/components/sidebar-workspace-list.tsx`、`packages/app/src/components/left-sidebar.tsx`                                                                                                                                                                                                 |
| Live agent list                                      | `packages/app/src/components/agent-list.tsx`                                                                                                                                                                                                                                                             |
| 历史 sessions list                                   | `packages/app/src/screens/sessions-screen.tsx`                                                                                                                                                                                                                                                           |
| Workspace panes                                      | `packages/app/src/screens/workspace/workspace-screen.tsx`                                                                                                                                                                                                                                                |
| Composer                                             | `packages/app/src/composer/index.tsx`、`packages/app/src/composer/input/input.tsx`                                                                                                                                                                                                                       |
| Pane chrome                                          | `packages/app/src/git/diff-pane.tsx`、`packages/app/src/components/file-explorer-pane.tsx`、`packages/app/src/components/terminal-pane.tsx`                                                                                                                                                              |
| Page alert                                           | `packages/app/src/components/ui/alert.tsx`、`packages/app/src/screens/project-settings-screen.tsx`                                                                                                                                                                                                       |
| Sidebar callout                                      | `packages/app/src/components/sidebar-callout.tsx`、`packages/app/src/contexts/sidebar-callout-context.tsx`、`packages/app/src/components/worktree-setup-callout-source.tsx`、`packages/app/src/desktop/updates/rosetta-callout-source.tsx`、`packages/app/src/desktop/updates/update-callout-source.tsx` |
| Searchable picker                                    | `packages/app/src/components/ui/combobox.tsx`、`packages/app/src/components/branch-switcher.tsx`                                                                                                                                                                                                         |
| Trigger-anchored menu                                | `packages/app/src/components/ui/dropdown-menu.tsx`                                                                                                                                                                                                                                                       |
| Right-click / long-press menu                        | `packages/app/src/components/ui/context-menu.tsx`                                                                                                                                                                                                                                                        |
| Headers                                              | `packages/app/src/components/headers/back-header.tsx`、`screen-header.tsx`、`menu-header.tsx`                                                                                                                                                                                                            |
