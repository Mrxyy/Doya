# Paseo Message Markup

Paseo Message Markup is a prompt format for messages that must be fully sent to
the agent and preserved in the timeline, while Paseo renders selected sections as
structured chat UI instead of showing raw implementation instructions.

This is not a wire protocol. It is text inside ordinary user or assistant
messages. The daemon and providers receive the full text. The app may parse the
same text before rendering.

## Goals

- Preserve the full prompt in the conversation record.
- Let the agent see explicit rules for reading the structured parts.
- Hide operational details from the default chat UI without deleting them.
- Allow normal prose and renderable UI blocks to be interleaved.
- Let assistant replies use the same markup for result cards.
- Let assistant replies declare an explicit task target at the start of the
  response, so Paseo can show a waiting state and suppress noisy progress text
  until the final result arrives.
- Keep rendering deterministic: each message item is rendered from its own raw
  `text` only, without using neighboring items, metadata, or fallback guesses.

## When To Use It

Use Paseo Message Markup when a feature sends an agent-facing prompt that is
longer, more operational, or more structured than what the user should see as a
plain chat bubble.

Good cases:

- A UI action expands into a detailed agent workflow, such as applying PPT
  preview annotations, running a multi-step export, or checking generated files.
- The timeline must preserve the full prompt for audit, retry, rewind, or debug,
  but the default UI should show a concise card.
- The prompt needs hidden execution instructions plus user-visible context.
- The assistant should respond in a structured form that Paseo can render as a
  result card.
- A message needs normal prose interleaved with one or more structured UI/task
  blocks.
- The same message needs stable correlation between a request and result through
  a `paseo-ui` `id`.

Do not use it for:

- Ordinary user chat text.
- Short prompts where the raw text is already appropriate to display.
- Data that must be secret from the agent. The full message is sent to the
  agent; hidden sections are only hidden from the default UI.
- App-only metadata that the agent should never see. Use structured client state
  or protocol fields instead.
- Untrusted remote content that has not been escaped and parsed through the
  renderer's whitelist.

When adding a feature that uses this markup, update or use the
`paseo-message-markup` skill so future agents generate the same shape.

## Recommended Workflow Kinds

Use markup for UI-triggered workflows where a short visible action expands into a
long agent prompt. Current high-confidence kinds:

- `ppt.apply_annotations`: apply saved PPT preview annotations and export a new
  editable PPTX. Expected target: `goal="modify_pptx"`, `text="修改 PPTX"`.
- `document.apply_annotations`: apply saved preview annotations to a DOCX, PDF,
  XLS/XLSX, or CSV file. Expected target: `goal="modify_docx"`,
  `goal="modify_pdf"`, or `goal="modify_spreadsheet"`, `text="修改文件"`.
- `ai_creation.image.generate`: generate an image. Expected target:
  `goal="generate_image"`, `text="生成图片"`.
- `ai_creation.image.edit`: edit an image. Expected target:
  `goal="edit_image"`, `text="编辑图片"`.
- `ai_creation.slides.create`: create a PPTX deck. Expected target:
  `goal="create_pptx"`, `text="创建 PPT"`.
- `ai_creation.document.pdf.create`: create a PDF. Expected target:
  `goal="create_pdf"`, `text="创建 PDF"`.
- `ai_creation.document.word.create`: create a DOCX. Expected target:
  `goal="create_docx"`, `text="创建 Word"`.
- `ai_creation.spreadsheet.create`: create a spreadsheet. Expected target:
  `goal="create_spreadsheet"`, `text="创建表格"`.

Do not use markup for ordinary composer text, generic transport paths, metadata
generation prompts, provider adapter prompts, or app-only data the AI should
never see.

## Format

Every generated message starts with a `paseo-meta` block. The rest of the message
may mix normal text with any number of `paseo-ui` blocks.

All protocol tags must start with `paseo-`. Unprefixed XML or HTML-like tags are
ordinary message content unless they are inside a `paseo-*` tag.

Every `paseo-*` tag should include a short `desc` attribute when practical. The
`desc` attribute explains intent for the agent and for raw/debug views. It is not
user-facing copy and should not be repeated in assistant output.

Message2UI language contract:

