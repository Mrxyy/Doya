# Codex 图片生成缺少保存路径

日期：2026-06-24

## 问题现象

使用 Doya 的 AI 创作图片生成流程时，Codex 会产生 `image_generation_end` 事件，并且 `payload.result` 里有有效的 base64 PNG 数据，但没有在下面目录生成对应图片文件：

```text
~/.codex/generated_images/<thread_id>/<image_id>.png
```

对应 session 里也没有出现 developer hint：

```text
Generated images are saved to ...
```

结果是 Doya 无法可靠拿到生成图片路径。之前如果退而求其次去 `~/.codex/generated_images` 下面按修改时间找“最新图片”，就可能拿到其他会话或其他请求生成的图片。

## 根因

这个行为和本机安装的 Codex CLI 版本有关。

异常 session 使用的是：

```text
cli_version: 0.141.0
originator: doya
```

可正常工作的对照 session 使用的是：

```text
cli_version: 0.142.0
originator: codex_vscode
```

正常路径里，Codex 会把生成图片持久化到 `~/.codex/generated_images/...`，并在 rollout 里记录 `Generated images are saved to ...` 提示。异常路径里，Codex 只在事件流里暴露了 base64 图片结果，没有产生可用的保存路径。

## 如何确认

检查 session rollout：

```bash
rg -n "image_generation_end|image_generation_call|Generated images are saved|generated_images" ~/.codex/sessions
```

查看 session 元信息：

```bash
sed -n '1p' <rollout.jsonl> | jq '.payload | {id, originator, source, cwd, cli_version}'
```

查看图片生成事件：

```bash
sed -n '<line>p' <rollout.jsonl> | jq '{type, payload_type: .payload.type, id: .payload.id, status: .payload.status, result_len: (.payload.result | length)}'
```

确认 Codex 是否写出了预期图片文件：

```bash
find ~/.codex/generated_images -maxdepth 2 -type f -name '<image_id>.png' -print -ls
```

即使文件不存在，base64 本身仍然可能是有效图片：

```bash
sed -n '<line>p' <rollout.jsonl> | jq -r '.payload.result' | base64 -D | file -
```

## 解决方法

升级 Codex CLI 到能够正确持久化图片生成产物的版本。

示例：

```bash
npm install -g @openai/codex@latest
codex --version
```

升级后重新生成图片，并确认：

- `~/.codex/generated_images/<thread_id>/<image_id>.png` 存在。
- rollout 里包含 `Generated images are saved to ...`。
- Doya 能从稳定路径渲染生成图片。

## Doya 侧处理建议

Doya 不应该只依赖 developer hint。更稳的处理方式是：

1. 如果 Codex 提供了明确的 `saved_path`，优先使用它。
2. 如果没有 `saved_path`，但 `image_generation_end.result` 存在，则解码 base64，并写入 Doya 自己控制的工作区 artifact 路径。
3. 不要通过扫描 `~/.codex/generated_images` 下“最新文件”的方式定位图片。

这样可以避免跨 session 图片串用，也能降低 Codex CLI 不同版本行为差异对 Doya 的影响。
