# Design

Tokens - every color, font size, weight, spacing step, radius, icon size, and
theme variant - live in `packages/app/src/styles/theme.ts`.

This document is the product design contract for Doya. It tells agents what to
copy, what to avoid, and how the upgraded brand should feel in app code.

---

## 1. Brand Character

Doya is a local AI coding environment in your pocket. The brand is a sprout:
small, alive, useful, and quietly optimistic.

The UI should feel:

- **Light** - generous air, soft surfaces, clear reading paths.
- **Alive** - green accents, subtle growth metaphors, responsive surfaces that
  feel attentive without being animated for show.
- **Capable** - dense enough for real engineering work, never toy-like.
- **Calm** - no cyberpunk, no neon agent theater, no dashboard noise.
- **Local-first** - trustworthy, direct, practical. The user's code and
  environment are the center, not the model.

The sprout is not a mascot. Do not add cute language, farming metaphors, robot
faces, decorative leaves, or brand illustrations where a real control surface is
needed. Doya's personality comes from restraint, clarity, and small moments of
warmth.

---

## 2. Visual Direction

Doya's visual system is light by default and grounded in layered neutrals with a
green brand accent.

Use the semantic surface ladder:

- `surface0` - app/workspace background.
- `surface1` - subtle hover and quiet grouped areas.
- `surface2` - inputs, badges, controls, elevated panels.
- `surface3` - stronger controls or selected affordances.
- `surface4` - rare extra emphasis.
- `surfaceSidebar` / `surfaceSidebarHover` - sidebar-specific depth.
- `surfaceWorkspace` - main working canvas.

Use `accent` for the primary Doya action. Current light-theme accent is a calm
sprout green (`#20744A` in `theme.ts`), with `accentBright` for small livelier
touches. Green should feel like life and readiness, not success spam. Success
state uses semantic status tokens, not every green value in reach.

Avoid:

- Purple gradients and AI-glow styling.
- Dark cyberpunk panels as the default product feel.
- Beige/brown/espresso dominance.
- Blue SaaS genericity as the main brand signal.
- Decorative blobs, glass cards, bokeh, excessive shadows, and novelty chrome.
- Raw hex values outside token definitions or documented one-off assets.

The app can be dark, zinc, midnight, claude, or ghostty themed, but the product
design still follows the same restraint: surfaces, text, controls, then accent.

---

## 3. Component Reuse

Consistency comes from primitives, not hand-matched styles.

A semantic element used in three or more places is a primitive. One of a kind is
a screen.

Primitives live in:

- `packages/app/src/components/ui/`
- `packages/app/src/components/headers/`
- `packages/app/src/styles/settings.ts`
- `packages/app/src/screens/settings/settings-section.tsx`

Before adding a component, read `components/ui/`. The primitive usually exists.

Use these primitives by default:

- Button: `<Button>`
- Page alert: `<Alert>`
- Loading: `<LoadingSpinner>`
- Status pill: `<StatusBadge>`
- Triggered menu: `<DropdownMenu>`
- Right-click/long-press menu: `<ContextMenu>`
- Searchable picker: `<Combobox>`
- Binary setting: `<Switch>`
- Segmented choice: `<SegmentedControl>`
- Focused task: `<AdaptiveModalSheet>`
- Destructive confirmation: `confirmDialog`
- Headers: `<BackHeader>`, `<MenuHeader>`, `<ScreenHeader>`, `<ScreenTitle>`,
  `<HeaderIconBadge>`

A styled `Pressable` pretending to be a button is wrong. A bare `Text`
pretending to be a section label is wrong. A raw `Modal` for a focused task is
wrong. A custom status pill is wrong.

---

## 4. Logo And Brand Assets

Brand asset rules live in [brand.md](brand.md). Use that doc before touching
logos, favicons, app icons, or product names.

The primary logo is the filled sprout tile from:

- `packages/app/assets/icons/doya.svg`
- `packages/app/assets/icons/doya-24.png`
- `packages/app/assets/icons/doya-app-icon.svg`

Use the filled tile by default. Use the transparent sprout only when the
surrounding surface already supplies an appropriate background.

Do not hardcode the product name in React components. Runtime copy goes through
i18n:

- `brand.name` for the standalone brand.
- `{brand}` inside translation strings.

English-facing copy uses `Doya`. Chinese-facing copy uses `豆芽`. Do not write
`Douya`, `DoYa`, `DOYA`, `Bean Sprout`, or `BeanSprout`.

---

## 5. Type And Hierarchy

Hierarchy is mostly weight, color, spacing, and placement, not big type.

Most app text is `fontSize.base` or `fontSize.xs`. Reserve larger type for
first-run, marketing, and true empty-start moments. Dense app surfaces should
not look like landing pages.

Weight has three tiers:

