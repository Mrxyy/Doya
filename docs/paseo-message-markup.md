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
- Let selected prompts require an explicit assistant task target before work
  starts, so Paseo can show a waiting state and suppress noisy progress text
  until the final result arrives.

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

## Format

Every generated message starts with a `paseo-meta` block. The rest of the message
may mix normal text with any number of `paseo-ui` blocks.

All protocol tags must start with `paseo-`. Unprefixed XML or HTML-like tags are
ordinary message content unless they are inside a `paseo-*` tag.

Every `paseo-*` tag should include a short `desc` attribute when practical. The
`desc` attribute explains intent for the agent and for raw/debug views. It is not
user-facing copy and should not be repeated in assistant output.

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

The app renderer should:

- Hide `paseo-meta` by default.
- Treat `paseo-expected-target` as request metadata. It is hidden by default.
- Treat a matching `paseo-target` as a task handshake. Show a waiting state for
  its `id` and `goal`; do not treat it as a final answer.
- Accept `paseo-target` only when it matches an earlier `paseo-expected-target`
  by `kind`, `goal`, `id`, and inner text.
- Render recognized `paseo-ui` blocks from `paseo-ui-content`.
- Hide `paseo-ai` and `paseo-reply` by default.
- After a `paseo-target`, the renderer may collapse ordinary assistant progress
  text for the same turn until it sees a matching final/result `paseo-ui` block.
- Preserve a raw/source view for debugging and auditing.
- Escape all parsed text. Never execute markup content as HTML or JavaScript.
- Fall back to normal text rendering if parsing fails or `kind` is unknown.

The renderer should treat hidden sections as presentation-only hidden. Hidden
does not mean secret: the full text is still in the timeline, logs, raw view, and
the agent prompt.

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

The optional task handshake gives Paseo a reliable marker before the agent begins
a selected workflow. This is useful when the assistant may emit many ordinary
progress messages before the final answer. Instead of rendering those messages as
regular chat content, the app can show a waiting animation for the declared
target.

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
- Until the final result arrives, the app may render a waiting animation and
  collapse ordinary assistant text emitted after the target.
- If the turn fails or is canceled before a final result, the app should exit the
  waiting state and render the error/canceled state normally.
- If no matching `paseo-target` arrives, the app should not enter target waiting
  mode. It may still render a later matching result block normally.

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
