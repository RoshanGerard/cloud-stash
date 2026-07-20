"use client";

// add-leftover-download-cleanup §6.3/§6.4 (design.md ## Visual direction,
// VD2–VD5) — the "Review leftover files" dialog. Opened from the Settings →
// Downloads button, it surfaces orphaned KEPT partial files from past download
// failures and lets the user delete them per-row or in bulk.
//
// Data flow: on open it fetches its OWN fresh list via `downloads:list-leftover`
// (freshness after a prior session's deletions). Per-row Delete and bulk
// "Delete all" BOTH reuse `downloads:delete-partial { downloadJobId }`
// UNCHANGED (Phase 1 primitive) — there is no server-side bulk command; bulk is
// a client loop. Deleting a file unlinks it and leaves the `downloads` row, so
// the next `list-leftover` read excludes it (its file is gone).
//
// Mirrors `ClearHistoryDialog`: Dialog → DialogContent (focus restored to the
// opening button via onCloseAutoFocus + returnFocusTo) → DialogHeader → body →
// DialogFooter. No bespoke motion — only the Radix Dialog primitive transitions
// (motion budget). `rounded-lg` on the list container is permitted because this
// file's basename contains "dialog" (radii-ceiling guardrail).

import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { toast } from "sonner";

import type { LeftoverEntry } from "@cloudstash/ipc-contracts/sync-service-desktop";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Icon } from "@/components/icon";

import { formatSize } from "../file-explorer/view-modes/details-format";

export interface LeftoverFilesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Element to restore focus to when the dialog closes (the opening button). */
  returnFocusTo?: HTMLElement | null;
}

// The `window.api.sync.*` methods this dialog needs, accessed defensively.
// Optional-CALL (`?.()`) not just optional-chain: in unit tests `window.api.sync`
// may exist while a specific method is absent, and `sync?.method()` on an
// undefined `method` throws a TypeError. `?.()` short-circuits instead.
type LeftoverSyncApi = {
  listLeftover?: () => Promise<{ readonly entries: readonly LeftoverEntry[] }>;
  deletePartial?: (req: { downloadJobId: string }) => Promise<{ readonly deleted: boolean }>;
};

function syncApi(): LeftoverSyncApi | undefined {
  return (window as unknown as { api?: { sync?: LeftoverSyncApi } }).api?.sync;
}

// Basename of an on-disk save path. `targetPath` is an OS path, so split on
// BOTH separators (POSIX `/` and Windows `\`).
function basename(p: string): string {
  const parts = p.split(/[/\\]/);
  return parts[parts.length - 1] || p;
}

