import { describe, expect, it } from "vitest";
import {
  getDoyaMessageVisibleText,
  parseDoyaMessageCard,
  parseDoyaMessageCards,
  parseDoyaMessageRenderParts,
  parseDoyaTargets,
} from "./doya-message-markup";

const MARKUP_MESSAGE = `<doya-meta version="1" desc="Rules.">
Hidden rules.
</doya-meta>

Normal instruction.

<doya-expected-target
  version="1"
  kind="ai_creation.spreadsheet.create"
  goal="create_spreadsheet"
  id="msg_1"
  text="创建表格"
  desc="Expected target."
/>

<doya-ui
  version="1"
  kind="ai_creation.spreadsheet.create"
  render="card"
  visibility="summary"
  id="msg_1"
  desc="Card."
>
  <doya-ui-content desc="Visible card content.">
    <doya-title desc="Title.">创建表格</doya-title>
    <doya-summary desc="Summary.">生成一份季度预算表</doya-summary>
    <doya-field name="format" label="格式" desc="Output format.">XLSX</doya-field>
  </doya-ui-content>

  <doya-ai desc="Hidden task instructions.">
Create the workbook.
  </doya-ai>
</doya-ui>`;

describe("doya message markup", () => {
  it("parses doya-ui without treating doya-ui-content as a nested doya-ui block", () => {
    expect(parseDoyaMessageCard(MARKUP_MESSAGE)).toEqual({
      kind: "ai_creation.spreadsheet.create",
      title: "创建表格",
      summary: "生成一份季度预算表",
      fields: [{ name: "format", label: "格式", value: "XLSX" }],
    });
  });

  it("hides protocol-only blocks from plain visible user text", () => {
    expect(getDoyaMessageVisibleText(MARKUP_MESSAGE).trim()).toBe("Normal instruction.");
  });

  it("hides doya-target from assistant render parts", () => {
    expect(
      parseDoyaMessageRenderParts(
        '<doya-target version="1" kind="ai_creation.spreadsheet.create" goal="create_spreadsheet" id="msg_1">创建表格</doya-target>',
      ),
    ).toEqual([]);
  });

  it("parses assistant target blocks", () => {
    expect(
      parseDoyaTargets(
        '<doya-target version="1" kind="ai_creation.spreadsheet.create" goal="create_spreadsheet" id="msg_1">创建表格</doya-target>',
      ),
    ).toEqual([
      {
        kind: "ai_creation.spreadsheet.create",
        goal: "create_spreadsheet",
        id: "msg_1",
        text: "创建表格",
      },
    ]);
  });

  it("parses document annotation result cards", () => {
    expect(
      parseDoyaMessageRenderParts(`<doya-ui
  version="1"
  kind="document.apply_annotations.result"
  render="result-card"
  visibility="summary"
  id="msg_1"
>
  <doya-ui-content>
    <doya-title>文件标注已应用</doya-title>
    <doya-summary>已按标注更新预算表。</doya-summary>
    <doya-field name="updated_file" label="文件">output/budget-updated.xlsx</doya-field>
  </doya-ui-content>
</doya-ui>`),
    ).toEqual([
      {
        kind: "card",
        card: {
          kind: "document.apply_annotations.result",
          title: "文件标注已应用",
          summary: "已按标注更新预算表。",
          fields: [
            {
              name: "updated_file",
              label: "文件",
              value: "output/budget-updated.xlsx",
            },
          ],
        },
      },
    ]);
  });

  it("parses every renderable card in a message", () => {
    expect(
      parseDoyaMessageCards(`<doya-ui version="1" kind="ai_creation.slides.progress">
  <doya-ui-content><doya-title>继续生成</doya-title><doya-summary>收到确认。</doya-summary></doya-ui-content>
</doya-ui>
<doya-ui version="1" kind="ai_creation.slides.progress">
  <doya-ui-content><doya-title>预览已就绪</doya-title><doya-summary>可打开预览。</doya-summary><doya-field name="preview_path" label="预览">projects/demo/svg_output/</doya-field></doya-ui-content>
</doya-ui>`),
    ).toMatchObject([
      { kind: "ai_creation.slides.progress", title: "继续生成" },
      {
        kind: "ai_creation.slides.progress",
        title: "预览已就绪",
        fields: [{ name: "preview_path", value: "projects/demo/svg_output/" }],
      },
    ]);
  });
});
