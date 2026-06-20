# 品牌

本文档是产品品牌名称和 logo 资产的权威来源。

豆芽的品牌气质是小巧、便携、对开发者友好：把本地 AI 编程环境放进口袋。视觉标识是一颗豆芽，简单到在 24px 下也能清晰识别。

---

## 名称

| 场景     | 名称        | 说明                                           |
| -------- | ----------- | ---------------------------------------------- |
| 中文品牌 | 豆芽        | 主要中文名称，不要替换成同义词。               |
| 英文品牌 | Doya        | 主要英文名称，来自“豆芽 / douya”的品牌化缩写。 |
| 字面翻译 | Bean sprout | 只表示含义，不作为英文产品名。                 |

中文界面使用 **豆芽**，英文界面使用 **Doya**。

不要把产品名写成 `Douya`、`DoYa`、`DOYA`、`Bean Sprout` 或 `BeanSprout`，除非某个技术界面明确要求特定标识符并且已在文档中说明大小写。

运行时 app 文案必须走 i18n：

- 组件只需要渲染品牌名时使用 `brand.name`。
- 品牌名出现在句子中时，在翻译字符串里使用 `{brand}`。
- 不要在 React 组件中硬编码 `Doya` 或 `豆芽`。

持久化存储 key 可以保留旧品牌标识作为兼容输入。新写入应使用 Doya key，但旧 key 必须和当前 key 明确区分，避免清理代码误删新状态。

---

## 标识

logo 是豆芽标识。它应该显得轻盈、有生命力、实用，而不是可爱、农业化或装饰化。

当前 app icon 源文件：

- `packages/app/assets/icons/doya.svg`：主 24x24 填充 SVG，带完整浅绿色背景。
- `packages/app/assets/icons/doya-24.png`：由主 SVG 派生的 24x24 PNG。
- `packages/app/assets/icons/doya-app-icon.svg`：用于需要背景的 app/PWA 图标源文件。

辅助变体：

- `packages/app/assets/icons/doya-mono.svg`：历史文件名，透明背景的品牌色豆芽标识。
- `packages/app/assets/icons/doya-mono-24.png`：派生的 24x24 透明 PNG。
- `packages/app/assets/icons/doya-light.svg`：匹配主填充风格的浅背景 tile 变体。
- `packages/app/assets/icons/doya-light-24.png`：派生的 24x24 浅背景 PNG。

主 logo 带圆角浅绿色 tile 背景。默认使用填充版本。

只有当周围表面已经提供了合适背景时，才使用透明豆芽标识。普通品牌场景不要用透明主 logo 文件，除非是品牌标识本身需要的圆角 tile。

---

## 颜色

主 logo 色值：

| 角色 | Hex       |
| ---- | --------- |
| 茎   | `#2E7D42` |
| 左叶 | `#43C463` |
| 右叶 | `#9BDB45` |
| 种子 | `#D0A13A` |

透明豆芽标识使用同一组品牌色，只是不带 tile 背景。

品牌标识中避免紫色渐变、暗色赛博风、米色/棕色主导、机器人脸和代码符号堆叠。豆芽本身就是身份。

---

## 尺寸

源 SVG 使用 `24 x 24` 的 viewBox，并按 24px 可读性设计。填充 logo 变体使用内嵌的 `21.2 x 21.2` 圆角 tile，圆角为 `4.8` 个 viewBox 单位，让标识像现代 Apple 风格 app icon，但不会比相邻图标显得更大。豆芽主体约占源形状的 `72%`，以保留 Apple 风格的视觉留白。

最小实用尺寸：

| 场景               | 最小尺寸                        |
| ------------------ | ------------------------------- |
| UI 图标            | 16px                            |
| 工具栏或侧边栏图标 | 20px                            |
| 主要 app/logo 使用 | 24px                            |
| 营销或启动页       | 按目标尺寸从 SVG 重新绘制或导出 |

低于 20px 时，如果彩色种子和叶子显得杂乱，优先使用单色变体。

---

## 资产流程

SVG 是源文件。PNG 是派生产物。

编辑主 logo 时，先更新 SVG：

```bash
rsvg-convert -w 24 -h 24 packages/app/assets/icons/doya.svg -o packages/app/assets/icons/doya-24.png
```

编辑变体时，用相同尺寸重新生成对应 PNG：

```bash
rsvg-convert -w 1024 -h 1024 packages/app/assets/icons/doya-app-icon.svg -o packages/app/assets/images/icon.png
rsvg-convert -w 24 -h 24 packages/app/assets/icons/doya-mono.svg -o packages/app/assets/icons/doya-mono-24.png
rsvg-convert -w 24 -h 24 packages/app/assets/icons/doya-light.svg -o packages/app/assets/icons/doya-light-24.png
```

app、website 和 desktop 图标资产要保持视觉一致。desktop 的 `icon.ico`、`icon.icns`，website favicon，app PWA icons，以及动态 favicon 状态 PNG，都来自同一个圆角 tile 标识。

不要手工编辑派生 PNG。

---

## 产品文案

直接、稳定地使用品牌名：

- 中文：`豆芽`
- 英文：`Doya`

可接受的短描述：

- 中文：`把本地 AI 编程环境放进口袋`
- 英文：`Your local AI coding environment, in your pocket`

产品文案保持冷静、具体。避免吉祥物口吻、农业隐喻和夸张的 agent 自主性表述。
