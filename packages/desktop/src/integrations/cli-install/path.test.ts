import { describe, expect, it } from "vitest";
import { resolveCliInstallSourcePath } from "./path";

describe("cli-install-path", () => {
  it("uses the bundled shim for packaged macOS installs", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "darwin",
        isPackaged: true,
        executablePath: "/Applications/Doya.app/Contents/MacOS/Doya",
        shimPath: "/Applications/Doya.app/Contents/Resources/bin/doya",
      }),
    ).toBe("/Applications/Doya.app/Contents/Resources/bin/doya");
  });

  it("prefers the original AppImage path on linux", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "linux",
        isPackaged: true,
        executablePath: "/tmp/.mount_doya123/doya",
        shimPath: "/tmp/.mount_doya123/resources/bin/doya",
        appImagePath: "/home/user/Applications/Doya.AppImage",
      }),
    ).toBe("/home/user/Applications/Doya.AppImage");
  });

  it("falls back to the shim on windows and in development", () => {
    expect(
      resolveCliInstallSourcePath({
        platform: "win32",
        isPackaged: true,
        executablePath: "C:\\Users\\user\\AppData\\Local\\Programs\\Doya\\Doya.exe",
        shimPath: "C:\\Users\\user\\AppData\\Local\\Programs\\Doya\\resources\\bin\\doya.cmd",
      }),
    ).toBe("C:\\Users\\user\\AppData\\Local\\Programs\\Doya\\resources\\bin\\doya.cmd");

    expect(
      resolveCliInstallSourcePath({
        platform: "linux",
        isPackaged: false,
        executablePath: "/opt/Doya/doya",
        shimPath: "/opt/Doya/resources/bin/doya",
      }),
    ).toBe("/opt/Doya/resources/bin/doya");
  });
});