- Every message2ui prompt builder accepts the current app `Locale`.
- The builder injects `buildPaseoResponseLanguageInstruction({ defaultLocale, userText })`
  inside `paseo-ai`.
- The instruction says: use the user's request language when clear; otherwise
  use the app locale.
- Any example user-visible copy embedded in the prompt is generated with
  `translate(key, locale)`, not hard-coded English.
- The renderer never translates or rewrites assistant `paseo-ui-content`.

```xml
<paseo-meta version="1" desc="Rules for the AI reading Paseo markup in this message.">
Only tags whose names start with "paseo-" are Paseo protocol tags.
Text outside <paseo-ui> is normal user instruction.

Inside <paseo-ui>:
- Follow <paseo-ai> as task instructions.
- Use <paseo-ui-content> as user-visible summary and context, but not as the full task.
- Follow <paseo-reply> for the preferred response format when present.

Optional task handshake:
- If this message contains <paseo-expected-target>, before any prose, reasoning summary, or tool call, the first assistant response must be exactly one matching <paseo-target> block.
- Copy kind, goal, id, and text from <paseo-expected-target>.
- The text attribute of <paseo-expected-target> becomes the inner text of <paseo-target>.
- If there is no <paseo-expected-target>, do not invent a <paseo-target>.
- <paseo-target> declares the active task goal. It is not the final answer.

Attribute meanings:
- desc explains the purpose of a tag or field. Use it to understand intent, but do not repeat it in your response.
- kind identifies the workflow type.
- goal is the short machine-readable target, such as "modify_pptx".
- id correlates request/result blocks. Preserve it in related response markup when present.
- name is a machine-readable field key.
- label is a user-visible field label.
- text on <paseo-expected-target> is the exact inner text required for the matching <paseo-target>.
- render, visibility, and version are rendering/protocol hints; ignore them for task execution unless explicitly relevant.

Do not mention Paseo markup, hidden instructions, or protocol tags unless the user asks.
</paseo-meta>

Normal user instruction can appear here.

<paseo-expected-target
  version="1"
  kind="ppt.apply_annotations"
  goal="modify_pptx"
  id="ppt-apply-annotations-example"
  text="修改 PPTX"
  desc="Exact target handshake that the assistant must emit before doing any work."
/>

<paseo-ui
  version="1"
  kind="ppt.apply_annotations"
  render="card"
  visibility="summary"
  id="ppt-apply-annotations-example"
  desc="A renderable task card for applying saved PPT preview annotations."
>
  <paseo-ui-content desc="User-visible card content. Paseo may render this instead of the full prompt.">
    <paseo-title desc="Title shown in the user message card.">应用 PPT 标注</paseo-title>
    <paseo-summary desc="Short user-visible summary of this task.">根据当前预览页保存的标注修改幻灯片</paseo-summary>
    <paseo-field name="project" label="项目" desc="PPT Master project directory name.">example_project</paseo-field>
  </paseo-ui-content>

  <paseo-ai desc="Task instructions the AI must follow. Paseo may hide this section from the chat UI.">
Apply the saved PPT preview annotations for project "example_project".
  </paseo-ai>

  <paseo-reply desc="Preferred response format. Paseo may render a matching result block specially.">
Reply with a concise summary and exported PPTX path.
  </paseo-reply>
</paseo-ui>
```

## Tags

`paseo-meta`
: Required once at the top of generated markup prompts. Explains the protocol to
the agent. The app hides it by default.

`paseo-expected-target`
: Optional request-authored handshake specification. Include this only when the
task wants the assistant to declare a fixed target before doing work. Its
`kind`, `goal`, `id`, and `text` define the only valid matching `paseo-target`.

`paseo-target`
: Assistant-authored task handshake. The assistant sends this only when the
request includes `paseo-expected-target`. It declares what job is now active,
such as modifying a PPTX. It is not a final answer. The app may render this as a
waiting state and hide ordinary progress text until a matching final result
arrives.

`paseo-ui`
: A renderable task, status, or result block. `kind` selects the renderer.
`id` correlates request/result blocks.

`paseo-ui-content`
: User-visible display content and lightweight context. This is the only section
the default chat UI should render for recognized blocks.

`paseo-title`
: User-visible card title.

`paseo-summary`
: User-visible one or two sentence summary.

`paseo-field`
: Named field. Use `name` for the machine key and `label` for visible copy.