- **Screen titles** use `<ScreenTitle>`. Do not override its responsive weight.
- **Structural labels** use `fontWeight.medium`: section labels, modal/sheet
  titles, dense metadata emphasis, and compact action labels.
- **Content** uses `fontWeight.normal`: row titles, body text, button labels,
  badge text, sidebar callout titles, and list item titles.

Foreground roles:

- `foreground` - the thing being acted on or read first.
- `foregroundMuted` - context, secondary metadata, placeholders, idle rows,
  helper text, status copy.

Do not use size escalation to solve unclear hierarchy. If a screen feels flat,
fix grouping, order, spacing, or copy first.

---

## 6. Layout Density

Doya is spacious, not sparse. It should make room for thinking while staying
fast for repeated work.

Settings, project detail, and other reading/detail pages sit in a centered
max-width column around 720px. Workspace, chat, file, terminal, diff, and
document surfaces use the full available canvas.

Rhythm:

- Page - spacious.
- Section - spacious.
- Card - tight.
- Row - generous touch target.

Rows inside cards touch and are separated by one top divider after the first
row. Lists that are the page content use spacing and surface, not card borders
around every row.

Do not compress rows to fit more items. More information means better grouping,
progressive disclosure, tabs, search, or a dedicated detail surface.

---

## 7. Surfaces, Borders, And Elevation

Prefer layers over shadows.

Use borders to group and separate:

- One border around a logical card of related rows.
- One top divider between rows inside a card.
- One bottom border under pane chrome.
- One subtle border for low-emphasis outline buttons and inputs.

Do not put cards inside cards. Do not make page sections floating cards. Do not
outline single random elements just to make them feel designed.

Shadows are rare. If a surface is not modal, floating, or above other content,
it probably does not need a shadow.

Rounded corners are practical, not cute. Most app cards and controls stay tight
and calm. Large pill shapes are for true pills or compact controls, not every
container.

---

## 8. Buttons And Actions

`<Button>` is the only button primitive.

Variants:

- `default` - one primary action on a surface, filled with `accent`.
- `secondary` - common paired action, filled with `surface3`.
- `outline` - low-frequency row or detail action.
- `ghost` - structural chrome, navigation, and low-emphasis affordances.
- `destructive` - only inside confirmation UI.

There is at most one `default` button per surface. Many surfaces have zero. The
composer, active pane, or current selection is often already the primary action.

Destructive is a confirmation state, not a page decoration. Restart, remove,
delete, archive with local risk, and similar actions use quiet page controls and
surface the red destructive action inside `confirmDialog`.

Buttons use icons when the action is tool-like or spatial. Use lucide icons when
available. Text buttons are for clear commands. Do not wrap `Text` in
`Pressable` to make a sixth button variant.

---

## 9. Navigation And Responsiveness

Compact-first. The small layout is designed; desktop adds room and chrome.

Canonical patterns:

- **List + detail**: compact pushes from list to detail with `<BackHeader>`;
  desktop uses a 320px sidebar plus a detail pane with `<ScreenHeader>`,
  `<HeaderIconBadge>`, and `<ScreenTitle>`.
- **Workspace**: compact collapses tabs; desktop supports split panes.
- **Sidebar**: compact overlays; desktop pins.
- **Focused task**: bottom sheet on compact, centered modal card on desktop.

Use `useIsCompactFormFactor()` for layout. Do not use `Platform.OS` as a proxy
for screen size. Keep list and detail components shared between compact and
desktop; only the shell changes.

New list/detail features copy the settings/projects shell. New workspace-shaped
features copy the workspace shell. A third pattern needs design review.

---

## 10. Working Surfaces

Doya is an agent workbench. The main surfaces are not marketing pages.

Workspace, terminal, diff, file explorer, browser, document viewer, and agent
timeline surfaces should prioritize:

- Scanning.
- Selection.
- Fast switching.
- Clear current state.
- Low-latency feedback.
- Stable geometry.

Toolbars are compact and icon-forward. Pane chrome uses one border and small
controls. Avoid hero-scale headings, explanatory cards, decorative illustrations,
or onboarding copy inside recurring work surfaces.

The composer is a command surface. Keep it focused, readable, and reachable.
Provider/model/mode controls are agent controls, not status decoration.

---

## 11. Copy And Voice

Copy is calm, concrete, and short.

Use sentence case:

- "Pair a device"
- "Danger zone"
- "Restart daemon"
- "Inject Doya tools"
- "No sessions yet"
- "Load more"

No trailing periods on row titles, labels, buttons, or single-clause hints.
Multi-sentence descriptions use normal punctuation.

Buttons are imperative:

- Save
- Cancel
- Restart
- Remove
- Update
- Install update
- Add host
- Load more

In-flight labels use a literal three-dot ellipsis:

- "Saving..."
- "Restarting..."
- "Removing..."
- "Loading..."

Error copy is direct. Say "Unable to remove host", not "Sorry, we couldn't
remove the host." Recovery instructions are concrete.

All new user-visible app copy goes through `packages/app/src/i18n/translations.ts`
with flat keys like `domain.surface.intent`. See [i18n.md](i18n.md). Do not add
new hardcoded Chinese or English UI strings in components.

Terminology comes from [glossary.md](glossary.md). UI label wins. In particular:

- Project, not repo or repository.
- Workspace, not checkout, folder, or directory.
- Host, except when the user-facing concept is the daemon process itself.
- Provider, not model provider.
- Agent, not task, job, or run.
- Session and agent are distinct.
- Composer is the whole prompt surface; composer input is only the text-entry
  surface.

---

## 12. States And Feedback

State appears at the smallest scope it affects.

Loading:

- Inline by default with `<LoadingSpinner size={14} color={foregroundMuted} />`.
- Page-level only when the whole page is unavailable.
- Card-level loading is usually a short muted line, not a large spinner.
- Dropdown items use their own pending state.

Empty states:

- Short noun phrases or short sentences.
- Muted, centered only when the whole area is empty.
- One obvious recovery action at most.
- No illustrations unless the surface is first-run or brand-level.

Errors:

- Field error stays under the field.
- Page error uses `<Alert>`.
- Flow-stopping error uses React Native `Alert.alert`.
- Partial failure keeps usable content visible and shows a small banner for the
  failed source.

Disabled state is opacity on the outer pressable. Do not invent disabled colors.

Sidebar-wide notices use `<SidebarCallout>` registered through
`useSidebarCallouts()`. Page-local notices use `<Alert>`. Do not import
`<SidebarCallout>` into page content.

---

## 13. Rows, Lists, And Menus

Rows have a content column and an optional trailing slot.

Inside cards, use `settingsStyles.row`. Inside sidebar lists, use the established
sidebar row shape with per-row radius and hover/selected states.

Rows that navigate use a trailing chevron. Kebab menus are row actions, not
navigation. A row may have both: kebab before chevron.

Switches and segmented controls live in the trailing slot. If a row both
navigates and toggles, stop propagation from the control.

Kebab actions use:

- `<DropdownMenu>`
- `<MoreVertical size={14} />`
- `align="end"`
- `<DropdownMenuItem leading={<Icon size={14} ... />} />`

Hover-revealed row controls follow [hover.md](hover.md): plain outer `View` with
`onPointerEnter` / `onPointerLeave`, separate inner `Pressable`, stable geometry,
and `isHovered || isNative || isCompact` visibility.

---

## 14. Pickers And Modals

Choose the primitive by interaction shape:

- Small fixed set: `<DropdownMenu>`.
- Large or searchable set: `<Combobox>`.
- Right-click or long-press target actions: `<ContextMenu>`.
- Focused multi-field task: `<AdaptiveModalSheet>`.
- Destructive yes/no: `confirmDialog`.

Three themes is a dropdown. Thirty hosts is a combobox. A label/value editing
task is an adaptive modal sheet. "Are you sure?" is a confirm dialog.

Do not use raw `Modal` for normal app tasks.

---

## 15. Status And Semantic Color

Status is semantic, not decorative.

Status pills use `<StatusBadge>`. The pattern is a semantic foreground color on
a 10%-alpha background of the same color. Success is green, warning is amber,
danger is red, muted is zinc, merged is purple when needed by git/review state.

Status dots use `statusSuccess`, `statusWarning`, `statusDanger`, or
`foregroundMuted` and appear in row trailing slots or beside status labels.

Do not make every positive thing green. Brand green is for Doya identity and the
primary action; status green is for actual success/healthy states.

---

## 16. Theme And Unistyles

Theme-aware styles use Unistyles, but the hook has sharp edges. Read
[unistyles.md](unistyles.md) before touching theme behavior.

Rules:

- Never add `useUnistyles()`.
- Use `StyleSheet.create((theme) => ...)` by default.
- Use static constants for genuinely static values.
- Use `withUnistyles(Component)` only for leaf third-party props that must react
  to theme.
- Use `inlineUnistylesStyle` for high-churn measured styles on web, such as
  pointer-driven positions, dimensions, and transforms.
- Keep themed backgrounds on wrapper views instead of themed
  `ScrollView.contentContainerStyle`.

Do not split a component into plain/web/native variants just to work around one
high-churn style value. Mark the specific style object with the inline escape
hatch.

---

## 17. Platform Gates

The app runs on iOS, Android, browser web, and Electron web.

Default to cross-platform code. Gate only for a specific capability:

- DOM APIs: `isWeb`.
- Native-only APIs: `isNative`.
- Electron bridge APIs: `getIsElectron()`.
- Layout changes: `useIsCompactFormFactor()`.

Prefer Metro file extensions when implementations are fundamentally different:

- `.web.ts` / `.web.tsx`
- `.native.ts` / `.native.tsx`
- `.electron.ts` / `.electron.tsx`

Raw DOM APIs without `isWeb` are forbidden. `Platform.OS` is not a layout
breakpoint.

---

## 18. Forbidden

- New hardcoded UI strings in React components.
- Hardcoded product names instead of i18n brand keys.
- `fontWeight.medium` on row titles, body text, button labels, badge text, or
  sidebar callout titles.
- `<Pressable>` wrapping `<Text>` to make a button.
- Bare `<Text>` for settings section headers.
- Raw `Modal` for focused tasks.
- Bespoke status pills.
- Importing `ActivityIndicator` directly.
- Raw DOM APIs without an `isWeb` guard.
- `Platform.OS` as a layout proxy.
- New color tokens or raw hex outside token definitions.
- Purple AI gradients, neon glows, decorative blobs, robot faces, or sprout
  mascot UI.
- Spacing values outside the theme scale.
- Placeholder text dimmed beyond `foregroundMuted`.
- Color changes for disabled state; use opacity.
- Destructive actions without `confirmDialog`.
- `Pressable.onHoverIn` / `onHoverOut` for hover-to-reveal state when nested
  pressables are involved.
- Cards inside cards or page sections styled as floating cards.
- Drive-by visual restyles unrelated to the task.

---

## 19. Canonical Surfaces

| Pattern                                             | Reference                                                                                                                                                                                                                                                                                                |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| List + detail (compact stack, desktop sidebar+pane) | `packages/app/src/screens/settings-screen.tsx`, `packages/app/src/screens/projects-screen.tsx`                                                                                                                                                                                                           |
| Detail card + row                                   | `packages/app/src/screens/settings/host-page.tsx`, `packages/app/src/screens/settings/providers-section.tsx`                                                                                                                                                                                             |
| Section grouping inside card list                   | `packages/app/src/screens/settings/settings-section.tsx`                                                                                                                                                                                                                                                 |
| Form modal                                          | `packages/app/src/components/add-host-modal.tsx`, `packages/app/src/components/pair-link-modal.tsx`, `packages/app/src/components/project-picker-modal.tsx`                                                                                                                                              |
| Destructive confirmation                            | `confirmDialog` in `packages/app/src/utils/confirm-dialog.ts`                                                                                                                                                                                                                                            |
| First-run brand moment                              | `packages/app/src/components/welcome-screen.tsx`                                                                                                                                                                                                                                                         |
| Sidebar lists                                       | `packages/app/src/components/sidebar-workspace-list.tsx`, `packages/app/src/components/left-sidebar.tsx`                                                                                                                                                                                                 |
| Live agent list                                     | `packages/app/src/components/agent-list.tsx`                                                                                                                                                                                                                                                             |
| Historical sessions list                            | `packages/app/src/screens/sessions-screen.tsx`                                                                                                                                                                                                                                                           |
| Workspace panes                                     | `packages/app/src/screens/workspace/workspace-screen.tsx`                                                                                                                                                                                                                                                |
| Composer                                            | `packages/app/src/composer/index.tsx`, `packages/app/src/composer/input/input.tsx`                                                                                                                                                                                                                       |
| Pane chrome                                         | `packages/app/src/git/diff-pane.tsx`, `packages/app/src/components/file-explorer-pane.tsx`, `packages/app/src/components/terminal-pane.tsx`                                                                                                                                                             |
| Page alert                                          | `packages/app/src/components/ui/alert.tsx`, `packages/app/src/screens/project-settings-screen.tsx`                                                                                                                                                                                                       |
| Sidebar callout                                     | `packages/app/src/components/sidebar-callout.tsx`, `packages/app/src/contexts/sidebar-callout-context.tsx`, `packages/app/src/components/worktree-setup-callout-source.tsx`, `packages/app/src/desktop/updates/rosetta-callout-source.tsx`, `packages/app/src/desktop/updates/update-callout-source.tsx` |
| Searchable picker                                   | `packages/app/src/components/ui/combobox.tsx`, `packages/app/src/components/branch-switcher.tsx`                                                                                                                                                                                                         |
| Trigger-anchored menu                               | `packages/app/src/components/ui/dropdown-menu.tsx`                                                                                                                                                                                                                                                       |
| Right-click / long-press menu                       | `packages/app/src/components/ui/context-menu.tsx`                                                                                                                                                                                                                                                        |
| Headers                                             | `packages/app/src/components/headers/back-header.tsx`, `screen-header.tsx`, `menu-header.tsx`                                                                                                                                                                                                            |
