# Direct ZIP upload to Backblaze B2

The normative ZIP path is:

1. Browser sends filename, MIME and size to `POST /chapters/:chapterId/uploads/initiate` through the same-origin Next.js API boundary.
2. The API authenticates the session, evaluates contextual `images.upload`, creates the server-side key and returns a short-lived object-scoped signed `PUT` URL.
3. The browser sends the ZIP directly to the Backblaze S3-compatible endpoint. The ZIP does not pass through Next.js, Fastify or Cloudflare CDN.
4. The browser calls `POST /chapters/:chapterId/uploads/:uploadId/complete`.
5. The API uses `HEAD` against the server-side key and checks real size and Content-Type before atomically changing the upload and Chapter to `uploaded`.

## Finalization authorization and serialization

`initiate`, a presigned B2 URL and the preliminary authorization at the start of `complete` do not create an authorization lease. The B2 `HEAD` runs without an open PostgreSQL transaction. After `HEAD`, the persistence boundary opens one transaction that revalidates the current session, active Identity, RBAC capability and contextual Chapter authority before changing the upload, Chapter and processing outbox together.

All transaction-aware authorization boundaries use the same global order. Rows that do not determine a particular operation are skipped:

1. Session.
2. User/Identity rows, sorted by UUID when more than one user is involved.
3. Series.
4. Series assignment.
5. Chapter.
6. Upload.
7. Matching active helper permission.

This order is shared by upload finalization, Chapter update/delete, Series update/delete, reassignment and helper revocation. Assignment/reassignment, Identity updates and helper revocation contend on the same authority rows without a `Series → Chapter` / `Chapter → Series` inversion. If revocation or reassignment commits first, the stale operation returns `403`. If the mutation acquires the authority locks and commits first, it is valid and revocation applies to later operations. Lifecycle races return `409`.

A verified B2 object whose finalization is denied remains temporary. It must not be marked uploaded to preserve it. The user can abort only through a claim authorized with current authority; after that claim, provider deletion is internal cleanup. The stale-upload sweep and bucket lifecycle cleanup run with system authority and remain available after the original user's authority is revoked.

`abort` and the stale-upload sweep remove incomplete objects. `UPLOAD_PENDING_TTL_SECONDS` defaults to 86400 seconds. Backblaze should additionally have a lifecycle rule for the temporary `uploads/` prefix as defense in depth.

## Credentials

`B2_KEY_ID` and `B2_APPLICATION_KEY` are server-only. They must never use a `NEXT_PUBLIC_` prefix or be returned by an API response. The browser receives only an expiring signed URL scoped to the generated object key.

Development defaults to `STORAGE_PROVIDER=filesystem`, where direct transfer grants are intentionally unavailable. To run the localhost browser flow against B2, set `STORAGE_PROVIDER=b2` plus the server-only B2 variables. Production rejects `filesystem` and fails closed unless the complete B2 configuration is valid.

## Backblaze bucket CORS

Fastify CORS and bucket CORS are separate controls. Normal browser API calls remain same-origin through `/api/*`; the B2 bucket needs CORS only because the browser sends the ZIP to the B2 origin.

Configure the S3-compatible bucket with the exact deployed application origins. Replace the production placeholder before applying:

```json
{
  "CORSRules": [
    {
      "AllowedOrigins": [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "https://<nodeprox-app-domain>"
      ],
      "AllowedMethods": ["PUT"],
      "AllowedHeaders": ["content-type"],
      "ExposeHeaders": ["ETag"],
      "MaxAgeSeconds": 3600
    }
  ]
}
```

Do not use `*` for production origins. The application origin belongs in `AllowedOrigins`; the Cloudflare media/CDN origin does not, unless it actually hosts the browser application.

Verify the effective S3-compatible bucket CORS after deployment. A successful server-side smoke test does not prove browser CORS, because CORS is enforced by browsers.

## Cloudflare

Cloudflare CDN is the public read path for processed media. Direct upload grants must point to the Backblaze S3-compatible HTTPS endpoint. Do not proxy, cache or rewrite signed upload `PUT` requests through the media CDN. Temporary `uploads/` objects must not be publicly exposed.

### Public media path resolution

The canonical client URL is
`https://media.nodeprox.org/{seriesPublicSlug}/{chapterPublicKey}/{filename}`.
The exact B2 object identity is
`Media/{seriesPublicSlug}/{chapterPublicKey}/{filename}`. `seriesPublicSlug`
uses the immutable unique `Series.slug`; `chapterPublicKey` is initialized from
the Chapter number and remains stable if that number is later edited.

Cloudflare routes the canonical path directly to the B2 object by prefixing the
bucket file path. For bucket `nodeprox`, the origin request path is:

`/file/nodeprox/Media/{seriesPublicSlug}/{chapterPublicKey}/{filename}`

The NodeProx API is not a resolver or image proxy. Never expose or rewrite
temporary `uploads/*` objects through the public media route. Existing UUID-key
objects are disposable development data and are not copied or migrated.

## Operational smoke test

With production B2 variables configured, run:

```bash
pnpm storage:smoke:b2
```

The smoke creates random temporary keys, verifies the internal streaming adapter, then exercises grant → direct PUT → HEAD → abort. It sanitizes diagnostics and removes temporary objects.

## Closing the legacy positive-size constraint

Migration `0010_system-upload-transfer` installs `uploads_size_positive` as `NOT VALID`. PostgreSQL still rejects every new or updated row with `size_bytes <= 0`; only pre-existing rows remain unvalidated during the deployment transition.

Diagnose legacy rows without mutating them:

```sql
SELECT
  id,
  chapter_id,
  status,
  storage_key,
  original_filename,
  content_type,
  size_bytes,
  created_at,
  updated_at
FROM uploads
WHERE size_bytes <= 0
ORDER BY created_at, id;
```

Reconcile each result against the server-owned `storage_key` using an authenticated provider `HEAD` operation:

- `pending` legacy row: if the object exists and its real size is positive, update the stored size through a controlled maintenance operation. If it does not exist, mark it for the existing abort/cleanup lifecycle. Do not delete it automatically.
- `uploaded` legacy row: do not delete it. Recover size, Content-Type and ETag/checksum where available. If the object is missing or ambiguous, quarantine it for manual reconciliation before processing.
- Any other legacy status must be reviewed as lifecycle drift before changing data.

After the diagnostic returns no rows, close the transition explicitly:

```sql
ALTER TABLE uploads
VALIDATE CONSTRAINT uploads_size_positive;
```

Validation must run as a separate controlled maintenance step after backup and reconciliation evidence. It is not safe to infer a size or erase potentially valid legacy data.

## Readiness gates

- **CODE:** ready when convergence checks pass.
- **LOCAL BROWSER OPERATIONAL:** blocked until the exact localhost origins are applied to B2 bucket CORS and a browser smoke passes.
- **PRODUCTION OPERATIONAL:** blocked until the real production application origin is known, configured in B2 CORS and verified in a browser smoke.

`https://<nodeprox-app-domain>` is an explicit placeholder and must never be applied as an origin.
