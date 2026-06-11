---
name: paseo-message-markup
description: Build Paseo message-markup prompts that can be sent to an AI while rendering selected paseo-* sections as special chat UI. Use when creating prompts with hidden task instructions, user-visible UI cards, structured AI reply formats, or text that mixes natural language with <paseo-ui> blocks.
user-invocable: true
---

# Paseo message markup

Use this skill when a prompt should be fully preserved in the conversation record and sent to the AI, while Paseo renders selected parts as special UI instead of showing the raw implementation prompt.

## When to use this skill

Use this skill when building or modifying a feature that sends agent-facing prompts and any of these are true:

- A UI action expands into a detailed workflow prompt, such as applying PPT preview annotations, exporting generated files, verifying output, or running a multi-step tool flow.
- The full prompt must stay in the timeline for audit, retry, rewind, or debug, but the default chat UI should show a concise card.
- The prompt includes operational instructions that should be hidden from the normal chat bubble but still sent to the AI.
- The feature wants the assistant to reply with a structured result that Paseo can render specially.
- The message needs normal prose interleaved with one or more renderable UI/task blocks.
- The request and response need to be correlated with a stable `paseo-ui` `id`.

Do not use this skill for ordinary short chat prompts, app-only metadata the AI should never see, or secrets. Hidden sections are hidden from the UI only; the full message is sent to the AI.

The core design:

- The whole message is sent to the AI.
- The top of the message includes one `<paseo-meta>` block that explains the protocol to the AI.
- Every protocol tag must start with `paseo-`.
- Every protocol tag should include a short `desc` attribute.
- Natural language can appear anywhere outside `<paseo-ui>` and remains normal user instruction.
- One message may contain any number of `<paseo-ui>` blocks, interleaved with normal text.
- Prompts may include `<paseo-expected-target>` to require an assistant `<paseo-target>` handshake before work begins. Do not use target handshakes for ordinary prompts.
- Paseo renders `<paseo-ui-content>` and normally hides `<paseo-meta>`, `<paseo-ai>`, and `<paseo-reply>`.

## Required meta block

Put this block at the start of each generated message:

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
```

## Tag vocabulary

Use only `paseo-*` tags for protocol markup:

- `<paseo-meta>`: Protocol rules for the AI. Place once at the top.
- `<paseo-expected-target>`: Optional request-authored handshake specification. Use only when the assistant must declare a fixed target before doing work.
- `<paseo-target>`: Assistant-authored handshake emitted only when the request includes a matching `<paseo-expected-target>`.
- `<paseo-ui>`: A renderable task, status, or result block.
- `<paseo-ui-content>`: User-visible display content and lightweight context.
- `<paseo-title>`: User-visible card title.
- `<paseo-summary>`: User-visible card summary.
- `<paseo-field>`: Named user-visible/context field.
- `<paseo-ai>`: Task instructions the AI must follow.
- `<paseo-reply>`: Preferred AI response format.
- `<paseo-status>`: Optional user-visible status.
- `<paseo-action>`: Optional user-visible action metadata.

Do not use unprefixed protocol tags such as `<ui>`, `<ai>`, `<reply>`, `<title>`, `<summary>`, or `<field>`.

## Attribute rules

Use these attributes consistently:

- `version`: Protocol version, currently `"1"`.
- `kind`: Stable workflow/UI type, such as `"ppt.apply_annotations"` or `"ppt.apply_annotations.result"`.
- `goal`: Short machine-readable task target for `<paseo-expected-target>` and `<paseo-target>`, such as `"modify_pptx"`.
- `render`: Rendering hint, such as `"card"`, `"result-card"`, `"inline"`, or `"status"`.
- `visibility`: Rendering hint, usually `"summary"` or `"collapsed"`.
- `id`: Optional correlation id. If present in a request, ask the AI to preserve it in the result.
- `desc`: Short explanation of the tag or field. Add this to every protocol tag when practical.
- `name`: Machine-readable key for `<paseo-field>`.
- `label`: User-visible label for `<paseo-field>`.
- `text`: Required on `<paseo-expected-target>`. The assistant must copy this value as the inner text of the matching `<paseo-target>`.

## Template

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

{normal user-facing instruction}

{optional expected target, only for workflows that need a waiting state}
<paseo-expected-target
  version="1"
  kind="{workflow.kind}"
  goal="{target.goal}"
  id="{correlation.id}"
  text="{exact target text}"
  desc="Exact target handshake that the assistant must emit before doing any work."
/>

<paseo-ui
  version="1"
  kind="{workflow.kind}"
  render="card"
  visibility="summary"
  id="{correlation.id}"
  desc="{what this renderable block represents}"
>
  <paseo-ui-content desc="User-visible card content. Paseo may render this instead of the full prompt.">
    <paseo-title desc="Title shown in the user message card.">{title}</paseo-title>
    <paseo-summary desc="Short user-visible summary of this task.">{summary}</paseo-summary>
    <paseo-field name="{field_key}" label="{field_label}" desc="{field purpose}">{field_value}</paseo-field>
  </paseo-ui-content>

  <paseo-ai desc="Task instructions the AI must follow. Paseo may hide this section from the chat UI.">
{full AI task instructions}
  </paseo-ai>

  <paseo-reply desc="Preferred response format. Paseo may render a matching result block specially.">
{preferred response instructions, optionally including a paseo-ui result template}
  </paseo-reply>
</paseo-ui>

{optional normal instruction after the UI block}
```

