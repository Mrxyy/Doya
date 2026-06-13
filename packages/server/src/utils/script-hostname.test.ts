import { describe, expect, it } from "vitest";
import { buildScriptHostname } from "./script-hostname.js";

describe("buildScriptHostname", () => {
  it("builds default branch hostnames with script and project labels", () => {
    expect(
      buildScriptHostname({
        projectSlug: "doya",
        branchName: null,
        scriptName: "web",
      }),
    ).toBe("web.doya.localhost");
  });

  it("omits the branch label for main and master", () => {
    expect(
      buildScriptHostname({
        projectSlug: "doya",
        branchName: "main",
        scriptName: "web",
      }),
    ).toBe("web.doya.localhost");
    expect(
      buildScriptHostname({
        projectSlug: "doya",
        branchName: "master",
        scriptName: "web",
      }),
    ).toBe("web.doya.localhost");
  });

  it("builds non-default branch hostnames with script, branch, and project labels", () => {
    expect(
      buildScriptHostname({
        projectSlug: "doya",
        branchName: "feature-auth",
        scriptName: "web",
      }),
    ).toBe("web.feature-auth.doya.localhost");
  });

  it("slugifies script, default branch project, and non-default branch labels", () => {
    expect(
      buildScriptHostname({
        projectSlug: "Doya App",
        branchName: "Feature/Auth Flow",
        scriptName: "Web/API @ Dev",
      }),
    ).toBe("web-api-dev.feature-auth-flow.doya-app.localhost");
  });

  it("accepts already slugified labels because slugify is idempotent", () => {
    expect(
      buildScriptHostname({
        projectSlug: "doya-app",
        branchName: "feature-auth-flow",
        scriptName: "web-api-dev",
      }),
    ).toBe("web-api-dev.feature-auth-flow.doya-app.localhost");
  });

  it("uses untitled as the hostname-label fallback when labels collapse to empty", () => {
    expect(
      buildScriptHostname({
        projectSlug: "日本語",
        branchName: "***",
        scriptName: "---",
      }),
    ).toBe("untitled.untitled.untitled.localhost");
  });
});
