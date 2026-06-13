import { describe, expect, it, vi } from "vitest";
import { beginDocumentAnnotationApplyRequest } from "./document-annotation-apply-request";

describe("document annotation apply request", () => {
  it("appends the full prompt and sends it to the source agent", () => {
    const appendOptimisticUserMessageToAgentStream = vi.fn();
    const sendAgentMessage = vi.fn().mockResolvedValue(undefined);

    const result = beginDocumentAnnotationApplyRequest({
      appendOptimisticUserMessageToAgentStream,
      client: { sendAgentMessage },
      documentKind: "xlsx",
      filePath: "output/budget.xlsx",
      annotations: [
        {
          target: {
            kind: "xlsx",
            label: "Budget!C2",
            locator: {
              type: "cell",
              sheet: "Budget",
              cell: "C2",
              row: 2,
              column: 3,
              formula: "=SUM(C4:C5)",
            },
            context: "display=$150,000; formula =SUM(C4:C5)",
          },
          instruction: "把这个预算改为 20 万并保持公式联动",
        },
      ],
      serverId: "server-1",
      sourceAgentId: "agent-1",
      sourceAgentStatus: "idle",
      defaultLocale: "zh",
      messageId: "msg_test",
      timestamp: new Date("2026-06-11T12:00:00Z"),
    });

    expect(result.phase).toBe("waiting");
    expect(result.messageId).toBe("msg_test");
    expect(result.prompt).toContain("<paseo-meta");
    expect(result.prompt).toContain("output/budget.xlsx");
    expect(result.prompt).toContain('"formula": "=SUM(C4:C5)"');
    expect(result.prompt).toContain("把这个预算改为 20 万并保持公式联动");

    expect(appendOptimisticUserMessageToAgentStream).toHaveBeenCalledWith(
      "server-1",
      "agent-1",
      expect.objectContaining({
        kind: "user_message",
        id: "msg_test",
        text: result.prompt,
        timestamp: new Date("2026-06-11T12:00:00Z"),
        optimistic: true,
      }),
      { placement: "active-head", skipIfUserMessageExists: true },
    );
    expect(sendAgentMessage).toHaveBeenCalledWith("agent-1", result.prompt, {
      messageId: "msg_test",
    });
  });

  it("starts in running phase when the source agent is already running", () => {
    const result = beginDocumentAnnotationApplyRequest({
      appendOptimisticUserMessageToAgentStream: vi.fn(),
      client: { sendAgentMessage: vi.fn().mockResolvedValue(undefined) },
      documentKind: "docx",
      filePath: "output/prd.docx",
      annotations: [
        {
          target: {
            kind: "docx",
            label: "Word 选中文本",
            locator: { type: "selection", pageNumber: 1, path: "section:nth-of-type(1)" },
            context: "旧标题",
          },
          instruction: "改成新标题",
        },
      ],
      serverId: "server-1",
      sourceAgentId: "agent-1",
      sourceAgentStatus: "running",
      defaultLocale: "zh",
      messageId: "msg_running",
    });

    expect(result.phase).toBe("running");
  });

});
