import { mkdtemp, readFile, lstat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { preparePptCreationWorkspace } from "./ppt-master-skill.js";

describe("ppt-master skill workspace preparation", () => {
  it("links the bundled skill and materializes file attachments", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "doya-ppt-skill-"));

    const attachments = await preparePptCreationWorkspace({
      cwd,
      attachments: [
        {
          type: "file",
          mimeType: "text/markdown",
          title: "source.md",
          data: Buffer.from("# Source", "utf8").toString("base64"),
        },
      ],
    });

    const skillStat = await lstat(path.join(cwd, ".doya/skills/ppt-master"));
    expect(skillStat.isSymbolicLink() || skillStat.isDirectory()).toBe(true);
    await expect(readFile(path.join(cwd, "attachments/source.md"), "utf8")).resolves.toBe(
      "# Source",
    );
    expect(attachments).toEqual([
      {
        type: "text",
        mimeType: "text/plain",
        title: "PPT source files",
        text: [
          "The user's source files have been written into the workspace.",
          "Use these paths as PPT Master source files:",
          "",
          "- attachments/source.md",
        ].join("\n"),
      },
    ]);
  });
});
