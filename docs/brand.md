# Brand

This document is the source of truth for the product brand name and logo assets.

The brand is intentionally small, portable, and developer-friendly: a local AI coding environment in your pocket, represented by a sprout that is simple enough to work at 24px.

---

## Names

| Context | Name | Notes |
| --- | --- | --- |
| Chinese brand | 豆芽 | Primary Chinese name. Do not replace with synonyms. |
| English brand | Doya | Primary English name. Derived from 豆芽 / douya, but shortened for brand use. |
| Literal translation | Bean sprout | Meaning only. Do not use as the English product name. |

Use **豆芽** in Chinese-facing copy and **Doya** in English-facing copy.

Do not write `Douya`, `DoYa`, `DOYA`, `Bean Sprout`, or `BeanSprout` as product names unless a specific technical surface requires an identifier and the casing is documented there.

---

## Logo

The logo is a bean sprout mark. It should feel light, alive, and useful rather than cute, agricultural, or decorative.

Current app icon source:

- `packages/app/assets/icons/doya.svg` — primary transparent 24x24 SVG
- `packages/app/assets/icons/doya-24.png` — derived 24x24 transparent PNG

Supporting variants:

- `packages/app/assets/icons/doya-mono.svg` — monochrome `currentColor` icon for UI chrome
- `packages/app/assets/icons/doya-mono-24.png` — derived 24x24 monochrome PNG
- `packages/app/assets/icons/doya-light.svg` — experimental light-background tile, not the default
- `packages/app/assets/icons/doya-light-24.png` — derived 24x24 light-background PNG

The primary logo has **no background**. Use the transparent mark by default.

Only use a background tile when the platform or surface requires a filled app icon, badge, or launcher asset. Do not add a background to the primary logo files to solve contrast locally; choose a surface color that supports the transparent mark or use the monochrome variant.

---

## Color

Primary logo colors:

| Role | Hex |
| --- | --- |
| Stem | `#2E7D42` |
| Left leaf | `#43C463` |
| Right leaf | `#9BDB45` |
| Seed | `#D0A13A` |

The monochrome variant inherits `currentColor` and should be used when the mark needs to match surrounding UI text or icon color.

Avoid purple gradients, dark cyberpunk styling, beige/brown dominance, robot faces, and code-symbol clutter in brand marks. The sprout is the identity.

---

## Sizing

The source SVG uses a `24 x 24` viewBox and is designed to be legible at 24px.

Minimum practical sizes:

| Surface | Minimum |
| --- | --- |
| UI icon | 16px |
| Toolbar or sidebar icon | 20px |
| Primary app/logo usage | 24px |
| Marketing or splash usage | Redraw/export from SVG at the target size |

At sizes below 20px, prefer the monochrome variant if the colored seed and leaves become visually noisy.

---

## Asset Workflow

Treat SVG files as source files. PNG files are derived artifacts.

When editing the primary logo, update the SVG first:

```bash
rsvg-convert -w 24 -h 24 packages/app/assets/icons/doya.svg -o packages/app/assets/icons/doya-24.png
```

When editing a variant, regenerate its matching PNG with the same dimensions:

```bash
rsvg-convert -w 24 -h 24 packages/app/assets/icons/doya-mono.svg -o packages/app/assets/icons/doya-mono-24.png
rsvg-convert -w 24 -h 24 packages/app/assets/icons/doya-light.svg -o packages/app/assets/icons/doya-light-24.png
```

Do not hand-edit derived PNGs.

---

## Product Copy

Use the brand name plainly:

- Chinese: `豆芽`
- English: `Doya`

Acceptable short descriptions:

- Chinese: `把本地 AI 编程环境放进口袋`
- English: `Your local AI coding environment, in your pocket`

Keep product copy calm and concrete. Avoid mascot language, farming metaphors, and exaggerated agent autonomy claims.
