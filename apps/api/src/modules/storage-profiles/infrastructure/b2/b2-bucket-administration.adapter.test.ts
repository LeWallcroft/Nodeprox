import {
  GetBucketLifecycleConfigurationCommand,
  PutBucketLifecycleConfigurationCommand,
} from "@aws-sdk/client-s3";
import { describe, expect, it, vi } from "vitest";
import type { B2ManagedCredentials } from "../../application/ports/b2-administration.ports.js";
import { B2BucketAdministrationAdapter } from "./b2-bucket-administration.adapter.js";

const credentials: B2ManagedCredentials = {
  endpoint: "https://s3.us-west-000.backblazeb2.com",
  region: "us-west-000",
  bucket: "nodeprox",
  keyId: "test-key",
  applicationKey: "test-secret",
};
function provider() {
  const state = {
    cors: [] as unknown[],
    lifecycle: [
      {
        ID: "foreign",
        Status: "Enabled",
        Filter: { Prefix: "other/" },
        Expiration: { Days: 10 },
      },
    ] as unknown[],
    revision: 1,
    bucketType: "allPublic",
  };
  const fetcher = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("b2_authorize_account"))
        return Response.json({
          accountId: "account",
          authorizationToken: "ephemeral",
          apiInfo: {
            storageApi: {
              apiUrl: "https://api.example.test",
              downloadUrl: "https://f000.backblazeb2.com",
            },
          },
        });
      if (url.endsWith("b2_list_buckets"))
        return Response.json({
          buckets: [
            {
              bucketId: "bucket-id",
              bucketName: "nodeprox",
              bucketType: state.bucketType,
              revision: state.revision,
              corsRules: state.cors,
            },
          ],
        });
      if (url.endsWith("b2_update_bucket")) {
        const body = JSON.parse(String(init?.body));
        state.cors = body.corsRules;
        state.revision++;
        return Response.json({});
      }
      throw new Error("unexpected fake provider route");
    },
  );
  const s3 = {
    send: vi.fn(async (command: unknown) => {
      if (command instanceof GetBucketLifecycleConfigurationCommand)
        return { Rules: state.lifecycle };
      if (command instanceof PutBucketLifecycleConfigurationCommand) {
        state.lifecycle = command.input.LifecycleConfiguration?.Rules ?? [];
        return {};
      }
      throw new Error("unexpected command");
    }),
  };
  const adapter = new B2BucketAdministrationAdapter(fetcher, () => s3);
  return { state, fetcher, s3, adapter };
}