// Small local relative-time helper — the only existing one (`formatLastSync` in
// features/datasources/card.tsx) is private and unexported, so this is added
// locally per the task's "add a small local helper if none exists". Full words
// ("3 days ago") match the visual direction's example.
function formatRelative(endedAt: number): string {
  const deltaMs = Math.max(0, Date.now() - endedAt);
  const sec = Math.floor(deltaMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
  const mo = Math.floor(day / 30);
  if (mo < 12) return `${mo} month${mo === 1 ? "" : "s"} ago`;
  const yr = Math.floor(day / 365);
  return `${yr} year${yr === 1 ? "" : "s"} ago`;
}

// Second-line "failure reason · date" text. Reason prefers the stored
// `failureMessage`, falls back to a humanized `failureTag`, else a generic
// label; the date is a relative time from `endedAt` (omitted when null).
function reasonLine(e: LeftoverEntry): string {
  const reason =
    e.failureMessage ??
    (e.failureTag !== null ? e.failureTag.replace(/-/g, " ") : null) ??
    "Download failed";
  const when = e.endedAt !== null ? formatRelative(e.endedAt) : null;
  return when !== null ? `${reason} · ${when}` : reason;
}

export function LeftoverFilesDialog({
  open,
  onOpenChange,
  returnFocusTo,
}: LeftoverFilesDialogProps): JSX.Element {
  const [entries, setEntries] = useState<readonly LeftoverEntry[]>([]);
  const [rowErrors, setRowErrors] = useState<Record<string, string>>({});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const deleteAllRef = useRef<HTMLButtonElement>(null);

  // Fetch a fresh list each time the dialog opens (freshness after prior
  // deletions). Guard the absent bridge / absent method → empty list.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setRowErrors({});
    setConfirmOpen(false);
    setBulkBusy(false);
    void Promise.resolve(syncApi()?.listLeftover?.())
      .then((res) => {
        if (!cancelled) setEntries(res?.entries ?? []);
      })
      // A transport-level failure degrades to the empty state rather than an
      // unhandled rejection; the user can close and reopen to retry.
      .catch(() => {
        if (!cancelled) setEntries([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleDelete = useCallback(async (downloadJobId: string) => {
    try {
      await syncApi()?.deletePartial?.({ downloadJobId });
      // Success: drop the row and clear any prior inline error for it.
      setEntries((prev) => prev.filter((e) => e.downloadJobId !== downloadJobId));
      setRowErrors((prev) => {
        if (!(downloadJobId in prev)) return prev;
        const next = { ...prev };
        delete next[downloadJobId];
        return next;
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : "unknown error";
      setRowErrors((prev) => ({ ...prev, [downloadJobId]: reason }));
    }
  }, []);

  const handleBulkDelete = useCallback(async () => {
    setBulkBusy(true);
    const ids = entries.map((e) => e.downloadJobId);
    let deleted = 0;
    const failed: Record<string, string> = {};
    // Sequential loop over the reused single primitive — one EACCES must not
    // abort the rest, and each result is tracked per file.
    for (const id of ids) {
      try {
        await syncApi()?.deletePartial?.({ downloadJobId: id });
        deleted += 1;
      } catch (err) {
        failed[id] = err instanceof Error ? err.message : "unknown error";
      }
    }
    const failedIds = new Set(Object.keys(failed));
    setEntries((prev) => prev.filter((e) => failedIds.has(e.downloadJobId)));
    setRowErrors(failed);
    setBulkBusy(false);
    setConfirmOpen(false);
    // Aggregate report — NEVER "all cleared" when any failed (VD5).
    if (failedIds.size === 0) {
      toast.success(`Deleted ${deleted} ${deleted === 1 ? "file" : "files"}`);
    } else {
      toast.error(`Deleted ${deleted} · ${failedIds.size} couldn't be removed`);
    }
  }, [entries]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent
          onCloseAutoFocus={(event) => {
            if (returnFocusTo && returnFocusTo.isConnected) {
              event.preventDefault();
              returnFocusTo.focus();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Leftover download files</DialogTitle>
            <DialogDescription>
              Incomplete files left on disk by past failed downloads. Deleting one removes it from
              your computer.
            </DialogDescription>
          </DialogHeader>

          {entries.length === 0 ? (
            <p className="text-muted-foreground py-6 text-center text-sm">
              You&rsquo;re all cleaned up &mdash; no leftover files.
            </p>
          ) : (
            <div
              role="list"
              className="border-border/60 divide-border/60 flex max-h-80 flex-col divide-y overflow-y-auto rounded-lg border"
            >
              {entries.map((e) => {
                const name = basename(e.targetPath);
                const rowError = rowErrors[e.downloadJobId];
                return (
                  <div key={e.downloadJobId} role="listitem" className="flex flex-col gap-1 p-3">
                    <div className="flex items-center gap-2">
                      <Icon
                        name="file"
                        className="text-muted-foreground size-4 shrink-0"
                        aria-hidden="true"
                      />
                      <span
                        className="min-w-0 flex-1 truncate text-sm font-medium"
                        title={e.targetPath}
                      >
                        {name}
                      </span>
                      <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                        {formatSize(e.sizeOnDisk)}
                      </span>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="text-destructive shrink-0"
                        onClick={() => void handleDelete(e.downloadJobId)}
                      >
                        <Icon name="trash-2" aria-hidden="true" />
                        Delete
                      </Button>
                    </div>
                    <p className="text-muted-foreground pl-6 text-xs">{reasonLine(e)}</p>
                    {rowError !== undefined && (
                      <p role="alert" className="text-destructive pl-6 text-xs">
                        Couldn&rsquo;t delete: {rowError}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          <DialogFooter className="sm:justify-between">
            <Button
              ref={deleteAllRef}
              type="button"
              variant="outline"
              size="sm"
              className="text-destructive"
              disabled={entries.length === 0 || bulkBusy}
              onClick={() => setConfirmOpen(true)}
            >
              Delete all
            </Button>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Nested destructive confirm (VD4) — the existing Dialog primitive, NOT
          an AlertDialog (the renderer has none). Radix supplies the focus trap +
          Escape; focus restores to the "Delete all" trigger on close. */}
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent
          onCloseAutoFocus={(event) => {
            const target = deleteAllRef.current;
            if (target && target.isConnected) {
              event.preventDefault();
              target.focus();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>Delete all {entries.length} leftover files?</DialogTitle>
            <DialogDescription>
              These incomplete files will be removed from your computer. This can&rsquo;t be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={bulkBusy}
              onClick={() => void handleBulkDelete()}
            >
              Delete {entries.length} files
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
