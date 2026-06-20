# 悬停

写任何 hover 代码前先读这份文档。我们每次发出的 hover 回归，基本都属于下面三类失败模式；它们都由同一个标准模式解决。这个模式是踩过很多坑后保留下来的，请复制它，不要重新发明。

## 标准模式

标准实现位于 `packages/app/src/components/sidebar-workspace-list.tsx`，在 workspace row 附近（约 1369 行）。拿不准时，打开那个文件照着结构写。

```tsx
//
//   ┌─ Plain View。通过 pointerenter/pointerleave 追踪 hover。
//   │
<View
  style={styles.workspaceRowContainer}
  onPointerEnter={handlePointerEnter}
  onPointerLeave={handlePointerLeave}
>
  <Pressable                          // ┐ 单独的内部 Pressable。
    onPress={handlePress}             // │ 只处理 press。
    onPressIn={...}                   // │ 永远不要有 onHoverIn/onHoverOut。
    onPressOut={...}                  // ┘
    style={workspaceRowStyle}
  >
    <View style={styles.workspaceRowMain}>
      <View style={styles.workspaceRowLeft}>…</View>
      <WorkspaceRowRightGroup isHovered={isHovered} />
      {/*                    └─ 根据 hover state 展开内容。 */}
    </View>
  </Pressable>
</View>
```

这个模式成立有五个关键点，每一个都重要：

1. **Hover 放在 plain `View` 上，不放在 `Pressable` 上。** `Pressable` 有自己的 hover 状态机，嵌套 `Pressable` 会互相抢状态。Plain `View` 只派发 DOM 事件。
2. **Press 放在单独的内部 `Pressable` 上。** Hover 和 press 不共享元素，两个状态机不会互相影响。
3. **`onPointerEnter` / `onPointerLeave` 不冒泡**，行为类似 W3C 规范里的 mouseenter。只有穿过外层 `View` 边界时才触发。进入后代元素，包括后代 `Pressable`，不会触发 `pointerleave`。这就是为什么内部放 kebab button、copy button 或 tooltip target 是安全的。
4. **Row 有固定 `minHeight`。** Hover 时内容互换，例如 kebab 替换 diff stat，两者占用同一个固定 slot。没有 layout shift，也没有几何抖动。
5. **外层 `View` 除 `position: relative` 外不承担布局。** 它只作为 hover target。真实布局都在内部 `Pressable` 上。hover tracker 像一个密封信封包住 row；内部布局变化不会从侧面泄露再触发状态变化。

## 跳过标准模式会坏什么

### 失败模式 1：嵌套 Pressable 抢 hover state

如果把 `onHoverIn` / `onHoverOut` 放在一个内部还包含其他 `Pressable` 的 `Pressable` 上，光标移到内部 `Pressable` 时，内部状态机会抢走 hover，外层触发 `onHoverOut`。展开内容隐藏，光标又回到触发区，外层再触发 `onHoverIn`，形成循环。

这是此代码库最常见的 hover bug。修复方式不是“聪明处理 handler”，而是不要在包含其他 pressable 的 `Pressable` 上追踪 hover。

**规则：** hover-tracking 元素必须是带 `onPointerEnter` / `onPointerLeave` 的 plain `View`。所有 `Pressable`，包括容易忘记的 `TurnCopyButton`、icon button、任何可点击控件，都放在它里面。

### 失败模式 2：hover state 改变了 trigger 几何

症状：hover 一个按钮，它改变外观，然后在 hovered / not-hovered 间闪烁，光标没动。

原因：hover state 改变了 trigger 的尺寸或位置。光标原本在旧元素上；新布局把元素移开或缩小，`onHoverOut` 触发；状态回退；旧布局回来；光标又在 trigger 上；`onHoverIn` 再触发，形成循环。

常见变体：

- Hover state 改变 trigger 的 `width`、`height`、`padding` 或 `borderWidth`。
- Hover state mount/unmount 子元素，导致 trigger 位置变化。
- Hover state 把 trigger 换成另一个元素类型，导致 remount。

优先修复顺序：

1. **Hover 时不要改变 trigger 外部几何。** 改颜色、opacity、不占布局空间的 border（web 上的 `outlineWidth` 或绝对定位 overlay），或者在固定盒子内切换子内容。不要改 hover target 本身的 `width`、`height`、`padding` 或 `borderWidth`。
2. **隐藏元素用 `opacity` + `pointerEvents`，不要条件渲染。** 如果隐藏元素在 trigger 内，hover 时 mount/unmount 会在光标下 reflow。
3. **固定命中区。** 给 trigger 设置固定 `minHeight` / `minWidth`，让内部图标互换不改变边界。Workspace row 的 `minHeight: 36` 就是为了稳定 kebab/diff-stat 切换。