describe("B2 bucket administration", () => {
  it("discovers the public bucket ID and download hostname without persisting auth data", async () => {
    const f = provider();
    await expect(f.adapter.inspect(credentials)).resolves.toMatchObject({
      bucketId: "bucket-id",
      downloadHost: "f000.backblazeb2.com",
      public: true,
    });
  });
  it("preserves foreign CORS and lifecycle rules and verifies NodeProx rules idempotently", async () => {
    const f = provider();
    f.state.cors = [
      { corsRuleName: "foreign", allowedOrigins: ["https://foreign.test"] },
    ];
    const inspection = await f.adapter.inspect(credentials);
    expect(
      (
        await f.adapter.ensureNodeProxCors({
          credentials,
          inspection,
          allowedOrigins: ["https://app.nodeprox.org"],
          recheckOnly: false,
        })
      ).status,
    ).toBe("verified");
    expect(f.state.cors).toHaveLength(2);
    expect(
      (
        await f.adapter.ensureNodeProxLifecycle({
          credentials,
          inspection,
          recheckOnly: false,
        })
      ).status,
    ).toBe("verified");
    expect(f.state.lifecycle).toHaveLength(3);
    expect(f.state.lifecycle[0]).toMatchObject({
      ID: "foreign",
      Expiration: { Days: 10 },
    });
    expect(f.state.lifecycle[1]).toMatchObject({
      ID: "nodeprox-uploads-v1",
      Status: "Enabled",
      Filter: { Prefix: "uploads/" },
      Expiration: { Days: 1 },
      NoncurrentVersionExpiration: { NoncurrentDays: 1 },
      AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
    });
    expect(f.state.lifecycle[2]).toMatchObject({
      ID: "nodeprox-uploads-v1_marker",
      Status: "Enabled",
      Filter: { Prefix: "uploads/" },
      Expiration: { ExpiredObjectDeleteMarker: true },
    });
    const putCount = f.s3.send.mock.calls.filter(
      ([command]) => command instanceof PutBucketLifecycleConfigurationCommand,
    ).length;
    await expect(
      f.adapter.ensureNodeProxLifecycle({
        credentials,
        inspection,
        recheckOnly: false,
      }),
    ).resolves.toMatchObject({ status: "verified" });
    expect(
      f.s3.send.mock.calls.filter(
        ([command]) =>
          command instanceof PutBucketLifecycleConfigurationCommand,
      ),
    ).toHaveLength(putCount);
  });

  it("normalizes the base and marker pair and repairs a missing marker only when allowed", async () => {
    const f = provider();
    f.state.lifecycle = [
      {
        ID: "nodeprox-uploads-v1",
        Status: "Enabled",
        Filter: { Prefix: "uploads/" },
        Expiration: { Days: 1 },
        NoncurrentVersionExpiration: { NoncurrentDays: 1 },
        AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
      },
    ];
    const inspection = await f.adapter.inspect(credentials);
    await expect(
      f.adapter.ensureNodeProxLifecycle({
        credentials,
        inspection,
        recheckOnly: true,
      }),
    ).resolves.toMatchObject({ status: "manual_required" });
    expect(f.s3.send).not.toHaveBeenCalledWith(
      expect.any(PutBucketLifecycleConfigurationCommand),
    );
    await expect(
      f.adapter.ensureNodeProxLifecycle({
        credentials,
        inspection,
        recheckOnly: false,
      }),
    ).resolves.toMatchObject({ status: "verified" });
    expect(f.state.lifecycle).toHaveLength(2);
  });

  it("replaces only an invalid owned marker family and treats its marker as owned", async () => {
    const f = provider();
    f.state.lifecycle = [
      {
        ID: "foreign",
        Status: "Enabled",
        Filter: { Prefix: "other/" },
        Expiration: { Days: 10 },
      },
      {
        ID: "nodeprox-uploads-v1",
        Status: "Enabled",
        Filter: { Prefix: "uploads/" },
        Expiration: { Days: 1 },
        NoncurrentVersionExpiration: { NoncurrentDays: 1 },
        AbortIncompleteMultipartUpload: { DaysAfterInitiation: 1 },
      },
      {
        ID: "nodeprox-uploads-v1_marker",
        Status: "Enabled",
        Filter: { Prefix: "Media/" },
        Expiration: { ExpiredObjectDeleteMarker: true },
      },
    ];
    const inspection = await f.adapter.inspect(credentials);
    await expect(
      f.adapter.ensureNodeProxLifecycle({
        credentials,
        inspection,
        recheckOnly: false,
      }),
    ).resolves.toMatchObject({ status: "verified" });
    expect(f.state.lifecycle).toHaveLength(3);
    expect(f.state.lifecycle[0]).toMatchObject({ ID: "foreign" });
    expect(f.state.lifecycle[2]).toMatchObject({
      ID: "nodeprox-uploads-v1_marker",
      Filter: { Prefix: "uploads/" },
    });
  });
  it("blocks a broad lifecycle that would expire Media", async () => {
    const f = provider();
    f.state.lifecycle = [
      {
        ID: "unsafe",
        Status: "Enabled",
        Filter: { Prefix: "" },
        Expiration: { Days: 1 },
      },
    ];
    await expect(
      f.adapter.ensureNodeProxLifecycle({
        credentials,
        inspection: await f.adapter.inspect(credentials),
        recheckOnly: false,
      }),
    ).rejects.toThrow("B2_MEDIA_LIFECYCLE_CONFLICT");
    expect(f.s3.send).not.toHaveBeenCalledWith(
      expect.any(PutBucketLifecycleConfigurationCommand),
    );
  });
  it("returns exact non-secret manual configurations when provider writes are unavailable", async () => {
    const f = provider();
    f.fetcher.mockImplementation(async (input: string | URL | Request) => {
      if (String(input).endsWith("b2_update_bucket"))
        return Response.json({}, { status: 403 });
      if (String(input).endsWith("b2_authorize_account"))
        return Response.json({
          accountId: "account",
          authorizationToken: "ephemeral",
          apiInfo: {
            storageApi: {
              apiUrl: "https://api.example.test",
              downloadUrl: "https://f000.backblazeb2.com",
            },
          },
        });
      return Response.json({
        buckets: [
          {
            bucketId: "bucket-id",
            bucketName: "nodeprox",
            bucketType: "allPublic",
            revision: 1,
            corsRules: [],
          },
        ],
      });
    });
    const inspection = await f.adapter.inspect(credentials);
    const cors = await f.adapter.ensureNodeProxCors({
      credentials,
      inspection,
      allowedOrigins: ["https://app.nodeprox.org"],
      recheckOnly: false,
    });
    expect(cors.status).toBe("manual_required");
    expect(
      JSON.parse(String(cors.metadata.desiredCorsConfiguration)),
    ).toMatchObject({
      corsRuleName: "nodeprox-browser-upload-v1",
      allowedOrigins: ["https://app.nodeprox.org"],
    });
    expect(JSON.stringify(cors)).not.toContain(credentials.applicationKey);
    f.s3.send.mockImplementation(async (command: unknown) => {
      if (command instanceof GetBucketLifecycleConfigurationCommand)
        return { Rules: [] };
      throw { $metadata: { httpStatusCode: 403 } };
    });
    const lifecycle = await f.adapter.ensureNodeProxLifecycle({
      credentials,
      inspection,
      recheckOnly: false,
    });
    expect(lifecycle.status).toBe("manual_required");
    expect(
      JSON.parse(String(lifecycle.metadata.desiredLifecycleConfiguration)),
    ).toMatchObject({ prefix: "uploads/", expirationDays: 1 });
    expect(JSON.stringify(lifecycle)).not.toContain(credentials.applicationKey);
  });
});
