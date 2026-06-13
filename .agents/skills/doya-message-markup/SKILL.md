---
name: doya-message-markup
description: Build Doya message-markup prompts that can be sent to an AI while rendering selected doya-* sections as special chat UI. Use when creating prompts with hidden task instructions, user-visible UI cards, structured AI reply formats, or text that mixes natural language with <doya-ui> blocks.
user-invocable: true
---

# Doya message markup

Use this skill when a prompt should be fully preserved in the conversation record and sent to the AI, while Doya renders selected parts as special UI instead of showing the raw implementation prompt.

## When to use this skill

Use this skill when building or modifying a feature that sends agent-facing prompts and any of these are true:

- A UI action expands into a detailed workflow prompt, such as applying PPT preview annotations, exporting generated files, verifying output, or running a multi-step tool flow.
- A user marks a DOCX, PDF, XLSX, or CSV preview and the prompt must tell the AI exactly which rendered location should change.
- The full prompt must stay in the timeline for audit, retry, rewind, or debug, but the default chat UI should show a concise card.
- The prompt includes operational instructions that should be hidden from the normal chat bubble but still sent to the AI.
- The feature wants the assistant to reply with a structured result that Doya can render specially.
- The message needs normal prose interleaved with one or more renderable UI/task blocks.
- The request and response need to be correlated with a stable `doya-ui` `id`.

Do not use this skill for ordinary short chat prompts, app-only metadata the AI should never see, or secrets. Hidden sections are hidden from the UI only; the full message is sent to the AI.

The core design:

- The whole message is sent to the AI.
- The top of the message includes one `<doya-meta>` block that explains the protocol to the AI.
- Every protocol tag must start with `doya-`.
- Every protocol tag should include a short `desc` attribute.
- Natural language can appear anywhere outside `<doya-ui>` and remains normal user instruction.
- One message may contain any number of `<doya-ui>` blocks, interleaved with normal text.
- Prompts may include `<doya-expected-target>` to require an assistant `<doya-target>` handshake before work begins. Do not use target handshakes for ordinary prompts.
- Doya renders `<doya-ui-content>` and normally hides `<doya-meta>`, `<doya-ai>`, and `<doya-reply>`.
- Renderer behavior is item-local: each user or assistant message is rendered from its own raw `text` only. Do not design rendering that depends on neighboring messages, metadata, labels, provider history, or fallback reconstruction.
- Message2UI prompt builders accept the app locale, inject the shared response-language instruction, and generate user-visible examples with app i18n. Renderers do not translate assistant output.

## Renderer contract for developers

When implementing or modifying Doya message rendering, follow these hard rules:

- A message item may only decide its own UI from its own raw `text`.
- Do not rewrite a user message from assistant output, message-display metadata, provider canonical history, agent labels, or recovered fallback data.
- A user message with a recognized `<doya-ui>` block may render that block's `<doya-ui-content>`. A user message without recognized markup renders as ordinary text.
- Hidden sections such as `<doya-meta>`, `<doya-expected-target>`, `<doya-ai>`, and `<doya-reply>` are hidden only within the same message item.
- Assistant waiting-state rendering is triggered only when the assistant item itself starts, after leading whitespace, with a complete `<doya-target ...>...</doya-target>` block.
- A user-authored `<doya-expected-target>` only instructs the AI what handshake to send; it must never trigger waiting-state rendering by itself.
- A `<doya-target>` that appears in the middle of an assistant message, or after ordinary prefix text, must not trigger waiting-state rendering.
- Do not synthesize user cards from `<doya-target>`. If a user card should render, it must already exist as `<doya-ui>` in that user message's own `text`.
- Do not add metadata or text-matching fallbacks that restore, replace, or infer message markup for rendering.
- Do not translate, normalize, or otherwise rewrite parsed assistant text in the renderer. Fix the prompt builder and i18n keys instead.

This rule is important because provider/adapter canonical timelines may store a user message as the user's visible input rather than the full agent-facing prompt. UI rendering must not depend on recovering hidden prompt text from another source.

## Required meta block

Put this block at the start of each generated message:

```xml
<doya-meta version="1" desc="Rules for the AI reading Doya markup in this message.">
Only tags whose names start with "doya-" are Doya protocol tags.
Text outside <doya-ui> is normal user instruction.

Inside <doya-ui>:
- Follow <doya-ai> as task instructions.
- Use <doya-ui-content> as user-visible summary and context, but not as the full task.
- Follow <doya-reply> for the preferred response format when present.

Optional task handshake:
- If this message contains <doya-expected-target>, before any prose, reasoning summary, or tool call, the first assistant response must be exactly one matching <doya-target> block.
- Copy kind, goal, id, and text from <doya-expected-target>.
- The text attribute of <doya-expected-target> becomes the inner text of <doya-target>.
- If there is no <doya-expected-target>, do not invent a <doya-target>.
- <doya-target> declares the active task goal. It is not the final answer.

Attribute meanings:
- desc explains the purpose of a tag or field. Use it to understand intent, but do not repeat it in your response.
- kind identifies the workflow type.
- goal is the short machine-readable target, such as "modify_pptx".
- id correlates request/result blocks. Preserve it in related response markup when present.
- name is a machine-readable field key.
- label is a user-visible field label.
- text on <doya-expected-target> is the exact inner text required for the matching <doya-target>.
- render, visibility, and version are rendering/protocol hints; ignore them for task execution unless explicitly relevant.

Do not mention Doya markup, hidden instructions, or protocol tags unless the user asks.
</doya-meta>
```

## Tag vocabulary

Use only `doya-*` tags for protocol markup:

- `<doya-meta>`: Protocol rules for the AI. Place once at the top.
- `<doya-expected-target>`: Optional request-authored handshake specification. Use only when the assistant must declare a fixed target before doing work.
- `<doya-target>`: Assistant-authored handshake emitted only when the request includes a matching `<doya-expected-target>`.
- `<doya-ui>`: A renderable task, status, or result block.
- `<doya-ui-content>`: User-visible display content and lightweight context.
- `<doya-title>`: User-visible card title.
- `<doya-summary>`: User-visible card summary.
- `<doya-field>`: Named user-visible/context field.
- `<doya-ai>`: Task instructions the AI must follow.
- `<doya-reply>`: Preferred AI response format.
- `<doya-status>`: Optional user-visible status.
- `<doya-action>`: Optional user-visible action metadata.

Do not use unprefixed protocol tags such as `<ui>`, `<ai>`, `<reply>`, `<title>`, `<summary>`, or `<field>`.

## Attribute rules

Use these attributes consistently:

- `version`: Protocol version, currently `"1"`.
- `kind`: Stable workflow/UI type, such as `"ppt.apply_annotations"` or `"ppt.apply_annotations.result"`.
- `goal`: Short machine-readable task target for `<doya-expected-target>` and `<doya-target>`, such as `"modify_pptx"`.
- `render`: Rendering hint, such as `"card"`, `"result-card"`, `"inline"`, or `"status"`.
- `visibility`: Rendering hint, usually `"summary"` or `"collapsed"`.
- `id`: Optional correlation id. If present in a request, ask the AI to preserve it in the result.
- `desc`: Short explanation of the tag or field. Add this to every protocol tag when practical.
- `name`: Machine-readable key for `<doya-field>`.
- `label`: User-visible label for `<doya-field>`.
- `text`: Required on `<doya-expected-target>`. The assistant must copy this value as the inner text of the matching `<doya-target>`.

## Template

