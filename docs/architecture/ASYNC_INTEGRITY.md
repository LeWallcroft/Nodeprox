# Async integrity and correlation

NodeProx coordinates asynchronous media work without distributed two-phase commit (2PC). The pattern is a PostgreSQL transaction that records a durable intent, dispatch to Redis/BullMQ, an idempotent Worker, storage side effects and a durable DB result, followed by bounded reconciliation when state diverges. Queue acceptance is not proof that processing completed.

| Durable intent | Purpose |
| --- | --- |
| [processing_outbox](../../database/schema/processing-outbox.ts) | Chapter ZIP processing |
| [chapter_deletion_outbox](../../database/schema/chapter-deletion-outbox.ts) | Chapter storage deletion |
| [chapter_replacement_processing_outbox](../../database/schema/chapter-replacement-processing-outbox.ts) | Whole-Chapter replacement processing |
| [storage_cleanup_outbox](../../database/schema/storage-cleanup-outbox.ts) | Replacement source/candidate cleanup |

The [API runtime](../../apps/api/src/composition/create-api-runtime.ts) owns processing outbox dispatch. The [Worker runtime](../../apps/worker/src/composition/create-worker-runtime.ts) receives queue jobs and runs processing, deletion, replacement, and cleanup components. For queue-dispatch outboxes, `pending` means durable intent awaiting successful enqueue; `enqueued` means the queue accepted a job, not that the job finished. Stable job identities and idempotent consumers support redelivery without creating a second logical publication.

Cleanup and [integrity reconciliation](../../apps/api/src/modules/reconciliation/application/integrity-reconciliation.service.ts) use durable retries and safety checks. Uncertain ownership or missing published media is reported for manual review rather than triggering unsafe deletion. Candidate cleanup must not erase previously published media. Reconciliation can identify missing jobs, stale attempts, orphan candidates, source ZIPs, and stalled cleanup intents. The repo-local `pnpm integrity:reconcile` command is [dry-run by default](../../scripts/reconcile-integrity.ts); `--repair` is an explicit mutation choice and requires an approved, scoped operational run. This is not a production-container command or a bucket purge tool.

## Correlation contract

- `requestId`: the current HTTP request.
- `originRequestId`: the HTTP request that created a durable asynchronous intent.
- `jobId`: stable BullMQ job identity, distinct from either request ID.
- Domain IDs (`chapterId`, `uploadId`, `replacementId`, outbox/cleanup IDs): resource and work identities.

The originating request ID is persisted when an async intent becomes durable, propagated through queue payloads, Worker logs and supported cleanup effects, and exposed in reconciliation findings when resolvable. For replacement processing, the origin is the upload **completion** request, not the earlier preparation request. Requeue retains the original origin. Historical rows with NULL origin and system-initiated work may have no `originRequestId`; NodeProx does not manufacture synthetic correlation IDs. These fields aid log correlation but do not constitute a complete distributed tracing platform.