`paseo-ai`
: Instructions the agent must follow. The app hides this by default, but the
agent sees it because the full message is sent.

`paseo-reply`
: Preferred response format. Use this to ask the assistant to return a matching
`paseo-ui` result block.

`paseo-status`
: Optional status metadata for renderers.

`paseo-action`
: Optional action metadata for renderers.

## Attributes

`version`
: Protocol version. Current value is `1`.

`kind`
: Stable workflow/UI type, such as `ppt.apply_annotations` or
`ppt.apply_annotations.result`.

`goal`
: Short machine-readable task target for `paseo-expected-target` and
`paseo-target`, such as `modify_pptx`, `export_pptx`, or `verify_output`.

`render`
: Rendering hint. Examples: `card`, `result-card`, `inline`, `status`.

`visibility`
: Rendering hint. Examples: `summary`, `collapsed`.

`id`
: Correlation id. If present in a request block, the assistant should preserve it
in related result markup.

`text`
: Required on `paseo-expected-target`. This exact value becomes the inner text of
the matching assistant-authored `paseo-target`.

`desc`
: Human-readable explanation of the tag or field. The agent may use it to
understand intent. It is not visible UI copy.

`name`
: Machine-readable key for `paseo-field`.

`label`
: User-visible label for `paseo-field`.

## Rendering Rules

The app renderer must be item-local.

Each timeline item is rendered from that item's own raw `text` only. Do not use
neighboring user/assistant items, agent labels, provider history, persisted
message-display metadata, or heuristic fallback reconstruction to decide how an
item should render. Do not rewrite one item based on another item.

User message rendering:

- If the user item itself contains a recognized `paseo-ui` block, render that
  block from its own `paseo-ui-content`.
- Hide hidden protocol sections from that same user item, such as `paseo-meta`,
  `paseo-expected-target`, `paseo-ai`, and `paseo-reply`.
- If the user item itself has no recognized renderable markup, render it as
  ordinary text.
- Do not synthesize or recover a user card from an assistant response.

Assistant message rendering:

- Only the assistant item itself can trigger the waiting state.
- A user-authored `paseo-expected-target` only defines the required handshake;
  it is not a renderer trigger by itself.
- The waiting-state trigger is valid only when the assistant item's text, after
  leading whitespace, starts with a complete
  `<paseo-target ...>...</paseo-target>` block.
- A `paseo-target` that appears later in the assistant text, or after any normal
  prefix text, must not trigger waiting-state rendering.
- Treat a leading `paseo-target` as an execution-state marker, not as a final
  answer.
- After a leading `paseo-target`, the renderer may collapse ordinary assistant
  progress text in that turn until it sees a final artifact/result in later
  assistant item text.

General renderer rules:

- Preserve a raw/source view for debugging and auditing.
- Escape all parsed text. Never execute markup content as HTML or JavaScript.
- Fall back to normal text rendering if parsing fails or `kind` is unknown.
- Do not translate, normalize, or otherwise rewrite parsed assistant text in the
  renderer. If assistant `paseo-ui` copy needs to be localized, fix the prompt
  builder and i18n keys that caused the assistant to produce the wrong language.

The renderer should treat hidden sections as presentation-only hidden. Hidden
does not mean secret: the full text is still in the timeline, logs, raw view, and
the agent prompt.

This item-local rule is important because provider/adapter canonical timelines
may represent user messages as the user's visible input instead of the full
agent-facing prompt. UI rendering must therefore avoid relying on another item
to recover hidden protocol text.

## Live Artifact Progress

Use this pattern for creation workflows where the user can inspect partial
output before the final artifact is finished: slide decks, long documents,
reports, generated websites, multi-file exports, or similar live-preview
surfaces.

Contract:

- Do not include `<paseo-expected-target>` when the UI should expose useful
  partial output immediately.
- The assistant emits human-visible progress as
  `<paseo-ui kind="<workflow>.progress" render="status">`.
- The first progress block that exposes a live artifact includes a
  machine-readable `paseo-field`, such as `preview_path`, `artifact_path`, or
  `output_dir`.
- The renderer for progress kinds is lightweight status UI, not the full task
  card for the original request.
- Final artifact/result markup stays separate from progress markup.