### 失败模式 3：展开内容在 hover trigger 外面

如果 hover 元素 A 展开元素 B，B 必须在 A 的 hover trigger 内。如果 B 是 sibling，光标从 A 移向 B 时会离开 A 的边界，触发 `pointerleave`，B 消失。

错误：

```tsx
<View>
  <View onPointerEnter={...} onPointerLeave={...}>     {/* hover trigger */}
    <Bubble />
  </View>
  <TrailingRow />                                       {/* 外部 sibling */}
</View>
```

正确：

```tsx
<View onPointerEnter={...} onPointerLeave={...}>      {/* hover trigger */}
  <Bubble />
  <TrailingRow />                                      {/* 内部 child */}
</View>
```

A 和 B 之间的间隙，只要它们都在同一个父 hover trigger 内，就属于父元素边界，光标穿过时仍保持 hover。无需 bridge。

如果 A 和 B 确实不能共享父级，例如 B portal 到另一层、浮在其他内容上，见下方真实间隙部分。

## Native 兜底

触摸设备没有 hover。任何隐藏在 hover 后的内容，都必须在 native 和 compact 布局有非 hover 路径：

```tsx
const showControls = isHovered || isNative || isCompact;
```

`isNative` 和 `isCompact` 分别来自 `@/constants/platform` 和 `@/constants/layout`。不要用 `Platform.OS === "ios"` 代替。

`onPointerEnter` / `onPointerLeave` 是 DOM 事件，不会在 native 触发。通常不需要 gate；native 上 hover 不可达，可见性由上面的 `isNative` / `isCompact` 控制。这也是 workspace row 的 pointer events 没有包 `if (isWeb)` 的原因。

## `Pressable.onHoverIn` / `onHoverOut` 怎么用

如果一个 `Pressable` 只根据自己的 hover 改自己的样式，例如 icon button hover 变色，这是可以的。更推荐用 render prop：`<Pressable style={({ hovered }) => ...}>`。

如果 hover state 会被 `useState` 保存，并驱动该 `Pressable` 外部的内容，例如展开 sibling、打开 tooltip、显示 kebab，且内部存在任何其他 `Pressable`，就不能用 `onHoverIn` / `onHoverOut`。使用标准模式。

经验法则：如果 hover state 会被同一个 `Pressable` 自身样式以外的内容读取，不要用 `onHoverIn` / `onHoverOut`。用标准模式。

## 浮层的真实间隙

有些展开内容不能放在 trigger 内，例如 hover card portal 到另一层、tooltip 浮在上方、popover 渲染到 `Portal`。这时用户光标必须跨过一个真实视觉间隙。

这种情况使用 `useHoverSafeZone`（`packages/app/src/hooks/use-hover-safe-zone.ts`）。它会计算 trigger 和 content 之间的矩形 bridge；当 pointer 位于 trigger、content 或 bridge 内时，card 保持打开。短 grace timer 用于吸收边缘抖动。标准调用方是 `packages/app/src/components/workspace-hover-card.tsx`。

不要自己写。这里的几何和边界条件很烦，包括 pointer 离开窗口、拖拽中、content unmount 等，我们已经为这个 hook 付过成本。

## PR 前检查清单

提交涉及 hover 的 PR 前确认：

- [ ] Hover-tracking 在 plain `View` 上，使用 `onPointerEnter` / `onPointerLeave`，而不是包住 pressable 内容的 `Pressable`。
- [ ] Press 行为在单独内部 `Pressable` 上，并且没有 `onHoverIn` / `onHoverOut`。
- [ ] Hover trigger 的边界包含用户交互时可能移入的所有元素。
- [ ] Hovered state 不改变 trigger 外部几何：`width`、`height`、`padding`、`borderWidth`，也不会 mount/unmount 导致 sibling 位移。
- [ ] trigger 内的展开内容如果 mount 会 reflow，则用 `opacity` + `pointerEvents` 隐藏，而不是条件渲染。
- [ ] Native 和 compact 布局无需 hover 也能看到控件：`isHovered || isNative || isCompact`。
- [ ] 如果展开内容在独立层（portal、floating panel），已接入 `useHoverSafeZone`。
- [ ] 已打开 dev server，hover trigger，并沿着每个展开元素和可见间隙慢慢移动鼠标，确认不会丢失 hover state。
