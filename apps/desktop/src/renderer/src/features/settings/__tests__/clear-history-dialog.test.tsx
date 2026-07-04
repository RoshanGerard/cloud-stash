/** @vitest-environment jsdom */
//
// add-download-history-ui §7.2 — ClearHistoryDialog.
//
// The filtered destructive clear: status toggle chips (all on by default) +
// an "Older than" window; on confirm it dispatches `downloads:clear-history`
// with the chosen `{ status?, olderThanMs? }` and toasts the `{ deleted }`
// count. Copy MUST state that on-disk files are not deleted.

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
} from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const { toastSuccess, toastDefault, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastDefault: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: Object.assign(
    (...args: unknown[]) => toastDefault(...args),
    {
      success: (...args: unknown[]) => toastSuccess(...args),
      error: (...args: unknown[]) => toastError(...args),
    },
  ),
}));

import { ClearHistoryDialog } from "../clear-history-dialog";

let clearMock: Mock;

beforeEach(() => {
  if (!("ResizeObserver" in window)) {
    (window as unknown as { ResizeObserver: unknown }).ResizeObserver =
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      };
  }
  clearMock = vi.fn().mockResolvedValue({ deleted: 3 });
  (window as unknown as { api: unknown }).api = {
    sync: { clearDownloadHistory: clearMock },
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  delete (window as unknown as { api?: unknown }).api;
});

describe("ClearHistoryDialog", () => {
  it("states that saved files are kept while incomplete leftover files are removed", () => {
    // add-leftover-download-cleanup VD6 — Clear… now unlinks KEEP-eligible
    // partials, so the safety note shifted from "saved files are NOT deleted"
    // to the leftover-aware wording.
    render(<ClearHistoryDialog open onOpenChange={() => {}} />);
    // "Saved files are kept" sits in a <strong>; resolve to the enclosing
    // paragraph so both halves of the sentence are asserted together.
    const note = screen.getByText(/saved files are kept/i).closest("p")!;
    expect(note).toBeInTheDocument();
    expect(note).toHaveTextContent(/leftover files are removed/i);
  });

  it("renders all four status chips pressed by default", () => {
    render(<ClearHistoryDialog open onOpenChange={() => {}} />);
    for (const label of ["Completed", "Failed", "Cancelled", "Interrupted"]) {
      const chip = screen.getByRole("button", { name: label });
      expect(chip.getAttribute("aria-pressed")).toBe("true");
    }
  });

  it("dispatches with NO filter when all statuses are selected and 'Any time'", async () => {
    const onOpenChange = vi.fn();
    render(<ClearHistoryDialog open onOpenChange={onOpenChange} />);

    fireEvent.click(screen.getByRole("button", { name: /clear records/i }));

    await waitFor(() => expect(clearMock).toHaveBeenCalledTimes(1));
    expect(clearMock).toHaveBeenCalledWith({});
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Cleared 3 download records"),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("dispatches a status filter when some chips are deselected", async () => {
    render(<ClearHistoryDialog open onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Completed" }));
    fireEvent.click(screen.getByRole("button", { name: "Cancelled" }));
    fireEvent.click(screen.getByRole("button", { name: /clear records/i }));

    await waitFor(() => expect(clearMock).toHaveBeenCalledTimes(1));
    expect(clearMock).toHaveBeenCalledWith({
      filter: { status: ["failed", "interrupted"] },
    });
  });

  it("includes olderThanMs (status omitted) when an 'Older than' window is chosen", async () => {
    render(<ClearHistoryDialog open onOpenChange={() => {}} />);

    // Radix DropdownMenu opens on pointerDown(button:0), not click (jsdom).
    fireEvent.pointerDown(screen.getByRole("button", { name: /older than/i }), {
      button: 0,
    });
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "30 days" }));

    fireEvent.click(screen.getByRole("button", { name: /clear records/i }));

    await waitFor(() => expect(clearMock).toHaveBeenCalledTimes(1));
    expect(clearMock).toHaveBeenCalledWith({
      filter: { olderThanMs: 30 * 86_400_000 },
    });
  });

  it("combines a status filter with an age window", async () => {
    render(<ClearHistoryDialog open onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "Completed" }));
    fireEvent.pointerDown(screen.getByRole("button", { name: /older than/i }), {
      button: 0,
    });
    fireEvent.click(await screen.findByRole("menuitemradio", { name: "90 days" }));

    fireEvent.click(screen.getByRole("button", { name: /clear records/i }));

    await waitFor(() => expect(clearMock).toHaveBeenCalledTimes(1));
    expect(clearMock).toHaveBeenCalledWith({
      filter: {
        status: ["failed", "cancelled", "interrupted"],
        olderThanMs: 90 * 86_400_000,
      },
    });
  });

  it("disables 'Clear records' when zero status chips are selected", () => {
    render(<ClearHistoryDialog open onOpenChange={() => {}} />);

    for (const label of ["Completed", "Failed", "Cancelled", "Interrupted"]) {
      fireEvent.click(screen.getByRole("button", { name: label }));
    }

    expect(
      screen.getByRole("button", { name: /clear records/i }),
    ).toBeDisabled();
  });

  it("toasts 'No matching records to clear' when deleted is 0", async () => {
    clearMock.mockResolvedValue({ deleted: 0 });
    render(<ClearHistoryDialog open onOpenChange={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: /clear records/i }));

    await waitFor(() =>
      expect(toastDefault).toHaveBeenCalledWith("No matching records to clear"),
    );
  });
});
