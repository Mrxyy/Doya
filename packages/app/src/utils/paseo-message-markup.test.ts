import { describe, expect, it } from "vitest";
import {
  getPaseoMessageVisibleText,
  parsePaseoMessageCard,
  parsePaseoMessageRenderParts,
  parsePaseoTargets,
} from "./paseo-message-markup";

const MARKUP_MESSAGE = `<paseo-meta version="1" desc="Rules.">
Hidden rules.
</paseo-meta>

Normal instruction.

<paseo-expected-target
  version="1"
  kind="ai_creation.spreadsheet.create"
  goal="create_spreadsheet"
  id="msg_1"
  text="创建表格"
  desc="Expected target."
/>

<paseo-ui
  version="1"
  kind="ai_creation.spreadsheet.create"
  render="card"
  visibility="summary"
  id="msg_1"
  desc="Card."
>
  <paseo-ui-content desc="Visible card content.">
    <paseo-title desc="Title.">创建表格</paseo-title>
    <paseo-summary desc="Summary.">生成一份季度预算表</paseo-summary>
    <paseo-field name="format" label="格式" desc="Output format.">XLSX</paseo-field>
  </paseo-ui-content>

  <paseo-ai desc="Hidden task instructions.">
Create the workbook.
  </paseo-ai>
</paseo-ui>`;

describe("paseo message markup", () => {
  it("parses paseo-ui without treating paseo-ui-content as a nested paseo-ui block", () => {
    expect(parsePaseoMessageCard(MARKUP_MESSAGE)).toEqual({
      kind: "ai_creation.spreadsheet.create",
      title: "创建表格",
      summary: "生成一份季度预算表",
      fields: [{ name: "format", label: "格式", value: "XLSX" }],
    });
  });

  it("hides protocol-only blocks from plain visible user text", () => {
    expect(getPaseoMessageVisibleText(MARKUP_MESSAGE).trim()).toBe("Normal instruction.");
  });

  it("hides paseo-target from assistant render parts", () => {
    expect(
      parsePaseoMessageRenderParts(
        '<paseo-target version="1" kind="ai_creation.spreadsheet.create" goal="create_spreadsheet" id="msg_1">创建表格</paseo-target>',
      ),
    ).toEqual([]);
  });

  it("parses assistant target blocks", () => {
    expect(
      parsePaseoTargets(
        '<paseo-target version="1" kind="ai_creation.spreadsheet.create" goal="create_spreadsheet" id="msg_1">创建表格</paseo-target>',
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
      parsePaseoMessageRenderParts(`<paseo-ui
  version="1"
  kind="document.apply_annotations.result"
  render="result-card"
  visibility="summary"
  id="msg_1"
>
  <paseo-ui-content>
    <paseo-title>文件标注已应用</paseo-title>
    <paseo-summary>已按标注更新预算表。</paseo-summary>
    <paseo-field name="updated_file" label="文件">output/budget-updated.xlsx</paseo-field>
  </paseo-ui-content>
</paseo-ui>`),
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
});
