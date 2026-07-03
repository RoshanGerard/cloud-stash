# Design limitations

Project-level home for **vendor-quirk notes** — places where the product's
behavior is shaped by an external provider's constraints rather than by a
first-party requirement. These are intentionally NOT spec requirements; they
exist so a future maintainer doesn't mistake a vendor quirk for a bug.

Established by `add-engine-listdirectory-pagination` (2026-06).

## Pagination & listing

### S3 has no native `orderBy` — sort is client-side over loaded pages

Amazon S3's `ListObjectsV2` returns keys in lexicographic order with no
server-side sort option. The file-explorer therefore sorts S3 listings
client-side over the pages already loaded. Re-sorting after a "Load more"
sorts only what is loaded; loading the next page appends in provider
(lexicographic) order and the client re-sorts the combined set. This
non-uniformity — Drive/OneDrive sort server-side, S3 sorts client-side over
loaded pages — is inherent to the S3 API surface. Buffering all pages
client-side to enable a global sort would defeat the purpose of pagination.

### Drive / OneDrive sort server-side — a re-sort discards loaded pages

Google Drive (`orderBy: "folder,name"`) and OneDrive (`$orderby`) sort
server-side. A user-driven re-sort resets to page 1 with the new sort key;
pages 2..N already loaded are discarded, because the provider returns a
freshly-sorted first page and the continuation cursor is sort-specific.

### OneDrive's `@odata.nextLink` is a fully-qualified URL, not a token

Where Drive's `pageToken` and S3's `ContinuationToken` are opaque tokens,
OneDrive's continuation cursor is a complete Microsoft Graph URL
(`https://graph.microsoft.com/v1.0/...`). The OneDrive strategy validates
that a cursor starts with `https://graph.microsoft.com/v1.0/` **before**
re-issuing it (defending against a malformed or injected cursor) and, on
mismatch, throws `DatasourceError { tag: "provider-error" }` with **no
network call**. The engine has no `"other"` tag — that is wire-level only;
fs-sync's `normalizeFilesError` collapses engine `provider-error` to the
wire `"other"` tag the renderer surfaces.

### Page-size choices above a provider cap over-resolve to multiple pages

The page-size setting offers 100 / 500 / 1000 / 5000 / 10000, but each
provider caps a single call: Drive 1000, OneDrive 999 (`$top`), S3 1000
(`MaxKeys`). Asking for `pageSize: 5000` issues ONE capped provider call and
returns a non-null `nextCursor` for the remainder — so from the renderer's
perspective one logical "page" of 5000 resolves as several "Load more"
clicks. Auto-loop-to-target is a possible future enhancement if this surfaces
as a usability issue.

### Stale cursors across long-lived sessions

Cursors are stateless and per-list-call — the engine forwards them to the
provider unchanged and they are discarded when the explorer's path changes.
A provider may reject a cursor that has gone stale (e.g. the explorer was
left open for days). The failure surfaces as a normal page-load-failed row;
the user's recovery is to navigate away and back, which discards the cursor
and re-lists from page 1. No server-side cursor TTL/tracking is maintained
(rejected as over-engineering for a rare, already-degenerate path).

### Auto-retry is a fs-sync-side policy layered outside the engine's auth refresh

The `files:list` auto-retry (4 attempts / ~14s at 2s/5s/7s back-offs, on
`network-error` / `rate-limited` / `provider-error` failures that are
`retryable`) is a fs-sync-side decision, layered as the **outer** ring around
fs-sync's `withAuthRefresh` auth-refresh wrap (per
`migrate-engine-retry-policy-to-consumer`: the engine no longer
auto-refreshes; auth refresh is the one-shot inner ring, environmental retry
the outer ring). A non-retryable failure (`retryable: false`) — including
OneDrive's deterministic malformed-cursor `provider-error` — surfaces
immediately without consuming the retry budget.

## Auth & scopes

### OneDrive has no insufficient-scope recovery (Drive-only, deliberately not mirrored)

`fix-insufficient-auth-scopes-recovery` (2026-06) added, **for Google Drive
only**, a runtime recovery for a too-narrow OAuth grant: the Drive strategy
reclassifies a 403 `insufficientPermissions` / `ACCESS_TOKEN_SCOPE_INSUFFICIENT`
to `auth-revoked` + `raw.kind: "scope-insufficient"`, which threads
`FilesErrorEnvelope.authErrorKind` and routes the explorer to the reconnect view
with a "needs full-access permission" callout. The `authErrorKind` contract
field, the fs-sync `normalizeFilesError` thread, and the renderer callout are all
**provider-agnostic and already shipped** — only the engine-side *detection* is
Drive-specific.

OneDrive was investigated (2026-06) and the insufficient-scope recovery was
**deliberately NOT built**, for three reasons:

1. **No clean runtime signal.** Drive surfaces a too-narrow grant with a
   documented, unambiguous inner reason token (`insufficientPermissions`).
   Microsoft Graph does not: an insufficient delegated scope surfaces as the
   **overloaded** 403 `accessDenied` / `Authorization_RequestDenied` — the same
   codes Graph uses for SharePoint/OneDrive sharing-policy denials, admin-consent
   gaps, and wrong-audience tokens. The strategy deliberately keeps those as
   `provider-error` (`onedrive-client.ts` 403 branch). A runtime heuristic on
   `accessDenied` would **over-match a common case** (sharing-policy denials —
   which a reconnect cannot fix) to catch a rare one, routing common errors into
   a useless "reconnect" loop.
2. **Rare scenario.** Microsoft's delegated consent is largely all-or-nothing
   (no per-scope granular-consent checkboxes like Google's). The granted scope
   almost always equals the requested `Files.ReadWrite.All`; a narrow grant only
   arises from incremental-consent gaps or admin restrictions. OneDrive captures
   and validates no resource scope today (`onedrive-client.ts:157-159`), by
   design.
3. **Untestable without a real provider.** With no clean signal and no live
   OneDrive/Graph provider in the test environment, a runtime detection's tests
   would encode a *guessed* error signature rather than observed behavior.

**If a real need surfaces,** the honest mechanism is a *proactive* scope check
(mirroring Drive's `checkScopeSufficiency`): capture the granted `scope` from the
OneDrive token response (the `scp` claim is the one clean, testable signal),
validate it contains `Files.ReadWrite.All`, and throw `auth-revoked` +
`scope-insufficient` — deterministic and testable against the captured scope
string. That requires new scope-capture in OneDrive's auth exchange (it captures
none today). Until a real OneDrive narrow-grant case is observed, building
speculative detection is not worth the over-match regression risk. See
`PENDING_TC.MD` (fix-insufficient-auth-scopes-recovery follow-ups).
