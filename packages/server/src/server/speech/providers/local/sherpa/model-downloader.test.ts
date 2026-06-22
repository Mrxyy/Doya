import { describe, expect, test } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import pino from "pino";

import { ensureSherpaOnnxModel, getSherpaOnnxModelDir } from "./model-downloader.js";

function makeTmpDir(): string {
  return mkdtempSync(path.join(tmpdir(), "doya-speech-models-"));
}

const logger = pino({ level: "silent" });

describe("sherpa model downloader", () => {
  test("getSherpaOnnxModelDir maps modelId to extractedDir", () => {
    const modelsDir = "/tmp/models";
    expect(getSherpaOnnxModelDir(modelsDir, "paraformer-zh-small-2024-03-09")).toContain(
      "sherpa-onnx-paraformer-zh-small-2024-03-09",
    );
    expect(getSherpaOnnxModelDir(modelsDir, "parakeet-tdt-0.6b-v2-int8")).toContain(
      "sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8",
    );
    expect(getSherpaOnnxModelDir(modelsDir, "kokoro-en-v0_19")).toContain("kokoro-en-v0_19");
    expect(getSherpaOnnxModelDir(modelsDir, "vits-piper-zh_cn-xiao_ya-medium")).toContain(
      "vits-piper-zh_CN-xiao_ya-medium",
    );
  });

  test("ensureSherpaOnnxModel succeeds without downloading when files exist", async () => {
    const modelsDir = makeTmpDir();
    const modelDir = getSherpaOnnxModelDir(modelsDir, "paraformer-zh-small-2024-03-09");

    mkdirSync(modelDir, { recursive: true });
    writeFileSync(path.join(modelDir, "model.int8.onnx"), "x");
    writeFileSync(path.join(modelDir, "tokens.txt"), "x");

    const out = await ensureSherpaOnnxModel({
      modelsDir,
      modelId: "paraformer-zh-small-2024-03-09",
      logger,
    });

    expect(out).toBe(modelDir);
  });
});