## PPT annotation prompt pattern

For PPT preview annotations, use:

- Request `kind`: `ppt.apply_annotations`
- Result `kind`: `ppt.apply_annotations.result`
- Include the project name as a `<paseo-field name="project" ...>`.
- Include `<paseo-expected-target goal="modify_pptx" text="修改 PPTX" ... />` when the UI should enter a waiting state before the agent starts the PPT modification workflow.
- Put all operational instructions in `<paseo-ai>`.
- Instruct the AI not to restart the preview server, not to run `scripts/svg_editor/server.py`, and not to create a new deck from scratch.
- Ask the AI to preserve the request `id` in result markup.

Example task body:

```xml
<paseo-ai desc="Task instructions the AI must follow. Paseo may hide this section from the chat UI.">
Apply the saved PPT preview annotations for project "{projectName}".

Use the bundled PPT Master live-preview annotation workflow.
Do not restart the preview server.
Do not run scripts/svg_editor/server.py.
Do not create a new deck from scratch.

Steps:
1. Inspect pending annotations with:
   python3 .paseo/skills/ppt-master/scripts/check_annotations.py "projects/{projectName}"
2. If there are no annotations, tell me that no saved annotations were found and stop.
3. For every listed annotation, edit the targeted SVG element in:
   projects/{projectName}/svg_output/
   according to the annotation text.
4. Treat saved browser direct edits as already applied and preserve them.
5. Remove data-edit-target and data-edit-annotation from each element after applying its requested change.
6. Run the normal PPT Master finalize/export steps to regenerate the native editable PPTX in:
   projects/{projectName}/exports/
</paseo-ai>
```

## Rendering expectations

When implementing or reviewing renderer behavior:

- Hide `<paseo-meta>` by default.
- Hide `<paseo-expected-target>` by default.
- Accept `<paseo-target>` only when it matches an earlier `<paseo-expected-target>` by `kind`, `goal`, `id`, and inner text.
- Treat a matching `<paseo-target>` as a waiting-state handshake, not as a final answer.
- For recognized `<paseo-ui kind="...">` blocks, render `<paseo-ui-content>` as the UI.
- Hide `<paseo-ai>` and `<paseo-reply>` by default, but make raw/source view possible.
- Escape all text. Never execute markup content as HTML or JavaScript.
- If parsing fails or `kind` is unknown, fall back to normal text rendering.
