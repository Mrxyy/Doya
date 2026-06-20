import { normalizeAnnotationText } from "@/utils/document-annotation-target";

export function getSelectionTextWithin(root: HTMLElement): string {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return "";
  }
  const anchorNode = selection.anchorNode;
  const focusNode = selection.focusNode;
  if ((anchorNode && !root.contains(anchorNode)) || (focusNode && !root.contains(focusNode))) {
    return "";
  }
  return normalizeAnnotationText(selection.toString(), 1000);
}

export function getSelectionSemanticTargetWithin(root: HTMLElement): HTMLElement | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) {
    return null;
  }
  const selectedText = normalizeAnnotationText(selection.toString(), 1000);
  if (!selectedText) {
    return null;
  }
  const anchorNode = selection.anchorNode;
  const focusNode = selection.focusNode;
  if ((anchorNode && !root.contains(anchorNode)) || (focusNode && !root.contains(focusNode))) {
    return null;
  }
  const range = selection.getRangeAt(0);
  const commonAncestor = range.commonAncestorContainer;
  let element: HTMLElement | null = null;
  if (commonAncestor instanceof HTMLElement) {
    element = commonAncestor;
  } else if (commonAncestor.parentNode instanceof HTMLElement) {
    element = commonAncestor.parentNode;
  }
  if (!element || !root.contains(element)) {
    return null;
  }
  return getDocxSemanticTargetElement(root, element);
}

export function getElementTextSnippet(element: HTMLElement): string {
  return normalizeAnnotationText(element.textContent ?? "", 500);
}

export function getElementLabel(element: HTMLElement): string {
  const tag = element.tagName.toLowerCase();
  const text = getElementTextSnippet(element);
  return text ? `${tag}: ${text.slice(0, 32)}` : tag;
}

export function getDocxSemanticTargetElement(root: HTMLElement, element: HTMLElement): HTMLElement {
  const selector = [
    "p",
    "td",
    "th",
    "li",
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "figcaption",
    "figure",
    "table",
    "img",
  ].join(",");
  const semanticTarget = element.closest(selector);
  return semanticTarget instanceof HTMLElement && root.contains(semanticTarget)
    ? semanticTarget
    : element;
}

export function buildElementPath(root: HTMLElement, element: HTMLElement): string {
  const parts: string[] = [];
  let cursor: HTMLElement | null = element;
  while (cursor && cursor !== root) {
    const tag = cursor.tagName.toLowerCase();
    const parent: HTMLElement | null = cursor.parentElement;
    if (!parent) {
      break;
    }
    const sameTagSiblings = Array.from(parent.children).filter(
      (child): child is HTMLElement =>
        child instanceof HTMLElement && child.tagName.toLowerCase() === tag,
    );
    const index = sameTagSiblings.indexOf(cursor) + 1;
    parts.unshift(`${tag}:nth-of-type(${Math.max(1, index)})`);
    cursor = parent;
  }
  return parts.join(" > ");
}

export function getDocxPageIndex(root: HTMLElement, element: HTMLElement): number {
  const pages = Array.from(root.querySelectorAll("section"));
  const pageIndex = pages.findIndex((page) => page.contains(element));
  return pageIndex >= 0 ? pageIndex + 1 : 1;
}

export function getPdfPageTarget(
  root: HTMLElement,
  target: HTMLElement | null,
  clientY: number,
): { element: HTMLElement; pageIndex: number } {
  const closestPage = findClosestPdfPageElement(root, target);
  if (closestPage) {
    return closestPage;
  }
  const pages = findPdfPageElements(root);
  const pageIndex = pages.findIndex((page) => {
    const rect = page.getBoundingClientRect();
    return clientY >= rect.top && clientY <= rect.bottom;
  });
  if (pageIndex >= 0) {
    const page = pages[pageIndex];
    if (page) {
      return { element: page, pageIndex: pageIndex + 1 };
    }
  }
  return { element: root, pageIndex: 1 };
}

export function getPdfPageContentElement(
  pageElement: HTMLElement,
  eventElement?: HTMLElement | null,
): HTMLElement {
  const contentSelector = [
    "[data-pdf-page-content]",
    "[data-testid='pdf-page-content']",
    "canvas",
    "svg",
    "img",
    ".canvasWrapper",
    "[class*='canvas']",
    "[class*='Canvas']",
    "[class*='page-content']",
    "[class*='pageContent']",
  ].join(",");
  const closestContent = eventElement?.closest(contentSelector);
  if (closestContent instanceof HTMLElement && pageElement.contains(closestContent)) {
    return closestContent;
  }
  const candidates = Array.from(pageElement.querySelectorAll(contentSelector)).filter(
    (element): element is HTMLElement => element instanceof HTMLElement,
  );
  const largest = candidates.reduce<{ element: HTMLElement; area: number } | null>(
    (current, element) => {
      const rect = element.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area <= 0) {
        return current;
      }
      return !current || area > current.area ? { element, area } : current;
    },
    null,
  );
  return largest?.element ?? pageElement;
}

export function findClosestPdfPageElement(
  root: HTMLElement,
  target: HTMLElement | null,
): { element: HTMLElement; pageIndex: number } | null {
  if (!target) {
    return null;
  }
  const pageSelector = '[data-page-number], [data-page-index], [aria-label*="Page"], .page';
  const element = target.closest(pageSelector);
  if (!(element instanceof HTMLElement) || !root.contains(element)) {
    return null;
  }
  const explicitPageNumber =
    Number(element.dataset.pageNumber) || Number(element.getAttribute("data-page-number"));
  const explicitPageIndex =
    Number(element.dataset.pageIndex) || Number(element.getAttribute("data-page-index"));
  if (Number.isFinite(explicitPageNumber) && explicitPageNumber > 0) {
    return { element, pageIndex: explicitPageNumber };
  }
  if (Number.isFinite(explicitPageIndex) && explicitPageIndex >= 0) {
    return { element, pageIndex: explicitPageIndex + 1 };
  }
  const pages = findPdfPageElements(root);
  const pageIndex = pages.indexOf(element);
  return { element, pageIndex: pageIndex >= 0 ? pageIndex + 1 : 1 };
}

export function findPdfPageElements(root: HTMLElement): HTMLElement[] {
  const pageSelector = '[data-page-number], [data-page-index], [aria-label*="Page"], .page';
  return Array.from(root.querySelectorAll(pageSelector)).filter(
    (element): element is HTMLElement => element instanceof HTMLElement,
  );
}
