import { Asset } from "expo-asset";

import type { HomePresetBundledFile } from "./home-preset-files";

type HomePresetFileAssetModule = number;

const documentPrdFile = require("./document-prd/output/documents/区域门店经理移动运营看板PRD.docx") as HomePresetFileAssetModule;
const pdfBriefFile = require("./pdf-brief/output/documents/retail_market_executive_brief.pdf") as HomePresetFileAssetModule;
const sheetBudgetFile = require("./sheet-budget/output/spreadsheets/餐厅季度预算表_含公式和图表.xlsx") as HomePresetFileAssetModule;
const slidesRoadshowFile = require("./slides-roadshow/projects/b2b_saas_analytics_pitch_ppt169_20260621/exports/b2b_saas_analytics_pitch_20260621_014923.pptx") as HomePresetFileAssetModule;

const HomePresetFileAssetModules = new Map<string, HomePresetFileAssetModule>([
  [
    buildHomePresetFileAssetKey({
      presetId: "document-prd",
      path: "output/documents/区域门店经理移动运营看板PRD.docx",
    }),
    documentPrdFile,
  ],
  [
    buildHomePresetFileAssetKey({
      presetId: "pdf-brief",
      path: "output/documents/retail_market_executive_brief.pdf",
    }),
    pdfBriefFile,
  ],
  [
    buildHomePresetFileAssetKey({
      presetId: "sheet-budget",
      path: "output/spreadsheets/餐厅季度预算表_含公式和图表.xlsx",
    }),
    sheetBudgetFile,
  ],
  [
    buildHomePresetFileAssetKey({
      presetId: "slides-roadshow",
      path: "projects/b2b_saas_analytics_pitch_ppt169_20260621/exports/b2b_saas_analytics_pitch_20260621_014923.pptx",
    }),
    slidesRoadshowFile,
  ],
]);

export function getHomePresetFileAssetUrl(file: HomePresetBundledFile): string | null {
  const assetModule = HomePresetFileAssetModules.get(
    buildHomePresetFileAssetKey({
      presetId: file.presetId,
      path: file.path,
    }),
  );
  if (!assetModule) {
    return null;
  }
  const uri = Asset.fromModule(assetModule).uri;
  return uri.trim() || null;
}

function buildHomePresetFileAssetKey(input: { presetId: string; path: string }): string {
  return `${input.presetId}:${normalizeHomePresetFileAssetPath(input.path)}`;
}

function normalizeHomePresetFileAssetPath(filePath: string): string {
  return filePath.trim().replace(/\\/g, "/").replace(/^\.\//, "");
}
