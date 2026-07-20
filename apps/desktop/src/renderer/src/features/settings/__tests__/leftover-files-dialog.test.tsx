/** @vitest-environment jsdom */
//
// add-leftover-download-cleanup §6.3/§6.4/§6.6 — LeftoverFilesDialog.
//
// The Settings → "Review leftover files" surface: on open it fetches its own
// fresh list via `downloads:list-leftover`, lists each orphaned partial with a
// per-row Delete, and a bulk "Delete all" behind a nested destructive confirm.
// Per-row + bulk delete both reuse `downloads:delete-partial { downloadJobId }`
// UNCHANGED. The bulk aggregate distinguishes deleted vs failed — one EACCES is
// never reported as "all cleared".

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: Object.assign((..._args: unknown[]) => {}, {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  }),
}));

import { LeftoverFilesDialog } from "../leftover-files-dialog";
import type { LeftoverEntry } from "@cloudstash/ipc-contracts/sync-service-desktop";

let listLeftoverMock: Mock;
let deletePartialMock: Mock;

function entry(over: Partial<LeftoverEntry> & { downloadJobId: string }): LeftoverEntry {
  return {
    datasourceId: "ds-1",
    sourcePath: "/remote/file.bin",
    targetPath: `/Users/alice/Downloads/${over.downloadJobId}.bin`,
    sizeOnDisk: 12_400_000,
    failureTag: "exhausted-retries",
    failureMessage: "ran out of retries",
    endedAt: Date.now() - 3 * 86_400_000,
    ...over,
  };
}

function installApi(entries: LeftoverEntry[]): void {
  listLeftoverMock = vi.fn().mockResolvedValue({ entries });
  deletePartialMock = vi.fn().mockResolvedValue({ deleted: true });
  (window as unknown as { api: unknown }).api = {
    sync: {
      listLeftover: listLeftoverMock,
      deletePartial: deletePartialMock,
    },
  };
}