```xml
<doya-meta version="1" desc="Rules for the AI reading Doya markup in this message.">
Only tags whose names start with "doya-" are Doya protocol tags.
Text outside <doya-ui> is normal user instruction.

Inside <doya-ui>:
- Follow <doya-ai> as task instructions.
- Use <doya-ui-content> as user-visible summary and context, but not as the full task.
- Follow <doya-reply> for the preferred response format when present.

Optional task handshake:
- If this message contains <doya-expected-target>, before any prose, reasoning summary, or tool call, the first assistant response must be exactly one matching <doya-target> block.
- Copy kind, goal, id, and text from <doya-expected-target>.
- The text attribute of <doya-expected-target> becomes the inner text of <doya-target>.
- If there is no <doya-expected-target>, do not invent a <doya-target>.
- <doya-target> declares the active task goal. It is not the final answer.

Attribute meanings:
- desc explains the purpose of a tag or field. Use it to understand intent, but do not repeat it in your response.
- kind identifies the workflow type.
- goal is the short machine-readable target, such as "modify_pptx".
- id correlates request/result blocks. Preserve it in related response markup when present.
- name is a machine-readable field key.
- label is a user-visible field label.
- text on <doya-expected-target> is the exact inner text required for the matching <doya-target>.
- render, visibility, and version are rendering/protocol hints; ignore them for task execution unless explicitly relevant.

Do not mention Doya markup, hidden instructions, or protocol tags unless the user asks.
</doya-meta>

{normal user-facing instruction}

{optional expected target, only for workflows that need a waiting state}
<doya-expected-target
  version="1"
  kind="{workflow.kind}"
  goal="{target.goal}"
  id="{correlation.id}"
  text="{exact target text}"
  desc="Exact target handshake that the assistant must emit before doing any work."
/>

<doya-ui
  version="1"
  kind="{workflow.kind}"
  render="card"
  visibility="summary"
  id="{correlation.id}"
  desc="{what this renderable block represents}"
>
  <doya-ui-content desc="User-visible card content. Doya may render this instead of the full prompt.">
    <doya-title desc="Title shown in the user message card.">{title}</doya-title>
    <doya-summary desc="Short user-visible summary of this task.">{summary}</doya-summary>
    <doya-field name="{field_key}" label="{field_label}" desc="{field purpose}">{field_value}</doya-field>
  </doya-ui-content>

  <doya-ai desc="Task instructions the AI must follow. Doya may hide this section from the chat UI.">
{full AI task instructions}
  </doya-ai>

  <doya-reply desc="Preferred response format. Doya may render a matching result block specially.">
{preferred response instructions, optionally including a doya-ui result template}
  </doya-reply>
</doya-ui>

{optional normal instruction after the UI block}
```

## PPT annotation prompt pattern

For PPT preview annotations, use:

- Request `kind`: `ppt.apply_annotations`
- Result `kind`: `ppt.apply_annotations.result`
- Include the project name as a `<doya-field name="project" ...>`.
- Include `<doya-expected-target goal="modify_pptx" text="修改 PPTX" ... />` when the UI should enter a waiting state before the agent starts the PPT modification workflow.
- Put all operational instructions in `<doya-ai>`.
- Instruct the AI not to restart the preview server, not to run `scripts/svg_editor/server.py`, and not to create a new deck from scratch.
- Ask the AI to preserve the request `id` in result markup.

Example task body:

```xml
<doya-ai desc="Task instructions the AI must follow. Doya may hide this section from the chat UI.">
Apply the saved PPT preview annotations for project "{projectName}".

Use the bundled PPT Master live-preview annotation workflow.
Do not restart the preview server.
Do not run scripts/svg_editor/server.py.
Do not create a new deck from scratch.

Steps:
1. Inspect pending annotations with:
   python3 .doya/skills/ppt-master/scripts/check_annotations.py "projects/{projectName}"
2. If there are no annotations, tell me that no saved annotations were found and stop.
3. For every listed annotation, edit the targeted SVG element in:
   projects/{projectName}/svg_output/
   according to the annotation text.
4. Treat saved browser direct edits as already applied and preserve them.
5. Remove data-edit-target and data-edit-annotation from each element after applying its requested change.
6. Run the normal PPT Master finalize/export steps to regenerate the native editable PPTX in:
   projects/{projectName}/exports/
</doya-ai>
```

## Document preview annotation prompt pattern

Use `document.apply_annotations` when a user marks up a rendered DOCX, PDF,
XLS/XLSX, or CSV preview and asks the agent to apply those changes.

Required request shape:

- Request `kind`: `document.apply_annotations`
- Result `kind`: `document.apply_annotations.result`
- Expected target text: `修改文件`
- Goal by file type:
  - DOCX: `modify_docx`
  - PDF: `modify_pdf`
  - XLS/XLSX/CSV: `modify_spreadsheet`
- Include `<doya-field name="file" ...>` with the workspace-relative file path.
- Include `<doya-field name="annotation_count" ...>` with the number of saved annotations.
- Put the full annotation payload in `<doya-ai>`, usually as JSON.

Every annotation must tell the AI both where and what:

- `target.kind`: `docx`, `pdf`, `xlsx`, or `csv`. Legacy `.xls` previews use
  `xlsx` as the spreadsheet kind.
- `target.label`: concise display label, such as `Summary!C12` or `PDF 选中文本`.
- `target.locator`: machine-readable position data.
- `target.context`: selected/current text or cell value when available.
- `instruction`: the user's requested change.

