// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildDocxAnnotationTargetFromClick,
  buildPdfAnnotationTargetFromClick,
  buildSpreadsheetAnnotationTargetFromClick,
} from "./document-annotation-event-targets";

describe("document annotation event targets", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    window.getSelection()?.removeAllRanges();
  });

  it("builds a spreadsheet cell target from nested table click targets", () => {
    document.body.innerHTML = `
      <table>
        <tbody>
          <tr>
            <td
              data-row-index="4"
              data-column-index="2"
              data-value="$150,000"
              data-raw-value="150000"
              data-formula="=SUM(C7:C9)"
              data-formatted-value="$150,000"
            >
              <span id="target">$150,000</span>
            </td>
          </tr>
        </tbody>
      </table>
    `;

    expect(
      buildSpreadsheetAnnotationTargetFromClick({
        kind: "xlsx",
        sheetName: "Budget",
        eventTarget: document.getElementById("target"),
      }),
    ).toEqual({
      kind: "xlsx",
      label: "Budget!C5",
      locator: {
        type: "cell",
        sheet: "Budget",
        cell: "C5",
        row: 5,
        column: 3,
        rawValue: "150000",
        formula: "=SUM(C7:C9)",
      },
      context: "display=$150,000; raw=150000; formula =SUM(C7:C9)",
    });
  });

  it("ignores spreadsheet clicks without stable row and column dataset values", () => {
    document.body.innerHTML = `<table><tbody><tr><td data-row-index="x">Bad</td></tr></tbody></table>`;

    expect(
      buildSpreadsheetAnnotationTargetFromClick({
        kind: "csv",
        sheetName: "Sheet1",
        eventTarget: document.querySelector("td"),
      }),
    ).toBeNull();
  });

  it("builds a DOCX target with page, path, and nearby text context", () => {
    document.body.innerHTML = `
      <div id="root">
        <section><p>Cover</p></section>
        <section><p><strong id="target">Revenue target</strong></p></section>
      </div>
    `;

    expect(
      buildDocxAnnotationTargetFromClick({
        root: document.getElementById("root") as HTMLElement,
        eventTarget: document.getElementById("target"),
      }),
    ).toEqual({
      kind: "docx",
      label: "p: Revenue target",
      locator: {
        type: "element",
        pageNumber: 2,
        path: "section:nth-of-type(2) > p:nth-of-type(1)",
        clickedPath: "section:nth-of-type(2) > p:nth-of-type(1) > strong:nth-of-type(1)",
      },
      context: "Revenue target",
    });
  });

  it("builds a PDF target with page-relative coordinates", () => {
    document.body.innerHTML = `
      <div id="root">
        <div data-page-number="3">
          <div id="content" data-pdf-page-content="true"><span id="target">PDF copy</span></div>
        </div>
      </div>
    `;
    const page = document.querySelector("[data-page-number]") as HTMLElement;
    const content = document.getElementById("content") as HTMLElement;
    vi.spyOn(page, "getBoundingClientRect").mockReturnValue({
      left: 80,
      top: 160,
      width: 500,
      height: 900,
    } as DOMRect);
    vi.spyOn(content, "getBoundingClientRect").mockReturnValue({
      left: 100,
      top: 200,
      width: 400,
      height: 800,
    } as DOMRect);

    expect(
      buildPdfAnnotationTargetFromClick({
        root: document.getElementById("root") as HTMLElement,
        eventTarget: document.getElementById("target"),
        clientX: 180,
        clientY: 360,
      }),
    ).toEqual({
      kind: "pdf",
      label: "PDF 第 3 页点击位置",
      locator: {
        type: "point",
        coordinateSpace: "page_content",
        pageNumber: 3,
        x: 0.2,
        y: 0.2,
      },
      context: "PDF copy",
    });
  });

  it("builds a PDF target from the root when no page element is exposed", () => {
    document.body.innerHTML = `<div id="root"><span id="target">PDF copy</span></div>`;
    const root = document.getElementById("root") as HTMLElement;
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
      left: 20,
      top: 50,
      width: 200,
      height: 400,
    } as DOMRect);

    expect(
      buildPdfAnnotationTargetFromClick({
        root,
        eventTarget: document.getElementById("target"),
        clientX: 70,
        clientY: 150,
      }),
    ).toEqual({
      kind: "pdf",
      label: "PDF 第 1 页点击位置",
      locator: {
        type: "point",
        coordinateSpace: "page_content",
        pageNumber: 1,
        x: 0.25,
        y: 0.25,
      },
      context: "PDF copy",
    });
  });
});
