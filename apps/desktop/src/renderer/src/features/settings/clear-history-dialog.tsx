"use client";

// add-download-history-ui §7 — the "Clear download history" confirm dialog
// (design.md ## Visual direction, Approach A). The user picks a filter
// (status chips + "Older than" window) before confirming a destructive clear;
// the copy states explicitly that on-disk files are NOT deleted. On confirm it
// dispatches `downloads:clear-history` with the chosen `{ status?, olderThanMs? }`
// and reports the returned `{ deleted }` via a Sonner toast.
//
// No live pre-count (Decision 5 emits no count command). No bespoke motion —
// only the Radix Dialog/DropdownMenu primitive transitions (motion budget).

import { useCallback, useEffect, useState, type JSX } from "react";
import { toast } from "sonner";

import type {
  DownloadTerminalStatus,
  SyncClearDownloadHistoryRequest,
} from "@ft5/ipc-contracts/sync-service-desktop";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Icon } from "@/components/icon";

const DAY_MS = 86_400_000;

const STATUS_OPTIONS: ReadonlyArray<{
  value: DownloadTerminalStatus;
  label: string;
}> = [
  { value: "completed", label: "Completed" },
  { value: "failed", label: "Failed" },
  { value: "cancelled", label: "Cancelled" },
  { value: "interrupted", label: "Interrupted" },
];

const AGE_OPTIONS: ReadonlyArray<{
  value: string;
  label: string;
  ms: number | null;
}> = [
  { value: "any", label: "Any time", ms: null },
  { value: "30", label: "30 days", ms: 30 * DAY_MS },
  { value: "90", label: "90 days", ms: 90 * DAY_MS },
  { value: "180", label: "180 days", ms: 180 * DAY_MS },
  { value: "365", label: "365 days", ms: 365 * DAY_MS },
];

const ALL_STATUSES: ReadonlyArray<DownloadTerminalStatus> = STATUS_OPTIONS.map(
  (o) => o.value,
);

export interface ClearHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusTo?: HTMLElement | null;
}

export function ClearHistoryDialog({
  open,
  onOpenChange,
  returnFocusTo,
}: ClearHistoryDialogProps): JSX.Element {
  const [selected, setSelected] =
    useState<ReadonlyArray<DownloadTerminalStatus>>(ALL_STATUSES);
  const [age, setAge] = useState<string>("any");
  const [busy, setBusy] = useState(false);

  // Reset to the defaults (all statuses, any time) each time the dialog opens
  // so a prior partial selection never leaks into the next clear.
  useEffect(() => {
    if (open) {
      setSelected(ALL_STATUSES);
      setAge("any");
      setBusy(false);
    }
  }, [open]);

  const toggleStatus = useCallback((value: DownloadTerminalStatus) => {
    setSelected((prev) =>
      prev.includes(value) ? prev.filter((s) => s !== value) : [...prev, value],
    );
  }, []);

  const noneSelected = selected.length === 0;
  const allSelected = selected.length === STATUS_OPTIONS.length;

  const handleClear = useCallback(async () => {
    if (noneSelected) return;

    const ageOpt = AGE_OPTIONS.find((o) => o.value === age);
    const filter: {
      status?: ReadonlyArray<DownloadTerminalStatus>;
      olderThanMs?: number;
    } = {};
    // Omit `status` when all four are selected so the wire sends the
    // "all terminal" form; omit `olderThanMs` for "Any time".
    if (!allSelected) {
      filter.status = selected;
    }
    if (ageOpt?.ms != null) {
      filter.olderThanMs = ageOpt.ms;
    }
    const req: SyncClearDownloadHistoryRequest =
      Object.keys(filter).length > 0 ? { filter } : {};

    setBusy(true);
    try {
      const res = await window.api?.sync?.clearDownloadHistory(req);
      const deleted = res?.deleted ?? 0;
      if (deleted > 0) {
        toast.success(
          `Cleared ${deleted} download ${deleted === 1 ? "record" : "records"}`,
        );
      } else {
        toast("No matching records to clear");
      }
      onOpenChange(false);
    } catch {
      toast.error("Couldn't clear download history");
    } finally {
      setBusy(false);
    }
  }, [age, allSelected, noneSelected, selected, onOpenChange]);

  return (
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
          <DialogTitle>Clear download history</DialogTitle>
          <DialogDescription>Choose which records to remove.</DialogDescription>
        </DialogHeader>

        {/* STATUS toggle chips — all selected by default (= clear everything). */}
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-xs font-medium uppercase tracking-wider">
            Status
          </p>
          <div
            className="flex flex-wrap gap-2"
            role="group"
            aria-label="Status to clear"
          >
            {STATUS_OPTIONS.map((o) => {
              const isOn = selected.includes(o.value);
              return (
                <Button
                  key={o.value}
                  type="button"
                  size="sm"
                  variant={isOn ? "default" : "outline"}
                  aria-pressed={isOn}
                  onClick={() => toggleStatus(o.value)}
                >
                  {o.label}
                </Button>
              );
            })}
          </div>
        </div>

        {/* OLDER THAN age window — default "Any time" (no age bound). */}
        <div className="flex items-center gap-3">
          <p className="text-muted-foreground min-w-0 flex-1 text-xs font-medium uppercase tracking-wider">
            Older than
          </p>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label="Older than"
                className="shrink-0"
              >
                <span className="tabular-nums">
                  {AGE_OPTIONS.find((o) => o.value === age)?.label ?? "Any time"}
                </span>
                <Icon
                  name="chevron-down"
                  className="size-3"
                  aria-hidden="true"
                />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel className="text-muted-foreground text-xs uppercase tracking-wider">
                Older than
              </DropdownMenuLabel>
              <DropdownMenuRadioGroup value={age} onValueChange={setAge}>
                {AGE_OPTIONS.map((o) => (
                  <DropdownMenuRadioItem key={o.value} value={o.value}>
                    {o.label}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Safety note — the load-bearing reassurance (Visual direction). */}
        <p className="text-muted-foreground bg-muted/50 rounded-md p-3 text-xs">
          Files already saved to your computer are <strong>not</strong> deleted
          — this only removes the history records.
        </p>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={noneSelected || busy}
            onClick={() => void handleClear()}
          >
            Clear records
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