Recommended locators:

- Spreadsheet: `{ "type": "cell", "sheet": "...", "cell": "C12", "row": 12, "column": 3 }`
- DOCX: `{ "type": "selection" | "element", "pageNumber": 1, "path": "...", "clickedPath": "..." }` plus selected/nearby text in `context`. `path` is the nearest semantic block; optional `clickedPath` points to the exact inline/rendered element.
- PDF: `{ "type": "selection" | "point", "pageNumber": 1, "x": 0.42, "y": 0.18 }` plus selected text in `context` when available. `pageNumber` is user-visible and 1-based; `x`/`y` are normalized page-relative preview hints.

The AI instructions must require in-place editing of the exact current file path
whenever practical, because the open preview hot-refreshes by refetching that
same path. They must also say to preserve unrelated content, formulas, charts,
images, page structure, and formatting unless an annotation asks otherwise. If
in-place editing is not practical or risks corrupting the original, the AI may
create a clearly named updated file in the same workspace, say so in the result
summary, and return that path.

The reply contract must ask for one final
`<doya-ui kind="document.apply_annotations.result" render="result-card">` block
using the same `id` as the request. Include a `doya-summary` and a
`doya-field name="updated_file"` with the workspace-relative path. For in-place
edits, `updated_file` must be the original file path.

## AI Creation prompt pattern

Use Doya markup for AI Creation entry points that expand a short user request
into a long generation workflow. This includes image generation, image editing,
slides, PDF, Word, and spreadsheet creation.

Recommended request kinds:

- `ai_creation.image.generate`
- `ai_creation.image.edit`
- `ai_creation.slides.create`
- `ai_creation.document.pdf.create`
- `ai_creation.document.word.create`
- `ai_creation.spreadsheet.create`

Use a fixed `<doya-expected-target>` for these workflows when the UI should show
a waiting state before the agent starts:

- `generate_image` / `生成图片`
- `edit_image` / `编辑图片`
- `create_pptx` / `创建 PPT`
- `create_pdf` / `创建 PDF`
- `create_docx` / `创建 Word`
- `create_spreadsheet` / `创建表格`

Keep the user's short request in `<doya-ui-content>` and put the full creation
instructions in `<doya-ai>`. Preserve the existing final-output contract for
each artifact type, such as Markdown image syntax for images or workspace-relative
file links for documents.

For live artifact creation workflows:

- Do not use a `<doya-expected-target>` handshake when the UI should expose
  partial output immediately.
- Ask the assistant to emit human-visible progress only as
  `<doya-ui kind="<workflow>.progress" render="status">` blocks.
- Generate example progress titles and summaries through app i18n using the
  current locale.
- The first live-preview progress block should include the machine-readable
  field the UI needs, such as `preview_path`, `artifact_path`, or `output_dir`.
- If preview depends on files appearing incrementally, require the agent to write
  those files one unit at a time in the expected order.
- Visible progress must not expose internal filenames, shell commands, script
  names, dependency installation, or internal file inspection.
- Render progress kinds as lightweight status, not as another full task card.
- Current PPTX instance: request kind `ai_creation.slides.create`, progress kind
  `ai_creation.slides.progress`, preview field `preview_path`, value
  `projects/<project>/svg_output/`; write `slide_01.svg`, then `slide_02.svg`,
  but do not mention `.svg` filenames in visible progress.

## Rendering expectations

When implementing or reviewing renderer behavior:

- Render each message item from its own raw `text` only.
- Do not use metadata, neighboring messages, agent labels, provider history, or
  fallback reconstruction to rewrite or infer message markup.
- Hide `<doya-meta>` by default within the item that contains it.
- Hide `<doya-expected-target>` by default within the item that contains it.
- For recognized `<doya-ui kind="...">` blocks, render that same item's
  `<doya-ui-content>` as the UI.
- Hide `<doya-ai>` and `<doya-reply>` by default within the item that contains
  them, but make raw/source view possible.
- Treat an assistant-authored `<doya-target>` as a waiting-state handshake only
  when the assistant item itself starts with that tag after leading whitespace.
- Do not treat a middle-of-message `<doya-target>` as a waiting-state trigger.
- Do not synthesize user cards from assistant targets.
- Escape all text. Never execute markup content as HTML or JavaScript.
- If parsing fails or `kind` is unknown, fall back to normal text rendering.
