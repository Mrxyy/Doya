import { createRequire } from "node:module";
import JSZip from "jszip";
import type { WorkBook, WorkSheet } from "xlsx";
import * as XLSX from "xlsx";

const require = createRequire(import.meta.url);
type XlsxCalc = ((workbook: WorkBook, options?: unknown) => void) & {
  import_functions?: (functions: unknown) => void;
};
const XLSX_CALC = require("xlsx-calc") as XlsxCalc;
const formulaJs = require("@formulajs/formulajs") as unknown;

XLSX_CALC.import_functions?.(formulaJs);

interface CachedCellValue {
  t: "n" | "str";
  v: number | string;
}

interface WorkbookCache {
  formulas: Map<string, Map<string, CachedCellValue>>;
  sheetNames: string[];
  sheets: Map<string, Map<string, CachedCellValue>>;
}

export async function createOnlyOfficeXlsxPreviewBuffer(input: Buffer): Promise<Buffer> {
  const workbook = XLSX.read(input, {
    cellFormula: true,
    cellNF: true,
    cellStyles: false,
    cellText: false,
    sheetStubs: true,
  });
  XLSX_CALC(workbook, { continue_after_error: true, log_error: false });

  const cache = createWorkbookCache(workbook);
  const zip = await JSZip.loadAsync(input);

  await Promise.all(
    Object.keys(zip.files).map(async (filename) => {
      const file = zip.file(filename);
      if (!file) {
        return;
      }

      if (/^xl\/worksheets\/sheet\d+\.xml$/.test(filename)) {
        const match = /sheet(\d+)\.xml$/.exec(filename);
        const sheetIndex = match ? Number.parseInt(match[1], 10) - 1 : -1;
        const sheetName = cache.sheetNames[sheetIndex];
        if (!sheetName) {
          return;
        }
        const xml = await file.async("string");
        zip.file(filename, patchWorksheetFormulaCaches(xml, sheetName, cache));
        return;
      }

      if (/^xl\/charts\/chart\d+\.xml$/.test(filename)) {
        const xml = await file.async("string");
        zip.file(filename, patchChartCaches(xml, cache));
      }
    }),
  );

  return await zip.generateAsync({
    compression: "DEFLATE",
    type: "nodebuffer",
  });
}

function createWorkbookCache(workbook: WorkBook): WorkbookCache {
  const sheets = new Map<string, Map<string, CachedCellValue>>();
  const formulas = new Map<string, Map<string, CachedCellValue>>();

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const sheetValues = new Map<string, CachedCellValue>();
    const formulaValues = new Map<string, CachedCellValue>();
    for (const [address, rawCell] of Object.entries(sheet ?? {})) {
      if (address.startsWith("!")) {
        continue;
      }
      const cell = rawCell as WorkSheet[string] | undefined;
      if (!cell) {
        continue;
      }
      const value = toCachedCellValue(cell.v);
      sheetValues.set(address, value);
      if (typeof cell.f === "string") {
        formulaValues.set(address, value);
      }
    }
    sheets.set(sheetName, sheetValues);
    formulas.set(sheetName, formulaValues);
  }

  return {
    formulas,
    sheetNames: workbook.SheetNames,
    sheets,
  };
}

function toCachedCellValue(value: unknown): CachedCellValue {
  if (typeof value === "number" && Number.isFinite(value)) {
    return { t: "n", v: value };
  }
  if (typeof value === "string") {
    return { t: "str", v: value };
  }
  return { t: "str", v: "" };
}

function patchWorksheetFormulaCaches(xml: string, sheetName: string, cache: WorkbookCache): string {
  const formulaValues = cache.formulas.get(sheetName);
  if (!formulaValues?.size) {
    return xml;
  }

  let nextXml = xml;
  for (const [address, value] of formulaValues) {
    nextXml = nextXml.replace(
      new RegExp(`<c\\b(?=[^>]*\\br="${escapeRegExp(address)}")[\\s\\S]*?</c>`),
      (cellXml) => patchCellCache(cellXml, value),
    );
  }
  return nextXml;
}

