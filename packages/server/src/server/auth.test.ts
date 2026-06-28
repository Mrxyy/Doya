import { describe, expect, test } from "vitest";
import express from "express";
import { createServer } from "node:http";

import {
  DAEMON_INTERNAL_AUTH_HEADER,
  createRequireBearerMiddleware,
  extractHttpBearerToken,
  extractWsBearerProtocol,
  extractWsBearerToken,
  hashDaemonPassword,
  isBearerTokenValidAsync,
  isBearerTokenValid,
} from "./auth.js";

const CORRECT_PASSWORD_HASH = "$2b$12$OLxyuuP9uLK30Uzc4wQX0O6liuU/Q1t5P2b0Ebf36mULvpVK3DRZW";

describe("daemon bearer validator", () => {
  test("allows any token when no password is configured", () => {
    expect(isBearerTokenValid({ password: undefined, token: null })).toBe(true);
    expect(isBearerTokenValid({ password: undefined, token: "anything" })).toBe(true);
  });

  test("accepts the plaintext token against the bcrypt hash and rejects missing or wrong tokens", async () => {
    expect(
      await isBearerTokenValidAsync({ password: CORRECT_PASSWORD_HASH, token: "correct-password" }),
    ).toBe(true);
    expect(isBearerTokenValid({ password: CORRECT_PASSWORD_HASH, token: "correct-password" })).toBe(
      true,
    );
    expect(await isBearerTokenValidAsync({ password: CORRECT_PASSWORD_HASH, token: null })).toBe(
      false,
    );
    expect(await isBearerTokenValidAsync({ password: CORRECT_PASSWORD_HASH, token: "wrong" })).toBe(
      false,
    );
  });

  test("hashes a password into a bcrypt value", () => {
    const hash = hashDaemonPassword("correct-password");

    expect(hash).toMatch(/^\$2[aby]\$12\$/);
    expect(isBearerTokenValid({ password: hash, token: "correct-password" })).toBe(true);
  });

  test("extracts HTTP bearer tokens", () => {
    expect(extractHttpBearerToken("Bearer secret")).toBe("secret");
    expect(extractHttpBearerToken("Basic secret")).toBeNull();
    expect(extractHttpBearerToken(undefined)).toBeNull();
  });

  test("extracts WebSocket Doya bearer subprotocol tokens", () => {
    const protocol = extractWsBearerProtocol("chat, doya.bearer.secret.with.dots");

    expect(protocol).toBe("doya.bearer.secret.with.dots");
    expect(extractWsBearerToken(protocol)).toBe("secret.with.dots");
    expect(extractWsBearerToken("doya.other.secret")).toBeNull();
  });

  test("accepts legacy Doya WebSocket bearer subprotocol tokens", () => {
    const protocol = extractWsBearerProtocol("chat, doya.bearer.secret.with.dots");

    expect(protocol).toBe("doya.bearer.secret.with.dots");
    expect(extractWsBearerToken(protocol)).toBe("secret.with.dots");
  });

  test("allows process-internal HTTP requests without the user password", async () => {
    const app = express();
    app.use(
      createRequireBearerMiddleware({ password: CORRECT_PASSWORD_HASH }, undefined, {
        internalAuthToken: "internal-secret",
      }),
    );
    app.get("/protected", (_req, res) => {
      res.json({ ok: true });
    });
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("Test server did not bind to a TCP port");
    }

    try {
      const missing = await fetch(`http://127.0.0.1:${address.port}/protected`);
      expect(missing.status).toBe(401);

      const internal = await fetch(`http://127.0.0.1:${address.port}/protected`, {
        headers: { [DAEMON_INTERNAL_AUTH_HEADER]: "internal-secret" },
      });
      expect(internal.status).toBe(200);
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  });
});
