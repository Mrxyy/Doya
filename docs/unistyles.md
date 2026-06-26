# Unistyles 注意事项

app 使用 [`react-native-unistyles` v3](https://www.unistyl.es/) 做主题感知样式。Unistyles 快，是因为大多数样式更新不经过 React render：Babel plugin 会重写 React Native component imports，附加 style metadata，并让 native ShadowRegistry 在 theme 或 runtime dependency 变化时更新被追踪的 view。

这个模型很强，但边界很锋利。新增 theme-dependent styles 前先读这份文档。

## 停止：禁止使用 `useUnistyles()`

**不要调用 `useUnistyles()`。任何地方都不要。新代码绝不能新增调用；已有调用点只是因为还没人重写，碰到时要迁移。**

库作者也明确建议不要使用这个 hook。它会让组件在每次 runtime 变化时 re-render。这个 hook 本来是为了简化迁移，只应在其他方法都失败时使用。

Doya 已经反复踩过这个坑。该 hook 会让组件订阅**所有** Unistyles runtime 变化（theme、breakpoint、insets、color scheme、scale），并且每次调用都返回新对象引用。这会导致温热子树（agent streams、panels、sidebars）周期性 lockstep re-render，即使用户看不到任何变化。profiling 已确认很多周期里唯一变化输入就是 `theme`。它也会破坏下游所有包含派生 theme 值的 `useMemo` / `memo` 边界。

Reviewer 必须拒绝引入新 `useUnistyles()` 调用的 PR。没有“最后手段”例外。如果下面替代方案都解决不了，开 issue 并停止，不要用 hook 糊过去。

按顺序使用这些替代方案：

### 1. `StyleSheet.create((theme) => ...)`：默认选择

大多数主题感知样式不需要别的东西。Babel plugin 会追踪 factory 内部的 theme dependency，并在不触发 React re-render 的情况下更新 native ShadowTree。

```tsx
const styles = StyleSheet.create((theme) => ({
  container: {
    backgroundColor: theme.colors.surface0,
    padding: theme.spacing[4],
  },
}));

<View style={styles.container} />;
```

如果你读取 theme 值只是为了传回 `style` prop，几乎一定应该用这个，而不是 hook。

### 2. 真正静态值使用硬编码常量

如果只需要一个碰巧来自 theme 的数字，例如固定 spacing 用于计算 gap 或动画距离，使用字面量常量或静态模块。静态读取不需要订阅。见下方“静态 theme import”部分。导入 `baseColors`、theme-name constants 或 `type Theme` 是可以的，只要值确实是静态或仅类型。

### 3. 第三方 props 使用 `withUnistyles(Component)`

当第三方组件接收一个非 `style` prop 且它必须响应 theme，例如 `BlurView.tint`、`Image.tintColor`、navigator option props、bottom-sheet `backgroundStyle`，用 `withUnistyles` 包住那一个组件。只有 wrapper re-render，不会带着周围树重渲染。

```tsx
const ThemedBlur = withUnistyles(BlurView);
<ThemedBlur tint={theme.colors.surface0} />;
```

注意下方记录的 `> *` 子选择器泄漏。

### 4. 没有“最后手段”

不存在 escape hatch。如果 1 到 3 都不适合，问题在上游；修上游或开 issue。hook 不在选项里。

## 更新如何传播

对标准 React Native components，Unistyles Babel plugin 会把 `View`、`Text`、`Pressable`、`ScrollView` 等 imports 重写成 Unistyles-aware component factories。Native 上这些 factories 会借用 component ref，把 `style` prop 注册到 ShadowRegistry。这个路径避免不必要的 React re-render。

关键细节：自动 native 路径追踪 `props.style`。它通常不会追踪每一个“看起来像 style”的 prop。

`useUnistyles()` 不同。它把当前 theme/runtime 暴露给 React，并让组件在这些值变化时 re-render。不要期待直接读取 `UnistylesRuntime` 会让组件 re-render；GitHub issue #817 是这个 invariant 的提醒。

## Web 上的动态像素样式

避免把高频变化的像素值，如 `{ top, left }`、`{ maxHeight }`、`{ minWidth }`，传给 web 上 Unistyles-managed React Native component 的 `style` prop。Web runtime 会按值 hash 每个 style object，并向 `#unistyles-web` 追加 CSS rule；这些 rule 在页面生命周期中不会回收。Pointer-driven positioning 会变成持续增长的 stylesheet。

高频值使用下方 inline escape hatch。不要为了一个测量值拆成 plain/web/native 组件。Raw DOM wrapper 只用于真正的 DOM 基础设施，例如 terminal host、virtualized web row 或第三方 drag wrapper。

## 内联样式逃生口

当某个 style 值高频变化并且必须绕过 Unistyles CSS registry 时，组件仍走正常 Unistyles 路径，只给具体 style object 标记 `inlineUnistylesStyle`。

```tsx
import { inlineUnistylesStyle } from "@/styles/unistyles-inline-style";

const styles = StyleSheet.create({
  thumb: {
    position: "absolute",
  },
});

<View style={[styles.thumb, inlineUnistylesStyle({ height, transform: [{ translateY }] })]} />;
```

这使用 Unistyles 自己的 animated-style lane：普通样式仍变成 Unistyles class，被标记的 style object 留在 React Native inline style array。适用于测量几何、scroll/drag transform，以及 pressed/hovered/open state 等生成 CSS class 不是正确归属边界的情况。

不要为了一个高频值把组件拆成 plain 和 Unistyles 变体。组件仍是正常 Unistyles 组件；只有具体 style object escape。

可复用组件如果有专门承载 dynamic geometry 的 prop，就让这个 prop 成为 seam。例如 `FloatingSurface.frameStyle` 和 `FloatingScrollView.style` 自己拥有 escape hatch，让 menu、tooltip、hover-card、combobox 调用方保持声明式，而不是了解 Unistyles 内部。

## 主要陷阱：`contentContainerStyle`

`ScrollView.contentContainerStyle` 是标准陷阱。它看起来像 style prop，但不是 Unistyles remapped native component 默认注册的那个 `style` prop。

Theme-dependent style 避免这样写：

```tsx
<ScrollView contentContainerStyle={styles.container} />;

const styles = StyleSheet.create((theme) => ({
  container: {
    flexGrow: 1,
    backgroundColor: theme.colors.surface0,
  },
}));
```

首次 mount 时它可能用当前 adaptive 或 initial theme 绘制。如果 app settings 稍后加载 persisted theme 并调用 `UnistylesRuntime.setTheme`，JS 侧 style proxy 可能已经报告新 theme，但 native content container 仍保持旧背景。Welcome screen 曾经因此出现浅背景配暗前景/按钮。

这个问题也适用于其他携带 theme-dependent value 的非 `style` prop，例如 `color`、`trackColor`、`tintColor`、`backgroundStyle`、`handleIndicatorStyle` 以及库特定 style props。把这些值当作 React props，除非用 `withUnistyles` 包过。

## 修复模式

首选模式：把 themed background 放在普通 wrapper view 上，让 `contentContainerStyle` 不含 theme。

```tsx
<View style={styles.container}>
  <ScrollView contentContainerStyle={styles.contentContainer}>{children}</ScrollView>
</View>;

const styles = StyleSheet.create((theme) => ({
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  contentContainer: {
    flexGrow: 1,
    padding: theme.spacing[4],
  },
}));
```

Settings screen 使用的就是这个模式：screen background 在普通 `View style={styles.container}` 上，scroll content container 只承载 layout。

实践中我们主要使用 wrapper-`View` 模式。`withUnistyles` 现在保留给 leaf components，例如 lucide icons（`ThemedActivityIndicator`、`ThemedChevronDown` 等）和小型第三方组件（如 `MarkdownWithStableRenderer`），让它们能响应 theme 的 `color` / `tintColor` props，同时不重渲染 parent。

理论上 `withUnistyles(ScrollView)` 也能通过 auto-mapping 让 `contentContainerStyle` 响应 theme。我们曾在 welcome screen 上这样做，并踩到下方 `> *` 子选择器泄漏。因此如果想用 `withUnistyles(ScrollView)`，先把它当作 smell，检查 wrapper view 是否可行。

## `withUnistyles` 和 `> *` 子选择器泄漏

Web 上，`withUnistyles` 包住带 theme-dependent `style` prop 的组件时，会外包一层 `<div style={{display: 'contents'}} className={hash}>`，并把样式作为 `.hash > *` 子选择器发出，让样式 cascade 到被包组件。这就是 web 上 `style` 和 `contentContainerStyle` auto-mapping 的实现方式。

锋利边界：Unistyles 按值 hash style。如果 `withUnistyles` 收到的 style 值和 app 其他地方 plain `View` 使用的 style 完全相同，两者得到同一个 hash；元素规则和 `> *` 子规则都会用同一个 class name。`> *` 规则就会泄漏到所有共享该 hash 的 `View` 的直接 children 上。

真实回归：`welcome-screen.tsx` 中 `ThemedScrollView = withUnistyles(ScrollView)` 使用了 `style={{ flex: 1, backgroundColor: theme.colors.surface0 }}`。`panels/agent-panel.tsx` 的 `root` 和 `container` 有完全相同的值。三者 hash 碰撞到 `unistyles_j2k2iilhfz`，浏览器 stylesheet 中出现：

```css
.unistyles_j2k2iilhfz {
  flex: 1 1 0%;
  background-color: var(--colors-surface0);
}
.unistyles_j2k2iilhfz > * {
  flex: 1 1 0%;
  background-color: var(--colors-surface0);
}
```

子选择器把 `flex:1` 和 `background-color: surface0` 强加给 Composer 外层 `Animated.View`，导致 composer UI 和屏幕底部之间出现大空隙，也在 scroll-to-bottom button 后面涂了一条 `surface0`。该 bug 只出现在浏览器；Electron 配对后跳过 `WelcomeScreen`，所以没有注入 `> *` 规则。

排查症状：

- themed panel-background `View` 的 sibling 只在 web 上异常拉伸。
- `{ flex: 1, backgroundColor: surface0 }` 的 `View` 的直接子元素莫名拿到背景。
- DevTools 中看到你没有写过的 `.unistyles_xxx > *` 规则。

DevTools 快速确认：

```js
[...document.styleSheets]
  .flatMap((s) => [...(s.cssRules || [])])
  .map((r) => r.cssText)
  .filter((t) => t.includes("unistyles") && t.includes("> *"));
```

除了 react-native-web 的 benign `r-pointerEvents-* > *` 规则外，其他命中都要怀疑泄漏。

避免方式：优先使用 wrapper-`View` 模式，把 `{ flex: 1, backgroundColor: surface0 }` 放在 plain `View`，给 `ScrollView` theme-free 的 `style` / `contentContainerStyle`。只有 wrapper view 真不合适时才用 `withUnistyles(ScrollView)`；使用时给 wrapped style 一个不容易和常见 panel background hash-collide 的独特形状。

## 隐藏的 sheet content

`@gorhom/bottom-sheet` 可能在 sheet 隐藏时仍保持 `BottomSheetModal` content mounted。Doya startup theme transition 时这很重要：header node 可能在 initial adaptive theme 下创建，隐藏保持 mounted，稍后出现时 native style value 仍旧。

我们在 `AdaptiveModalSheet` 遇到过：body text 和 buttons 已正确变成 dark theme，但 shared sheet title 仍以初始 light-theme text color 打开。对 reusable sheet header 中的小值，优先使用 inline escape hatch：

```tsx
const { theme } = useUnistyles();

<Text style={[styles.title, { color: theme.colors.foreground }]}>{title}</Text>;
```

Layout 和 typography 留在 `StyleSheet.create`；只把 stale 的 theme-dependent value 通过 React 传递。如果更大 subtree 有同类问题，考虑在 theme 变化时 remount sheet，或把 themed paint 移到与可见内容一起 mounted 的 wrapper。

Bottom-sheet 的 `backgroundStyle`、`handleIndicatorStyle` 等 props 也遵循同一规则：它们是 library props，不是 Unistyles 注册的 direct React Native `style` prop。优先用调用 `useUnistyles()` 的 custom `backgroundComponent`，或从 hook theme 传一个小 inline object。

## 被 memo 的样式对象

第三方库收到 plain style object 时，它不在 Unistyles native tracking path 内。构建该 object 的 memo 必须依赖它实际读取的 theme 值。

避免间接 key：

```tsx
const { theme, rt } = useUnistyles();
const markdownStyles = useMemo(() => createMarkdownStyles(theme), [rt.themeName]);
```

Adaptive system-theme 变化时，hook 可能提供 light/dark theme 更新，但间接 runtime key 不一定是让 memo 失效的值。这会让库渲染旧颜色。Assistant markdown 曾经正是这样：workspace shell 切到 light 后，assistant text 和 code span 仍保留旧 dark-theme markdown style object。

优先依赖 hook theme 本身，或显式 theme token：

```tsx
const { theme } = useUnistyles();
const markdownStyles = useMemo(() => createMarkdownStyles(theme), [theme]);
```

如果 style factory 很便宜，完全跳过 `useMemo` 也可以。

## 静态 theme imports

不要从 `@/styles/theme` import `theme` 用于 live UI colors。这个 export 是 dark-theme 兼容默认值，在 render code 中使用会让 icons、placeholders 或第三方 props 在 light mode 下仍固定为 dark colors。

改用 `withUnistyles` 包 icon 或其他 leaf component，让只有该节点在 theme 变化时 re-render：

```tsx
import { ChevronDown } from "@/components/icons/lucide";
import { StyleSheet, withUnistyles } from "react-native-unistyles";

const ThemedChevronDown = withUnistyles(ChevronDown);

const styles = StyleSheet.create((theme) => ({
  icon: { color: theme.colors.foregroundMuted },
}));

<ThemedChevronDown size={theme.iconSize.md} style={styles.icon} />;
```

这是当前 app 的主流模式，见 `sidebar-workspace-list.tsx`、`message.tsx` 和 workspace screens。`useUnistyles()` 只留给上文明确说明的极少数 escape hatch。导入 `baseColors`、theme-name constants 或 `type Theme` 在值确实静态或仅类型时是可以的。

## Reanimated `Animated.View` 加动态样式会崩溃

不要把 `StyleSheet.create((theme) => ...)` 样式应用到 Reanimated `Animated.View`。Unistyles 会用 `<UnistylesComponent>` 包 styled component，并通过 ShadowRegistry 从 C++ patch native view props。Reanimated 也会从 worklet runtime 修改同一个 native node。Theme change 触发时，两个系统同时 mutate 同一 node，app 会 crash：`Unable to find node on an unmounted component.` 这是一次真实 iOS sidebar theme toggle crash（commit `4896cfe9`）。

修复：`Animated.View` 上的静态定位使用普通 React Native `StyleSheet`，theme-dependent value（如 `backgroundColor`）从 `useUnistyles()` 作为 inline style 传入。这里 inline path 可以接受，因为没有其他逃生口：

```tsx
import { StyleSheet as RNStyleSheet } from "react-native";
import Animated from "react-native-reanimated";
import { useUnistyles } from "react-native-unistyles";

const positionStyles = RNStyleSheet.create({
  sidebar: { position: "absolute", inset: 0, width: 280 },
});

function Sidebar() {
  const { theme } = useUnistyles();
  return (
    <Animated.View
      style={[positionStyles.sidebar, animatedStyle, { backgroundColor: theme.colors.surface1 }]}
    />
  );
}
```

这是少数 `useUnistyles()` 合理的地方：没有 `withUnistyles(Animated.View)` 等价物，受影响组件很小，替代方案是 crash。

## 自适应主题和持久化设置

Unistyles 的 `initialTheme` 和 `adaptiveThemes` 互斥。`initialTheme` 可以是字符串或同步函数，但不能等待 async storage。

Doya 当前把 app settings 存在 AsyncStorage，并通过 react-query 加载。这意味着 app 可能先在 adaptive/system theme 下 mount，然后在 settings 加载后切换：

1. Unistyles config 以 `adaptiveThemes: true` 启动。
2. 设备可能报告 system light。
3. Settings 加载到 persisted non-auto preference，例如 dark。
4. App 调用 `setAdaptiveThemes(false)` 和 `setTheme("dark")`。

在当前存储模型下，这个短暂过渡是预期行为。它要求所有 tracking-compatible styles 在 initial adaptive theme 下 mounted 后，也能在 persisted preference 生效时正确更新。Issue #550 是另一个 ScrollView sticky-header bug，但也提醒我们 ScrollView theme updates 要格外怀疑。

如果未来必须完全避免这个过渡，至少把 theme preference 存到同步 storage，并用 `initialTheme` 配置 Unistyles。

## 用户偏好的 runtime theme patching

Appearance settings（UI/mono font family、font sizes、syntax-highlight theme）通过 `UnistylesRuntime.updateTheme(name, updater)` 在 runtime patch 所有已注册 theme，而不是把 preference 一路传到组件。`packages/app/src/screens/settings/appearance/apply-appearance.ts` 中的 `applyAppearance` 会在 `ProvidersWrapper` effect 中随 settings load/change 运行，遍历六个 theme key，并返回 `{ ...theme, fontFamily, fontSize, lineHeight, colors.syntax }`。

这个方案不需要 `useUnistyles()`，因为所有 consumer 已通过 `StyleSheet.create((theme) => …)` 读取 token，或者通过 `withUnistyles` / `uniProps` 路径给 markdown renderer 使用。Patch theme 会让 ShadowRegistry repaint 被追踪的 view，不触发 React re-render。

注意事项：

- **Patch 所有 theme，不只 active theme。** Active theme 会切换，adaptive mode 也可能翻转 light/dark。Patch 每个 key 可以保证当前 active key 总是最新，并让 `setTheme` / `setAdaptiveThemes` 的顺序无关。Effect 依赖 settings values，而不是 `theme`，所以不会循环。
- **Spread 前先缩小 discriminated union。** `updateTheme` updater 返回 theme union；直接 spread union 会把 `colorScheme` 扩宽成 `"light" | "dark"`，无法赋给任一具体成员。根据 `t.colorScheme` 分支，让每个分支 spread 单一 narrowed theme type，不要用 `as`。
- **`lineHeight.diff` 是 code/diff line-height 轴。** 它与 code-font-size control 绑定（约 `codeFontSize * 1.5`）。不要用于 prose。Markdown body line-height 跟 UI ramp 缩放（`Math.round(theme.fontSize.base * 1.4)`）；把 prose 走 `lineHeight.diff` 会在小 code size 下裁切文本。
- **高频 draft values**（appearance preview 输入时实时变化）绕过 theme：用 `inlineUnistylesStyle` 作为 inline style，避免每次击键都增长 `#unistyles-web` CSS registry。
- **Mounted parsed content 使用 `AppearanceStyleBoundary`。** Markdown、syntax-highlighted code 和 tool-call detail body 可能包含 memoized/custom renderer trees，不会自然响应 runtime-patched appearance tokens。用 `packages/app/src/components/appearance-style-boundary.tsx` 在 parsed surface 外包一次；不要在每个 callsite 加本地 `appearance key` props。
- **Dynamic font tokens 保持 widened。** `commonTheme` 上的 `fontFamily`、`fontSize` 和 `lineHeight` 标注为 `string` / `number`，不要被 `as const` narrow，这样 updater return 才能赋值；平台默认栈在 `DEFAULT_UI_FONT_STACK` / `DEFAULT_MONO_FONT_STACK`。

## 调试

要查看 Babel plugin 识别到什么，可临时在 `packages/app/babel.config.js` 中开启 `debug: true`：

```js
[
  "react-native-unistyles/plugin",
  {
    root: "src",
    debug: true,
  },
],
```

然后重新构建 bundle，查找类似输出：

```text
src/components/welcome-screen.tsx: styles.container: [Theme]
```

这只能确认 stylesheet dependency 被检测到。它不能证明你关心的 native view 上注册了 style prop。

Paint-layer bug 使用高对比探针：

1. 把每个候选层涂成不同颜色，例如 root wrapper cyan、`ScrollView.style` yellow、`contentContainerStyle` magenta。
2. 冷启动 app，不只是 Fast Refresh。
3. 截 simulator 图并采样像素，确认哪个颜色填充区域。
4. 提交前删除探针。

Welcome-screen 排查就是用这个方法证明白色层来自 `ScrollView` content container。深入证据在 [welcome-theme-split-research.md](/Users/moboudra/.doya/notes/welcome-theme-split-research.md)。

## 参考

- [Unistyles v3 documentation](https://www.unistyl.es/)
- [Theming: initial theme, adaptive themes, and runtime theme changes](https://www.unistyl.es/v3/guides/theming)
- [ScrollView Background Issue](https://www.unistyl.es/v3/tutorial/settings-screen#scrollview-background-issue)
- [withUnistyles reference](https://www.unistyl.es/v3/references/with-unistyles)
- [3rd-party view decision algorithm](https://www.unistyl.es/v3/references/3rd-party-views)
- [Babel plugin debug option](https://www.unistyl.es/v3/other/babel-plugin#debug)
- [Why my view doesn't update?](https://www.unistyl.es/v3/guides/why-my-view-doesnt-update)
- [GitHub issue #550: ScrollView sticky-header theme updates](https://github.com/jpudysz/react-native-unistyles/issues/550)
- [GitHub issue #817: `UnistylesRuntime.themeName` does not re-render](https://github.com/jpudysz/react-native-unistyles/issues/817)
- [GitHub issue #1030: `Image.tintColor` and native style update edge case](https://github.com/jpudysz/react-native-unistyles/issues/1030)
- [Local research note: welcome theme split](/Users/moboudra/.doya/notes/welcome-theme-split-research.md)