function patchCellCache(cellXml: string, value: CachedCellValue): string {
  const openTagMatch = /^<c\b[^>]*>/.exec(cellXml);
  if (!openTagMatch) {
    return cellXml;
  }

  const openTag =
    value.t === "n"
      ? openTagMatch[0].replace(/\s+t="[^"]*"/, "")
      : setXmlAttribute(openTagMatch[0], "t", "str");
  const body = openTag + cellXml.slice(openTagMatch[0].length);
  const valueXml = `<v>${escapeXmlText(value.v)}</v>`;
  if (/<v>[\s\S]*?<\/v>/.test(body)) {
    return body.replace(/<v>[\s\S]*?<\/v>/, valueXml);
  }
  return body.replace("</c>", `${valueXml}</c>`);
}

function patchChartCaches(xml: string, cache: WorkbookCache): string {
  const cachedXml = xml
    .replace(xmlTagPattern("strRef"), (block) => {
      const values = chartRefValues(block, cache);
      return values.length ? insertCache(block, "strRef", "strCache", values) : block;
    })
    .replace(xmlTagPattern("numRef"), (block) => {
      const values = chartRefValues(block, cache);
      if (!values.length) {
        return block;
      }
      if (values.some((value) => value.t !== "n")) {
        return convertNumRefToStrRef(block, values);
      }
      return insertCache(block, "numRef", "numCache", values);
    });
  return normalizeCategoryValueAxes(cachedXml);
}

function normalizeCategoryValueAxes(xml: string): string {
  const hasVerticalBarChart = /<(?:\w+:)?barChart\b[\s\S]*?<(?:\w+:)?barDir\s+val="col"/.test(xml);
  const hasLineChart = /<(?:\w+:)?lineChart\b/.test(xml);
  if (!hasVerticalBarChart && !hasLineChart) {
    return xml;
  }
  return xml
    .replace(axisTagPattern("catAx"), (axisXml) => patchAxisPosition(axisXml, "catAx", "b"))
    .replace(axisTagPattern("valAx"), (axisXml) => patchAxisPosition(axisXml, "valAx", "l"));
}

function patchAxisPosition(axisXml: string, axisTag: "catAx" | "valAx", position: string): string {
  const prefix = xmlTagPrefix(axisXml, axisTag);
  const axPosPattern = new RegExp(`<${escapeRegExp(prefix)}axPos\\b[^>]*/>`);
  const axPosXml = `<${prefix}axPos val="${position}"/>`;
  if (axPosPattern.test(axisXml)) {
    return axisXml.replace(axPosPattern, axPosXml);
  }
  return axisXml.replace(new RegExp(`(<${escapeRegExp(prefix)}axId\\b[^>]*/>)`), `$1${axPosXml}`);
}

function chartRefValues(block: string, cache: WorkbookCache): CachedCellValue[] {
  const formula = /<(?:\w+:)?f>([\s\S]*?)<\/(?:\w+:)?f>/.exec(block)?.[1];
  const decodedRef = formula ? decodeRangeRef(unescapeXmlText(formula)) : null;
  if (!decodedRef) {
    return [];
  }
  const sheetValues = cache.sheets.get(decodedRef.sheetName);
  if (!sheetValues) {
    return [];
  }
  return decodedRef.addresses.map((address) => sheetValues.get(address) ?? { t: "str", v: "" });
}

function decodeRangeRef(ref: string): { addresses: string[]; sheetName: string } | null {
  const separatorIndex = ref.lastIndexOf("!");
  if (separatorIndex < 0) {
    return null;
  }
  const sheetName = ref.slice(0, separatorIndex).trim().replace(/^'|'$/g, "").replace(/''/g, "'");
  const [start, end = start] = ref
    .slice(separatorIndex + 1)
    .replace(/\$/g, "")
    .split(":");
  return {
    addresses: expandRange(start, end),
    sheetName,
  };
}

