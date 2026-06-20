# 浮层

本文档记录锚定式浮层的坑：tooltip、hover card、dropdown、autocomplete 等在 iOS、Android 和 web 上视觉浮在 anchor 元素上方的面板。它不是教程；默认你已经看过标准文件，现在要新增或修改一个类似组件。

## 标准文件

| 文件                                     | 使用场景                                                        |
| ---------------------------------------- | --------------------------------------------------------------- |
| `components/ui/combobox.tsx`             | 带搜索的锚定 picker；移动端 fallback 到 bottom sheet            |
| `components/ui/tooltip.tsx`              | 非交互 hover/long-press tooltip                                 |
| `components/workspace-hover-card.tsx`    | desktop web hover card，使用 measure + computePosition + Portal |
| `components/ui/autocomplete-popover.tsx` | 锚定到聚焦 composer input 的 slash-command autocomplete         |

这些文件分别处理不同关注点：combobox 管 input focus，tooltip 非交互，hover-card 只面向 web desktop，autocomplete 要在 scrollable list 位于 Portal 时仍保持 composer input 聚焦。当前还没有共享的 `floating panel` primitive；等第五种用例出现再重新评估。现在优先复制最接近的文件并裁剪。

## 坑 1：Android touch hit-test 受父级边界限制

Android 上，子 View 如果超出父 View 边界，即使能正常渲染（默认 `overflow: visible`），也**收不到 touch 事件**。`ViewGroup.dispatchTouchEvent` 先按父级 hit rect 过滤 touch，再遍历 children。落在 overflow 区域的 touch 到不了父级，更到不了子级。iOS 和 web 没有这个规则；iOS hit-test 会进入 overflow children，web 使用标准 CSS pointer events。

Autocomplete 当初就是因此改到这条路径：popover 放在 parent 的 `bottom: 100%`，在 iOS/web 工作了几个月，但 Android touch 会直接穿透到后面的 chat scroll view。

代码库里有两个逃生口：

- **`Modal`**（combobox、native tooltip）：打开一个新的 Android window，hit-test 从新 window 开始。副作用是 Android 上 Modal 打开可能让底层 TextInput 失去 IME 绑定。对 combobox 可以，因为它有自己的 input；对 tooltip 可以，因为没有 input；对 autocomplete 不行，因为 composer input 必须保持聚焦。
- **`@gorhom/portal` 的 `<Portal>`**（hover-card、autocomplete-popover）：把 React subtree 提升到覆盖全屏的 mount point。仍在同一个 window，IME 不变，hit-test 可用，因为新 parent 是全屏。需要保持键盘绑定时，这是默认选择。按层级选择 host：app-global overlay 用 root host；content overlay 可以用当前 `FloatingPanelPortalHost`，这样 sliding sidebar 能盖住它。

是否能让底层 input 丢失键盘，决定使用 Modal 还是 Portal。

## 坑 2：Portal 打破生命周期和坐标系继承

Portal 解决 Android hit-test，但也逃离了两个你可能默认依赖的东西：

- **生命周期。** Portal subtree 挂在 app root，不在组件自然祖先链里。用户导航离开时，原组件可能仍 mounted（offscreen、tab 中），popover 也会留下。`visible` 必须叠加 screen-focus 信号。`agent-panel` 内 pane 已有 `isPaneFocused`，pane 切换时会变化；传 `visible={isYourOwnVisible && isPaneFocused}`。
- **Transform。** Composer 被 Reanimated `Animated.View` 包裹，并有 `translateY: -keyboardShift`（见 `use-keyboard-shift-style.ts`）。Chat content 也应用同一个 transform（`agent-panel.tsx:939`）。它们能同步移动，是因为共享 SharedValue。Portal 出去的 popover 不在 composer tree 里，除非你自己应用同一个 transform。
- **Layering。** 默认 root host 在 app content 后渲染，因此位于 compact sidebar 上方。必须低于 sidebar 的 content overlay 应使用当前 `FloatingPanelPortalHost`。
- **坐标系。** `measureInWindow` 返回 window 坐标。Portal 渲染在 host 内，host 未必在 window 原点。锚定内容应相对 host 定位：`anchorRect - hostRect`。这就是 `measureFloatingPanelPortalHost()` 的用途。

Transform 的修复见坑 3。

## 坑 3：Reanimated transform 与 `measureInWindow`

`measureInWindow` 返回 view 当前屏幕位置。理论上它包含 Reanimated transform，因为 Reanimated 更新 native view props，而 Android `getLocationInWindow` 读取 transformed coords。实际中它有竞态：measurement 可能截到动画中间帧，在 Android + Reanimated worklets 下结果并不总稳定。

如果 panel 不能留在 transformed ancestor 里，不要每帧重测来跟随键盘。正确做法是：**让 popover transform 从属于 composer 使用的同一个 SharedValue**。

