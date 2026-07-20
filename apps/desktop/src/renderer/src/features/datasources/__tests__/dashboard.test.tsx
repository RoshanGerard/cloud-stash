/** @vitest-environment jsdom */
//
// Phase 5.1 — Dashboard state-machine tests. Exercises `DatasourcesDashboard`
// (provider + states) against a fully-mocked `window.api.datasources` surface
// so we can control resolve/reject timing per test.
//
// The dashboard composition lives in `../dashboard.tsx` so tests can mount
// the <DatasourcesProvider><DatasourcesDashboard/></DatasourcesProvider>
// pair directly without importing the Next.js page module (which is only
// wired up in task 5.5).

import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import type { DatasourceSummary } from "@cloudstash/ipc-contracts";

// Task 8.2 added `useRouter()` from `next/navigation` to the DatasourceCard
// (the "Explore" quick-action pushes /datasources/explore?id=<id>). Dashboard
// tests mount real cards in populated state, so without the App-Router
// context Next throws "invariant expected app router to be mounted". Mock
// at hoist-time — same pattern as card.test.tsx and
// diagnostics-shortcut.test.tsx. We don't assert on pushMock here; these
// tests focus on dashboard state-machine behaviour, not navigation.
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

import { DatasourcesProvider } from "../store";
import { DatasourcesDashboard } from "../dashboard";

type PromiseController<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

function createController<T>(): PromiseController<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const POPULATED_FIXTURE: DatasourceSummary[] = [
  {
    id: "ds-1",
    displayName: "Personal Drive",
    providerId: "google-drive",
    status: "connected",
    lastSyncAt: 1_700_000_000_000,
    itemCount: 1240,
    usage: { used: 12_000_000_000, quota: 16_000_000_000 },
  },
  {
    id: "ds-2",
    displayName: "Archive Bucket",
    providerId: "amazon-s3",
    status: "paused",
    lastSyncAt: null,
    itemCount: 23,
  },
  {
    id: "ds-3",
    displayName: "Team OneDrive",
    providerId: "onedrive",
    status: "syncing",
    lastSyncAt: 1_700_000_100_000,
    itemCount: 512,
    usage: { used: 800_000_000, quota: 1_000_000_000 },
  },
];

let listMock: Mock;
let addMock: Mock;
let removeMock: Mock;
let actionMock: Mock;
let uploadMock: Mock;

function installApiMock() {
  (window as unknown as { api: unknown }).api = {
    ping: vi.fn().mockResolvedValue({ ok: true, ts: 1 }),
    datasources: {
      list: listMock,
      add: addMock,
      remove: removeMock,
      action: actionMock,
      upload: uploadMock,
      onUploadProgress: vi.fn().mockReturnValue(() => {}),
    },
  };
}

