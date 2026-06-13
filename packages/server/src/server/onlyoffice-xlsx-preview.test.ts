import JSZip from "jszip";
import { describe, expect, test } from "vitest";
import * as XLSX from "xlsx";
import { createOnlyOfficeXlsxPreviewBuffer } from "./onlyoffice-xlsx-preview.js";

describe("createOnlyOfficeXlsxPreviewBuffer", () => {
  test("adds formula and chart caches for generated XLSX files", async () => {
    const source = await createGeneratedWorkbookWithEmptyFormulaCaches();

    const preview = await createOnlyOfficeXlsxPreviewBuffer(source);
    const zip = await JSZip.loadAsync(preview);
    const sheetXml = await zip.file("xl/worksheets/sheet1.xml")?.async("string");
    const chartXml = await zip.file("xl/charts/chart1.xml")?.async("string");

    expect(sheetXml).toContain('<c r="D2"><f>B2-C2</f><v>40</v></c>');
    expect(sheetXml).toContain('<c r="D3"><f>B3-C3</f><v>60</v></c>');
    expect(chartXml).toContain("<strRef>");
    expect(chartXml).toContain("<strCache>");
    expect(chartXml).toContain("<v>1月</v>");
    expect(chartXml).toContain("<v>2月</v>");
    expect(chartXml).toContain("<numCache>");
    expect(chartXml).toContain("<v>40</v>");
    expect(chartXml).toContain("<v>60</v>");
    expect(chartXml).toContain('<catAx><axId val="10"/><axPos val="b"/>');
    expect(chartXml).toContain('<valAx><axId val="100"/><axPos val="l"/>');
  });
});

async function createGeneratedWorkbookWithEmptyFormulaCaches(): Promise<Buffer> {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["月份", "销售额", "成本", "利润"],
    ["1月", 120, 80, null],
    ["2月", 160, 100, null],
  ]);
  sheet.D2 = { f: "B2-C2", t: "n", v: 0 };
  sheet.D3 = { f: "B3-C3", t: "n", v: 0 };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");

  const buffer = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "buffer",
  }) as Buffer;
  const zip = await JSZip.loadAsync(buffer);
  const sheetXml = await zip.file("xl/worksheets/sheet1.xml")?.async("string");
  if (!sheetXml) {
    throw new Error("Generated XLSX is missing sheet XML");
  }

  zip.file(
    "xl/worksheets/sheet1.xml",
    sheetXml
      .replace(/<c r="D2"[^>]*><f>B2-C2<\/f><v>0<\/v><\/c>/, '<c r="D2"><f>B2-C2</f><v></v></c>')
      .replace(/<c r="D3"[^>]*><f>B3-C3<\/f><v>0<\/v><\/c>/, '<c r="D3"><f>B3-C3</f><v></v></c>'),
  );
  zip.file(
    "xl/charts/chart1.xml",
    [
      '<chartSpace xmlns="http://schemas.openxmlformats.org/drawingml/2006/chart">',
      "<chart><plotArea><lineChart><ser>",
      "<cat><numRef><f>Sheet1!$A$2:$A$3</f></numRef></cat>",
      "<val><numRef><f>Sheet1!$D$2:$D$3</f></numRef></val>",
      '</ser><axId val="10"/><axId val="100"/></lineChart>',
      '<catAx><axId val="10"/><axPos val="l"/><crossAx val="100"/></catAx>',
      '<valAx><axId val="100"/><axPos val="b"/><crossAx val="10"/></valAx>',
      "</plotArea></chart>",
      "</chartSpace>",
    ].join(""),
  );

  return await zip.generateAsync({
    compression: "DEFLATE",
    type: "nodebuffer",
  });
}
