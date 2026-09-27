# Chapter lifecycle

The executable source of truth is [chapter-state.ts](../../packages/types/src/chapter-state.ts). It contains one shared, pure transition policy used by API and Worker; [atomic persistence](../../database/chapter-state-transition.ts) applies the decision against current state. This document describes that policy, not a second state machine.

| Current state | Event | Next state |
| --- | --- | --- |
| `draft` | `start-upload` | `uploading` |
| `failed` | `start-upload` | `uploading` |
| `uploading` | `complete-upload` | `uploaded` |
| `uploading` | `abort-upload` | `draft` |
| `uploaded` | `start-processing` | `processing` |
| `failed` | `retry-processing` | `processing` |
| `processing` | `processing-retry` | `uploaded` |
| `processing` | `processing-failed` | `failed` |
| `processing` | `processing-succeeded` | `ready` |
| `draft`, `uploading`, `uploaded`, `ready`, `failed` | `request-deletion` | `deleting` |

The complete Chapter state set is `draft`, `uploading`, `uploaded`, `processing`, `ready`, `failed`, and `deleting`. Unlisted state/event pairs are denied with `invalid-chapter-transition`. In particular, `processing → deleting` is not permitted by the current state machine; a deletion request during processing does not create a deletion outbox entry. `deleting` has no outgoing transition in this policy.

Chapter state records publication lifecycle, not every storage or queue status. Processing attempts and outboxes have their own persisted statuses; see [async integrity](ASYNC_INTEGRITY.md). A completed publication is not reversed merely because later source-ZIP cleanup fails.
