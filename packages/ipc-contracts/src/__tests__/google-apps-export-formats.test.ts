// Standing constant guard for the Google Apps export-format table introduced
// by `add-drive-docs-editors-export`.
//
// `GOOGLE_APPS_EXPORT_FORMATS` is the single shared source of truth that maps
// each exportable Google Apps mime type to the Drive export target mime and the
// saved-file extension. Both the engine (Drive strategy) and the renderer
// (download orchestrator) consume it. The test asserts the exact shape so
// callers can rely on it without re-reading the source.

import { describe, expect, it } from "vitest";

import { GOOGLE_APPS_EXPORT_FORMATS } from "../files.js";

describe("GOOGLE_APPS_EXPORT_FORMATS", () => {
  it("has exactly 5 keys", () => {
    expect(Object.keys(GOOGLE_APPS_EXPORT_FORMATS)).toHaveLength(5);
  });

  it("maps google-apps.document to docx", () => {
    expect(
      GOOGLE_APPS_EXPORT_FORMATS["application/vnd.google-apps.document"],
    ).toEqual({
      exportMime:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      extension: ".docx",
    });
  });

  it("maps google-apps.spreadsheet to xlsx", () => {
    expect(
      GOOGLE_APPS_EXPORT_FORMATS["application/vnd.google-apps.spreadsheet"],
    ).toEqual({
      exportMime:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      extension: ".xlsx",
    });
  });

  it("maps google-apps.presentation to pptx", () => {
    expect(
      GOOGLE_APPS_EXPORT_FORMATS["application/vnd.google-apps.presentation"],
    ).toEqual({
      exportMime:
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      extension: ".pptx",
    });
  });

  it("maps google-apps.drawing to png", () => {
    expect(
      GOOGLE_APPS_EXPORT_FORMATS["application/vnd.google-apps.drawing"],
    ).toEqual({
      exportMime: "image/png",
      extension: ".png",
    });
  });

  it("maps google-apps.script to json", () => {
    expect(
      GOOGLE_APPS_EXPORT_FORMATS["application/vnd.google-apps.script"],
    ).toEqual({
      exportMime: "application/vnd.google-apps.script+json",
      extension: ".json",
    });
  });

  it("does NOT include non-exportable mime types like google-apps.form", () => {
    expect(
      Object.prototype.hasOwnProperty.call(
        GOOGLE_APPS_EXPORT_FORMATS,
        "application/vnd.google-apps.form",
      ),
    ).toBe(false);
  });
});