1. 测量 anchor 时记录 `openShift = shift.value`。
2. 给 popover wrapper 应用 `useAnimatedStyle(() => ({ transform: [{ translateY: openShift.value - shift.value }] }))`。

当 `shift` 等于 `openShift` 时，translate 为 0，popover 位于测量位置。键盘之后移动时，delta 会让 popover 精确移动 composer 的同等距离。它们同步移动，无需重测。

只在 `Keyboard.addListener('keyboardDidShow'|'keyboardDidHide')` 时重测，用于修正 popover 打开时键盘正处于过渡中的 snapshot。

## 坑 4：平台 offset 之前先做 host-relative 定位

通用锚定 overlay 规则：

1. 用 `measureInWindow` 测量 anchor。
2. 用 `measureFloatingPanelPortalHost(hostName)` 测量 Portal host。
3. 使用相对 host 的 anchor 坐标定位：

```ts
left = anchorRect.x - hostRect.x;
bottom = hostRect.height - (anchorRect.y - hostRect.y) + offset;
```

先做这一步，再添加平台 offset。如果 anchor 和 host 都由 `measureInWindow` 测量，Android status-bar 坐标行为会抵消。只有 render surface 没有在同一坐标系测量时，才添加 status-bar offset。`tooltip.tsx` 是独立案例。

## 坑 5：两次测量导致闪一下

如果 popover 的 `top` 或 `left` 同时依赖：

- anchor 的屏幕位置（来自 `measureInWindow` 的 `anchorRect`），以及
- popover 自身尺寸（来自 `onLayout` 的 `contentSize`），

天真实现会在每次打开时闪过三个位置：

1. **第 1 帧**：等待 measurement 时用 `top: -9999` 或其他占位值渲染。wrapper 没有 `width`，内部内容按自然宽度布局，通常偏窄。
2. **第 2 帧**：`anchorRect` 到达。wrapper 有了 `anchorRect.width`。但第 1 帧的 stale `onLayout` 已经把窄宽度尺寸写入 `contentSize`。`top = anchorRect.y - wrongHeight - gap`，会在错误位置可见。
3. **第 3 帧**：真实宽度的 `onLayout` 触发，`contentSize` 更新，位置跳回正确位置。

第 2 帧的可见跳动就是闪烁。需要两个措施，缺一不可：

- **`anchorRect` 未就绪前不要 mount floating content。** 直接返回 `null`，避免错误宽度的 onLayout。
- **`anchorRect` 已就绪但 `contentSize` 未就绪时，用最终 width 渲染 wrapper，但 `opacity: 0`。** 第一次可见绘制已经在正确位置。Combobox 使用这个模式：`combobox.tsx:481, 876` 的 `shouldHideDesktopContent`。不要用 `top: -9999` 作为占位；layout 仍会在 -9999 发生，后续 state flash 仍可能可见。

“先不可见地测量，再显示”是本代码库解决鸡生蛋定位问题的标准方案。先用它，再考虑更复杂方案。

## 坑 6：Bottom sheet ref 不是生命周期真相

`@gorhom/bottom-sheet` modal 在 presenting/dismissing 期间会 churn imperative ref。不要把 `ref != null` 当成可以调用 `present()` 的许可，也不要把 `ref == null` 当成 sheet 已关闭。用户可见生命周期由期望的 `visible` prop 和 sheet callbacks（`onChange(-1)`、`onDismiss`）决定。

如果用户通过 backdrop 或 pan gesture 关闭 sheet，React state 承认 `visible=false` 前，sheet 可能 detach 再 reattach。此时重新 present 会和 Gorhom dismiss path 竞态，导致 modal 无法再次打开。需要显式 phase：`closed` / `presenting` / `presented` / `dismissing`，并在 dismissing 时忽略 ref churn。

## 新增锚定 panel 的步骤

写新组件前先问：

1. **底层 input 能不能失去键盘？** 可以就用 Modal，简单。不能就用 Portal。
2. **屏幕切换时 panel 是否需要关闭？** 几乎总是需要。用上游 focus prop gate `visible`，例如 `isPaneFocused`。
3. **panel 是否渲染在 Portal host 中？** 是的话也要测 host。不要把 raw window 坐标当作本地 Portal 坐标。
4. **panel 是否位于会随键盘移动的内容上方？** 是的话，transform 从属于同一个 SharedValue（坑 3）。不是的话，通常可以跳过 transform。
5. **panel 内容高度是否变化？** 是的话，positioning 同时需要 `anchorRect` 和 `contentSize`，应用坑 5：anchor 前 return null，contentSize 前 opacity 0。如果不是，且内容有已知固定 max height，可能可以用 bottom-anchored positioning（`bottom: windowHeight - anchor.y + gap`）跳过 `contentSize` 往返。但只有高度真的有界时才这么做。提交前验证。

然后复制最接近的标准文件并裁剪。