beforeEach(() => {
  if (!("ResizeObserver" in window)) {
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete (window as unknown as { api?: unknown }).api;
});

describe("LeftoverFilesDialog", () => {
  it("renders the title, description, and one listitem per entry (name + size + reason)", async () => {
    installApi([
      entry({ downloadJobId: "report", failureMessage: "ran out of retries" }),
      entry({ downloadJobId: "photo", failureMessage: "network dropped" }),
    ]);

    render(<LeftoverFilesDialog open onOpenChange={() => {}} />);

    expect(
      await screen.findByRole("heading", { name: /leftover download files/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/incomplete files left on disk/i)).toBeInTheDocument();

    const items = await screen.findAllByRole("listitem");
    expect(items).toHaveLength(2);
    // File names (basename of targetPath).
    expect(screen.getByText("report.bin")).toBeInTheDocument();
    expect(screen.getByText("photo.bin")).toBeInTheDocument();
    // Failure reason lines.
    expect(screen.getByText(/ran out of retries/i)).toBeInTheDocument();
    expect(screen.getByText(/network dropped/i)).toBeInTheDocument();
    // On-disk size rendered via the shared formatSize (binary units → MB).
    expect(screen.getAllByText(/\bMB\b/).length).toBeGreaterThan(0);
  });

  it("shows the empty state when the fetched list is empty", async () => {
    installApi([]);
    render(<LeftoverFilesDialog open onOpenChange={() => {}} />);

    // Apostrophe-agnostic: the copy renders a typographic ’ (U+2019).
    expect(await screen.findByText(/all cleaned up/i)).toBeInTheDocument();
    expect(screen.queryAllByRole("listitem")).toHaveLength(0);
  });

  it("per-row Delete dispatches delete-partial and removes the row on success", async () => {
    installApi([entry({ downloadJobId: "report" }), entry({ downloadJobId: "photo" })]);
    render(<LeftoverFilesDialog open onOpenChange={() => {}} />);

    const items = await screen.findAllByRole("listitem");
    const reportRow = items.find((el) => within(el).queryByText("report.bin"))!;
    fireEvent.click(within(reportRow).getByRole("button", { name: "Delete" }));

    await waitFor(() =>
      expect(deletePartialMock).toHaveBeenCalledWith({ downloadJobId: "report" }),
    );
    await waitFor(() => expect(screen.queryByText("report.bin")).not.toBeInTheDocument());
    // Sibling row survives.
    expect(screen.getByText("photo.bin")).toBeInTheDocument();
  });

  it("per-row Delete failure keeps the row with an inline error", async () => {
    installApi([entry({ downloadJobId: "report" })]);
    deletePartialMock.mockRejectedValueOnce(new Error("EACCES: permission denied"));
    render(<LeftoverFilesDialog open onOpenChange={() => {}} />);

    const items = await screen.findAllByRole("listitem");
    fireEvent.click(within(items[0]!).getByRole("button", { name: "Delete" }));

    expect(await screen.findByText(/couldn.t delete:.*EACCES/i)).toBeInTheDocument();
    // Row still present; Delete button remains to re-attempt.
    expect(screen.getByText("report.bin")).toBeInTheDocument();
    expect(
      within(screen.getByRole("listitem")).getByRole("button", {
        name: "Delete",
      }),
    ).toBeInTheDocument();
  });

  it("bulk Delete all confirms, then reports a deleted-vs-failed aggregate (one EACCES ≠ all cleared)", async () => {
    installApi([entry({ downloadJobId: "ok-1" }), entry({ downloadJobId: "bad-2" })]);
    // ok-1 resolves; bad-2 rejects.
    deletePartialMock.mockImplementation((req: { downloadJobId: string }) =>
      req.downloadJobId === "bad-2"
        ? Promise.reject(new Error("EACCES: permission denied"))
        : Promise.resolve({ deleted: true }),
    );
    render(<LeftoverFilesDialog open onOpenChange={() => {}} />);

    await screen.findAllByRole("listitem");
    fireEvent.click(screen.getByRole("button", { name: "Delete all" }));

    // Nested confirm names the count.
    expect(
      await screen.findByRole("heading", {
        name: /delete all 2 leftover files\?/i,
      }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /delete 2 files/i }));

    await waitFor(() => expect(deletePartialMock).toHaveBeenCalledTimes(2));
    // Aggregate toast distinguishes deleted vs failed — never "all cleared".
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("Deleted 1 · 1 couldn't be removed"),
    );
    // Succeeded row vanished; failed row stays with its inline error.
    await waitFor(() => expect(screen.queryByText("ok-1.bin")).not.toBeInTheDocument());
    expect(screen.getByText("bad-2.bin")).toBeInTheDocument();
    expect(screen.getByText(/couldn.t delete:.*EACCES/i)).toBeInTheDocument();
  });

  it("bulk Delete all full success toasts the count and shows the empty state", async () => {
    installApi([entry({ downloadJobId: "a" }), entry({ downloadJobId: "b" })]);
    render(<LeftoverFilesDialog open onOpenChange={() => {}} />);

    await screen.findAllByRole("listitem");
    fireEvent.click(screen.getByRole("button", { name: "Delete all" }));
    fireEvent.click(await screen.findByRole("button", { name: /delete 2 files/i }));

    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Deleted 2 files"));
    expect(await screen.findByText(/all cleaned up/i)).toBeInTheDocument();
  });

  it("restores focus to the 'Delete all' trigger when the nested confirm closes", async () => {
    installApi([entry({ downloadJobId: "report" })]);
    render(<LeftoverFilesDialog open onOpenChange={() => {}} />);

    await screen.findAllByRole("listitem");
    const deleteAll = screen.getByRole("button", { name: "Delete all" });
    fireEvent.click(deleteAll);

    const cancel = await screen.findByRole("button", { name: /cancel/i });
    fireEvent.click(cancel);

    await waitFor(() => expect(document.activeElement).toBe(deleteAll));
  });
});
