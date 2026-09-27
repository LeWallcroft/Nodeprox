# Authorization

The API is the security authority. [Global RBAC capabilities](../../apps/api/src/modules/authorization/domain/permissions.ts) and contextual domain policies are separate checks; client-supplied roles or capabilities cannot grant access. The roles are `admin`, `gestor`, and `uploader`.

## Series

`admin` can administer Series globally and delete a Series when its business invariants permit. `gestor` can read and edit Series globally and manage responsibility/assignment regardless of historical ownership, but cannot delete Series—even one it created or manages. `uploader` retains assignment-scoped operational access; helper or ownership context does not confer Series deletion.

The decisive deletion rule is [canDeleteSeries](../../apps/api/src/modules/series/domain/series.policy.ts), which permits only `admin`. Edit and assignment use distinct policies in that file. The [Series service](../../apps/api/src/modules/series/application/services/series.service.ts) and its persistence boundary combine the relevant global capability with the operation-specific policy. The permission catalog alone does not determine contextual authority.

## Chapters and helpers

[Chapter contextual authorization](../../apps/api/src/modules/chapters/domain/chapter-permission.policy.ts) evaluates role, Series assignment, and delegated helper permission. `admin` and `gestor` have global operational Chapter authority; an assigned `uploader` has contextual authority, while a delegated helper receives only the permissions explicitly granted. Helper permission by itself never grants helper administration.

For `chapters.helper.grant` and `chapters.helper.revoke`, the same domain policy permits `admin` and `gestor` globally and `uploader` only when assigned to the Series. [ChapterPermissionService](../../apps/api/src/modules/chapters/application/services/chapter-permission.service.ts) uses that policy for checks and capability projection; [repository enforcement](../../apps/api/src/modules/chapters/infrastructure/persistence/drizzle/chapter.repository.ts) revalidates sensitive mutations inside a transaction. Delegable permissions and the grant/revoke cooldown are defined by the Chapter policy and service; invalid targets and active cooldowns are not bypassed by a projected capability.

## Denial versus technical failure

An ordinary policy denial is distinct from an unavailable authorization dependency. [AuthorizationResult](../../apps/api/src/modules/authorization/application/authorization-result.ts) and [Chapter authorization results](../../apps/api/src/modules/chapters/application/chapter-authorization-result.ts) classify technical failures with internal failure codes. Technical failures fail closed: they cannot become a grant through fallback. Sanitized diagnostics are reported internally; the technical `failureCode` is not exposed as a public Problem Details code. Existing public HTTP status and Problem Details contracts remain the presentation boundary.