Assistant progress block shape:

```xml
<paseo-ui
  version="1"
  kind="ai_creation.slides.progress"
  render="status"
  visibility="summary"
  desc="Human-visible PPT creation progress."
>
  <paseo-ui-content desc="Visible progress content.">
    <paseo-title desc="Progress title.">第 1 页已完成</paseo-title>
    <paseo-summary desc="Progress summary.">封面页已加入实时预览。</paseo-summary>
  </paseo-ui-content>
</paseo-ui>
```

Prompt builder requirements:

- Pass `defaultLocale` from `useI18n()` into the workflow prompt builder.
- Generate progress example copy with `translate(key, defaultLocale)`.
- Tell the agent to emit the first live-artifact progress block immediately
  after the previewable output location exists; include the machine-readable
  field the UI needs to open or poll it.
- Tell the agent to continue without waiting for a user reply.
- If the preview depends on files appearing incrementally, tell the agent to
  write those files one unit at a time in the order the preview expects.

Visible progress whitelist:

- preview ready
- outline or plan ready
- direction/style/schema set
- source processing
- each previewable unit ready
- export started
- final artifact ready

Visible progress blacklist:

- internal filenames unless the filename is the user-facing artifact
- shell commands
- script names
- dependency installation
- internal file inspection
- implementation reasoning

Current PPTX instance:

- Request kind: `ai_creation.slides.create`.
- Progress kind: `ai_creation.slides.progress`.
- Preview discovery field: `paseo-field name="preview_path"`.
- Preview path value: `projects/<project>/svg_output/`.
- Execution writes `slide_01.svg`, then `slide_02.svg`, and so on, but visible
  progress says a slide is ready without exposing `.svg` filenames.

## Document Preview Annotation Pattern

Use `document.apply_annotations` when a user marks up a rendered DOCX, PDF,
XLS/XLSX, or CSV preview and asks the current agent to apply those changes.

Document preview annotations require a concrete `sourceAgentId`. The UI may
carry it from files opened from agent output or, when a file is opened from the
file tree while an agent pane is focused, from that focused agent. If no source
agent is known, show an unavailable state instead of guessing; sending a
document-edit prompt to the wrong agent is worse than hiding the action.

The prompt must tell the agent both what the user wrote and where the user marked
the document. Natural-language instructions alone are not enough. Put the
machine-readable locator payload in `paseo-ai`, usually as JSON.

Each annotation should include:

- `target.kind`: the preview kind, such as `docx`, `pdf`, `xlsx`, or `csv`.
  Legacy `.xls` previews use `xlsx` as the spreadsheet kind.
- `target.label`: short user-visible label, such as `Budget!C12` or
  `Word selected text`.
- `target.locator`: stable location hints. Prefer semantic anchors over pixels.
- `target.context`: nearby selected/current text or cell value when available.
- `instruction`: the user's requested change for that target.

Recommended locator shapes:

- Spreadsheet: `{ type: "cell", sheet, cell, row, column }`. The sheet name and
  cell address are the primary target.
- DOCX: `{ type: "selection" | "element", pageNumber, path, clickedPath }`,
  plus selected text or nearby paragraph text in `context`. `path` is the nearest
  semantic block; optional `clickedPath` points to the exact inline/rendered
  element.
- PDF: `{ type: "selection" | "point", pageNumber, x, y }`, plus selected text
  in `context` when available. `pageNumber` is the user-visible 1-based page
  number. Coordinates are normalized page-relative preview hints, not the only
  source of truth.

The agent instructions should require in-place editing of the exact current file
path whenever practical, because the open preview hot-refreshes by refetching
that same path. They should also require preserving unrelated content, formulas,
charts, images, page structure, and formatting unless a specific annotation asks
otherwise. If in-place editing is impractical for the format or risks corrupting
the original, the agent may create a clearly named updated file in the same
workspace, say so in the result summary, and return that path.

The reply contract should request a final
`<paseo-ui kind="document.apply_annotations.result" render="result-card">`
block. The result card should use the same `id` as the request and include:

- `paseo-title`: a short completion title.
- `paseo-summary`: what changed.
- `paseo-field name="updated_file"`: the workspace-relative path to the updated
  file. For in-place edits, this must be the original file path.

Example request fields:

```xml
<paseo-expected-target
  version="1"
  kind="document.apply_annotations"
  goal="modify_spreadsheet"
  id="msg_123"
  text="修改文件"
  desc="Exact target handshake that the assistant must emit before doing any work."
/>

<paseo-ui
  version="1"
  kind="document.apply_annotations"
  render="card"
  visibility="summary"
  id="msg_123"
  desc="A renderable task card for applying saved document preview annotations."
>
  <paseo-ui-content desc="User-visible card content.">
    <paseo-title desc="Title shown in the user message card.">应用文件标注</paseo-title>
    <paseo-summary desc="Short summary.">根据预览中保存的标注修改表格文件</paseo-summary>
    <paseo-field name="file" label="文件" desc="Workspace-relative file path.">output/spreadsheets/budget.xlsx</paseo-field>
    <paseo-field name="annotation_count" label="标注数" desc="Number of saved preview annotations.">2</paseo-field>
  </paseo-ui-content>

  <paseo-ai desc="Task instructions the AI must follow.">
Annotations JSON:
[
  {
    "index": 1,
    "target": {
      "kind": "xlsx",
      "label": "Summary!C12",
      "locator": { "type": "cell", "sheet": "Summary", "cell": "C12", "row": 12, "column": 3 },
      "context": "$12,000"
    },
    "instruction": "改成红色并加粗"
  }
]
  </paseo-ai>
</paseo-ui>
```

## Agent Rules

The agent sees the full message. The meta block instructs the agent to:

- Treat text outside `paseo-ui` as normal instruction.
- Follow `paseo-ai` as task instructions.
- Use `paseo-ui-content` as summary/context, not as the full task.
- Follow `paseo-reply` when formatting responses.
- Send one `paseo-target` before starting work only when the message includes
  `paseo-expected-target`.
- Never invent `paseo-target` when there is no `paseo-expected-target`.
- Copy `kind`, `goal`, `id`, and `text` exactly from `paseo-expected-target` to
  the matching `paseo-target`.
- Preserve request ids across `paseo-target` and final result markup.
- Avoid mentioning the markup unless the user asks.

## Task Handshake

The optional task handshake tells the assistant to emit a target marker before it
begins a selected workflow. This is useful when the assistant may emit many
ordinary progress messages before the final answer. For rendering, the target
marker is recognized only from the assistant item that starts with
`paseo-target`.

Request-authored expected target:

```xml
<paseo-expected-target
  version="1"
  kind="ppt.apply_annotations"
  goal="modify_pptx"
  id="msg_123"
  text="修改 PPTX"
  desc="Exact target handshake that the assistant must emit before doing any work."
/>
```

Matching assistant-authored target:

```xml
<paseo-target
  version="1"
  kind="ppt.apply_annotations"
  goal="modify_pptx"
  id="msg_123"
  desc="Handshake declaring that the assistant is starting the PPTX modification task."
>
修改 PPTX
</paseo-target>
```

Rules:

- The assistant sends `paseo-target` before tool calls or progress narration only
  when the request contains `paseo-expected-target`.
- `paseo-target` is an execution-state marker, not user-facing final content.
- The `kind`, `goal`, `id`, and inner text must match `paseo-expected-target`.
- The final `paseo-ui kind="*.result"` should reuse the same `id`.
- The app enters waiting mode only if an assistant item itself starts with the
  `paseo-target` block after leading whitespace.
- Until the final result arrives, the app may render a waiting animation and
  collapse ordinary assistant text emitted after that leading target.
- If the turn fails or is canceled before a final result, the app should exit the
  waiting state and render the error/canceled state normally.
- If no leading assistant `paseo-target` arrives, the app should not enter target
  waiting mode. It may still render later result markup normally from the item
  that contains it.

## Security

Paseo Message Markup is untrusted text, even when generated by Paseo. Parsing must
not execute markup. Renderers must escape content and whitelist supported `kind`
values.

Assistant output may also contain `paseo-ui` blocks. Treat assistant-authored
markup as untrusted and render only recognized kinds with escaped text. Unknown
markup falls back to normal text.

## Prompt Generation Skill

Agents can use the local `paseo-message-markup` skill at
`.agents/skills/paseo-message-markup/SKILL.md` to construct prompts that follow
this specification.
