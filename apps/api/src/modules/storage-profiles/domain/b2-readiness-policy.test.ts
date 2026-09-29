import { describe, expect, it } from "vitest";
import {
  desiredNodeProxCors,
  desiredNodeProxLifecycle,
  equivalentCors,
  harmfulMediaLifecycle,
} from "./b2-readiness-policy.js";

describe("B2 readiness policy", () => {
  it("uses server-controlled exact origins and the current signed PUT header set", () => {
    const rule = desiredNodeProxCors([
      "https://app.nodeprox.org",
      "https://app.nodeprox.org",
    ]);
    expect(rule).toMatchObject({
      corsRuleName: "nodeprox-browser-upload-v1",
      allowedOrigins: ["https://app.nodeprox.org"],
      allowedOperations: ["s3_put"],
      allowedHeaders: ["content-type"],
      exposeHeaders: ["ETag"],
      maxAgeSeconds: 3600,
    });
    expect(
      equivalentCors(rule, { ...rule, allowedHeaders: ["CONTENT-TYPE"] }),
    ).toBe(true);
    expect(() =>
      desiredNodeProxCors(["https://app.nodeprox.org/path"]),
    ).toThrow();
  });
  it("limits lifecycle to uploads and blocks broad Media expiration", () => {
    expect(desiredNodeProxLifecycle()).toEqual({
      id: "nodeprox-uploads-v1",
      prefix: "uploads/",
      expirationDays: 1,
      noncurrentDays: 1,
      abortMultipartDays: 1,
    });
    expect(
      harmfulMediaLifecycle([
        {
          id: "foreign",
          prefix: "",
          expirationDays: 1,
          noncurrentDays: null,
          abortMultipartDays: null,
        },
      ]),
    ).toBe(true);
    expect(
      harmfulMediaLifecycle([
        {
          id: "foreign",
          prefix: "other/",
          expirationDays: 1,
          noncurrentDays: null,
          abortMultipartDays: null,
        },
      ]),
    ).toBe(false);
  });
});