function expandRange(start: string, end: string): string[] {
  const [startCol, startRow] = splitAddress(start);
  const [endCol, endRow] = splitAddress(end);
  const addresses: string[] = [];
  for (let row = Math.min(startRow, endRow); row <= Math.max(startRow, endRow); row += 1) {
    for (let col = Math.min(startCol, endCol); col <= Math.max(startCol, endCol); col += 1) {
      addresses.push(`${indexToColumn(col)}${row + 1}`);
    }
  }
  return addresses;
}

function splitAddress(address: string): [number, number] {
  const match = /^([A-Z]+)(\d+)$/i.exec(address);
  if (!match) {
    return [0, 0];
  }
  return [columnToIndex(match[1]), Number.parseInt(match[2], 10) - 1];
}

function columnToIndex(column: string): number {
  let index = 0;
  for (const char of column) {
    index = index * 26 + char.toUpperCase().charCodeAt(0) - 64;
  }
  return index - 1;
}

function indexToColumn(index: number): string {
  let value = index + 1;
  let column = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    column = String.fromCharCode(65 + remainder) + column;
    value = Math.floor((value - 1) / 26);
  }
  return column;
}

function insertCache(
  block: string,
  refTag: "numRef" | "strRef",
  cacheTag: "numCache" | "strCache",
  values: CachedCellValue[],
): string {
  const prefix = xmlTagPrefix(block, refTag);
  const cacheXml = createCacheXml(prefix, cacheTag, values);
  const existingCachePattern = xmlTagPattern(cacheTag);
  if (existingCachePattern.test(block)) {
    return block.replace(existingCachePattern, cacheXml);
  }
  return block.replace(`</${prefix}${refTag}>`, `${cacheXml}</${prefix}${refTag}>`);
}

function convertNumRefToStrRef(block: string, values: CachedCellValue[]): string {
  const prefix = xmlTagPrefix(block, "numRef");
  const inner = block
    .replace(new RegExp(`^<${escapeRegExp(prefix)}numRef\\b[^>]*>`), "")
    .replace(new RegExp(`</${escapeRegExp(prefix)}numRef>$`), "")
    .replace(xmlTagPattern("numCache"), "");
  return `<${prefix}strRef>${inner}${createCacheXml(prefix, "strCache", values)}</${prefix}strRef>`;
}

function createCacheXml(
  prefix: string,
  tag: "numCache" | "strCache",
  values: CachedCellValue[],
): string {
  const formatCode = tag === "numCache" ? `<${prefix}formatCode>General</${prefix}formatCode>` : "";
  const points = values
    .map((value, index) => {
      const cacheValue = tag === "numCache" && value.t !== "n" ? 0 : value.v;
      return `<${prefix}pt idx="${index}"><${prefix}v>${escapeXmlText(cacheValue)}</${prefix}v></${prefix}pt>`;
    })
    .join("");
  return `<${prefix}${tag}>${formatCode}<${prefix}ptCount val="${values.length}"/>${points}</${prefix}${tag}>`;
}

function xmlTagPattern(tag: string): RegExp {
  return new RegExp(`<(?:\\w+:)?${tag}\\b[\\s\\S]*?</(?:\\w+:)?${tag}>`, "g");
}

function axisTagPattern(tag: "catAx" | "valAx"): RegExp {
  return xmlTagPattern(tag);
}

function xmlTagPrefix(block: string, tag: string): string {
  const match = new RegExp(`^<(?:(\\w+):)?${tag}\\b`).exec(block);
  return match?.[1] ? `${match[1]}:` : "";
}

function setXmlAttribute(openTag: string, name: string, value: string): string {
  if (new RegExp(`\\s${name}="[^"]*"`).test(openTag)) {
    return openTag.replace(
      new RegExp(`\\s${name}="[^"]*"`),
      ` ${name}="${escapeXmlAttribute(value)}"`,
    );
  }
  return `${openTag.slice(0, -1)} ${name}="${escapeXmlAttribute(value)}">`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function escapeXmlText(value: number | string): string {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeXmlAttribute(value: string): string {
  return escapeXmlText(value).replace(/"/g, "&quot;");
}

function unescapeXmlText(value: string): string {
  return value
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}