describe("DatasourcesDashboard state machine (task 5.1)", () => {
  beforeEach(() => {
    listMock = vi.fn();
    addMock = vi.fn();
    removeMock = vi.fn();
    actionMock = vi.fn();
    uploadMock = vi.fn();
    installApiMock();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("loading state: shimmering skeletons visible, no cards mounted", async () => {
    // Never resolve — stays in loading forever.
    listMock.mockReturnValue(new Promise<never>(() => {}));

    const { container } = render(
      <DatasourcesProvider>
        <DatasourcesDashboard />
      </DatasourcesProvider>,
    );

    // At least one element carries the shimmer animation class.
    const shimmering = container.querySelectorAll("[class*='animate-skeleton-shimmer']");
    expect(shimmering.length).toBeGreaterThan(0);

    // No card-root articles/headings for specific datasources — loading
    // placeholders are generic, not data-bound.
    expect(container.querySelector("[data-testid='datasource-card']")).toBeNull();
  });

  it("toolbar shows the page title and a one-line subtitle (Title B)", () => {
    // Toolbar renders in every state; keep it in loading so nothing is async.
    listMock.mockReturnValue(new Promise<never>(() => {}));

    render(
      <DatasourcesProvider>
        <DatasourcesDashboard />
      </DatasourcesProvider>,
    );

    // Exactly-one-h1 a11y contract holds: the heading's accessible name is
    // still just "Datasources" (the subtitle is a sibling <p>, not inside it).
    expect(screen.getByRole("heading", { level: 1, name: "Datasources" })).toBeInTheDocument();

    // The subtitle line renders beneath it and is not a heading.
    const subtitle = screen.getByText(/connect and sync your cloud storage/i);
    expect(subtitle).toBeInTheDocument();
    expect(subtitle.tagName).toBe("P");
  });

  it("empty state: renders illustration, heading, and Add datasource CTA", async () => {
    listMock.mockResolvedValue({ datasources: [] });

    render(
      <DatasourcesProvider>
        <DatasourcesDashboard />
      </DatasourcesProvider>,
    );

    // Wait for the empty state to render.
    const heading = await screen.findByRole("heading", {
      name: /no cloud datasources/i,
    });
    expect(heading).toBeInTheDocument();

    // Illustration from task 4b.8 is present.
    const illustration = document.querySelector("[data-illustration='empty-datasources']");
    expect(illustration).not.toBeNull();

    // Primary CTA is focusable. Scope to the empty-state panel so we don't
    // collide with the toolbar's own Add datasource trigger.
    const emptyPanel = screen.getByTestId("datasources-empty");
    const cta = within(emptyPanel).getByRole("button", {
      name: /add datasource/i,
    });
    expect(cta).toBeInTheDocument();
    cta.focus();
    expect(cta).toHaveFocus();
  });

  it("populated state: one card per summary, grid uses gap-3", async () => {
    listMock.mockResolvedValue({ datasources: POPULATED_FIXTURE });

    const { container } = render(
      <DatasourcesProvider>
        <DatasourcesDashboard />
      </DatasourcesProvider>,
    );

    // Wait for the list to resolve and cards to mount.
    await waitFor(() => {
      const cards = container.querySelectorAll("[data-testid='datasource-card']");
      expect(cards.length).toBe(POPULATED_FIXTURE.length);
    });

    // Grid container classlist includes gap-3.
    const grid = container.querySelector("[data-testid='datasources-grid']");
    expect(grid).not.toBeNull();
    expect(grid!.className).toMatch(/\bgap-3\b/);

    // Cards appear in response order — look up by display name and check
    // relative DOM order.
    const cards = Array.from(
      container.querySelectorAll<HTMLElement>("[data-testid='datasource-card']"),
    );
    const renderedNames = cards.map((c) => {
      const heading = within(c).queryByRole("heading");
      return heading?.textContent ?? "";
    });
    expect(renderedNames).toEqual(POPULATED_FIXTURE.map((s) => s.displayName));
  });

  it("search field filters the populated grid by name/provider, with a no-matches state", async () => {
    listMock.mockResolvedValue({ datasources: POPULATED_FIXTURE });

    const { container } = render(
      <DatasourcesProvider>
        <DatasourcesDashboard />
      </DatasourcesProvider>,
    );

    await waitFor(() => {
      expect(container.querySelectorAll("[data-testid='datasource-card']").length).toBe(
        POPULATED_FIXTURE.length,
      );
    });

    const search = screen.getByRole("searchbox", {
      name: /search datasources/i,
    });

    // Query matching only the OneDrive datasource (by provider id + name).
    fireEvent.change(search, { target: { value: "onedrive" } });
    await waitFor(() => {
      expect(container.querySelectorAll("[data-testid='datasource-card']").length).toBe(1);
    });
    expect(screen.getByText("Team OneDrive")).toBeInTheDocument();

    // A non-matching query shows the no-matches state and mounts no cards.
    fireEvent.change(search, { target: { value: "no-such-source" } });
    expect(screen.getByTestId("datasources-no-matches")).toBeInTheDocument();
    expect(container.querySelector("[data-testid='datasource-card']")).toBeNull();

    // Clearing the query restores the full list.
    fireEvent.change(search, { target: { value: "" } });
    await waitFor(() => {
      expect(container.querySelectorAll("[data-testid='datasource-card']").length).toBe(
        POPULATED_FIXTURE.length,
      );
    });
  });

  it("failed list: error panel with retry re-invokes list() and recovers", async () => {
    // First call rejects. Retry will resolve.
    const firstReject = createController<{ datasources: DatasourceSummary[] }>();
    const secondResolve: { datasources: DatasourceSummary[] } = {
      datasources: POPULATED_FIXTURE.slice(0, 1),
    };
    listMock.mockReturnValueOnce(firstReject.promise).mockResolvedValueOnce(secondResolve);

    render(
      <DatasourcesProvider>
        <DatasourcesDashboard />
      </DatasourcesProvider>,
    );

    firstReject.reject(new Error("Network is down"));

    // Error panel with the message visible + Retry button.
    const errMsg = await screen.findByText(/network is down/i);
    expect(errMsg).toBeInTheDocument();

    const retry = screen.getByRole("button", { name: /retry/i });
    fireEvent.click(retry);

    // After retry resolves, the populated state renders.
    await waitFor(() => {
      const cards = document.querySelectorAll("[data-testid='datasource-card']");
      expect(cards.length).toBe(1);
    });

    // list() was called twice: initial + retry.
    expect(listMock).toHaveBeenCalledTimes(2);
  });
});
