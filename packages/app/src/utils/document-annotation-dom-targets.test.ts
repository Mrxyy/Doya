// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildElementPath,
  findClosestPdfPageElement,
  getDocxSemanticTargetElement,
  getDocxPageIndex,
  getElementLabel,
  getPdfPageContentElement,
  getPdfPageTarget,
} from "./document-annotation-dom-targets";

describe("document annotation DOM targets", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("builds DOCX element labels, page numbers, and stable element paths", () => {
    document.body.innerHTML = `
      <div id="root">
        <section><p>Intro</p></section>
        <section><p>First paragraph</p><p><span>Target copy</span></p></section>
      </div>
    `;
    const root = document.getElementById("root");
    const target = root?.querySelector("section:nth-of-type(2) p:nth-of-type(2) span");

    expect(root).toBeInstanceOf(HTMLElement);
    expect(target).toBeInstanceOf(HTMLElement);
    expect(getElementLabel(target as HTMLElement)).toBe("span: Target copy");
    expect(getDocxPageIndex(root as HTMLElement, target as HTMLElement)).toBe(2);
    expect(buildElementPath(root as HTMLElement, target as HTMLElement)).toBe(
      "section:nth-of-type(2) > p:nth-of-type(2) > span:nth-of-type(1)",
    );
  });

  it("promotes DOCX inline clicks to stable semantic targets", () => {
    document.body.innerHTML = `
      <div id="root">
        <section>
          <p id="paragraph">Revenue <strong><span id="target">target</span></strong></p>
        </section>
      </div>
    `;
    const root = document.getElementById("root") as HTMLElement;
    const paragraph = document.getElementById("paragraph") as HTMLElement;
    const target = document.getElementById("target") as HTMLElement;

    expect(getDocxSemanticTargetElement(root, target)).toBe(paragraph);
  });

  it("uses explicit PDF page numbers and zero-based page indexes", () => {
    document.body.innerHTML = `
      <div id="root">
        <div data-page-number="7"><span id="numbered">Page seven</span></div>
        <div data-page-index="2"><span id="indexed">Page three</span></div>
      </div>
    `;
    const root = document.getElementById("root") as HTMLElement;
    const numbered = document.getElementById("numbered") as HTMLElement;
    const indexed = document.getElementById("indexed") as HTMLElement;

    expect(findClosestPdfPageElement(root, numbered)).toMatchObject({ pageIndex: 7 });
    expect(findClosestPdfPageElement(root, indexed)).toMatchObject({ pageIndex: 3 });
  });

  it("falls back to the page under the click y coordinate", () => {
    document.body.innerHTML = `
      <div id="root">
        <div class="page" id="page-1"></div>
        <div class="page" id="page-2"></div>
      </div>
    `;
    const root = document.getElementById("root") as HTMLElement;
    const firstPage = document.getElementById("page-1") as HTMLElement;
    const secondPage = document.getElementById("page-2") as HTMLElement;
    vi.spyOn(firstPage, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 100,
    } as DOMRect);
    vi.spyOn(secondPage, "getBoundingClientRect").mockReturnValue({
      top: 101,
      bottom: 220,
    } as DOMRect);

    expect(getPdfPageTarget(root, null, 150)).toMatchObject({
      element: secondPage,
      pageIndex: 2,
    });
  });

  it("uses the PDF page content layer instead of the outer page wrapper", () => {
    document.body.innerHTML = `
      <div id="page" data-page-number="1">
        <div id="chrome"></div>
        <canvas id="canvas" data-pdf-page-content="true"></canvas>
      </div>
    `;
    const page = document.getElementById("page") as HTMLElement;
    const canvas = document.getElementById("canvas") as HTMLElement;
    vi.spyOn(page, "getBoundingClientRect").mockReturnValue({
      width: 900,
      height: 1200,
    } as DOMRect);
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      width: 600,
      height: 800,
    } as DOMRect);

    expect(getPdfPageContentElement(page)).toBe(canvas);
  });

  it("falls back to the PDF root when no page elements exist", () => {
    document.body.innerHTML = `<div id="root"><div id="target">PDF copy</div></div>`;
    const root = document.getElementById("root") as HTMLElement;
    const target = document.getElementById("target") as HTMLElement;

    expect(getPdfPageTarget(root, target, 150)).toEqual({
      element: root,
      pageIndex: 1,
    });
  });
});
