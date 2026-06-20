// Drift guard: keeps `tools/error-tag-vocabulary.mjs` in sync with the actual
// `DatasourceErrorTag` and `FilesErrorTag` const objects in ipc-contracts.
//
// If a new tag value is added to either enum, this test fails until the shared
// vocabulary module is updated — preventing the ESLint rule (Task 2) and the
// grep-scan guard (Task 3) from silently missing the new value.
//
// Import style mirrors `datasource-error-tag.test-d.ts`.

import { describe, expect, it } from "vitest";

import { DatasourceErrorTag } from "../fs-datasource-engine.js";
import { FilesErrorTag } from "../files.js";
// Four levels up from packages/ipc-contracts/src/__tests__/ lands at the repo
// root, then into tools/. Node ESM requires the explicit .mjs extension.
import {
  ENFORCED_FIELDS,
  FIELD_ENUM,
  TAG_VALUES,
  VALUE_ENUM_MEMBERS,
} from "../../../../tools/error-tag-vocabulary.mjs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const allDatasourceValues = new Set(Object.values(DatasourceErrorTag));
const allFilesValues = new Set(Object.values(FilesErrorTag));
const unionValues = new Set([...allDatasourceValues, ...allFilesValues]);

// ---------------------------------------------------------------------------
// TAG_VALUES — must be the union of both enums (no more, no less)
// ---------------------------------------------------------------------------

describe("TAG_VALUES", () => {
  it("has no duplicates", () => {
    expect(TAG_VALUES.length, "TAG_VALUES contains duplicate entries").toBe(
      new Set(TAG_VALUES).size,
    );
  });

  it("contains every DatasourceErrorTag value", () => {
    const tagSet = new Set(TAG_VALUES);
    for (const v of allDatasourceValues) {
      expect(
        tagSet.has(v),
        `TAG_VALUES is missing DatasourceErrorTag value "${v}"`,
      ).toBe(true);
    }
  });

  it("contains every FilesErrorTag value", () => {
    const tagSet = new Set(TAG_VALUES);
    for (const v of allFilesValues) {
      expect(
        tagSet.has(v),
        `TAG_VALUES is missing FilesErrorTag value "${v}"`,
      ).toBe(true);
    }
  });

  it("contains no value absent from both enums", () => {
    for (const v of TAG_VALUES) {
      expect(
        unionValues.has(v),
        `TAG_VALUES contains "${v}" which is not in DatasourceErrorTag or FilesErrorTag`,
      ).toBe(true);
    }
  });

  it("size equals the union of both enums (both directions)", () => {
    expect(
      new Set(TAG_VALUES).size,
      "TAG_VALUES size must equal the union of DatasourceErrorTag + FilesErrorTag",
    ).toBe(unionValues.size);
  });
});

// ---------------------------------------------------------------------------
// VALUE_ENUM_MEMBERS — must cover exactly TAG_VALUES (bijection)
// ---------------------------------------------------------------------------

describe("VALUE_ENUM_MEMBERS", () => {
  it("every key is in TAG_VALUES", () => {
    const tagSet = new Set(TAG_VALUES);
    for (const key of Object.keys(VALUE_ENUM_MEMBERS)) {
      expect(
        tagSet.has(key),
        `VALUE_ENUM_MEMBERS key "${key}" is not in TAG_VALUES`,
      ).toBe(true);
    }
  });

  it("every TAG_VALUES entry is a key in VALUE_ENUM_MEMBERS", () => {
    const memberKeys = new Set(Object.keys(VALUE_ENUM_MEMBERS));
    for (const v of TAG_VALUES) {
      expect(
        memberKeys.has(v),
        `TAG_VALUES value "${v}" is missing from VALUE_ENUM_MEMBERS`,
      ).toBe(true);
    }
  });

  it("each DatasourceErrorTag member name resolves to the correct value", () => {
    for (const [value, members] of Object.entries(VALUE_ENUM_MEMBERS)) {
      if ("DatasourceErrorTag" in members) {
        const memberName = (members as Record<string, string>)[
          "DatasourceErrorTag"
        ];
        expect(
          DatasourceErrorTag[memberName as keyof typeof DatasourceErrorTag],
          `DatasourceErrorTag["${memberName}"] should equal "${value}" (from VALUE_ENUM_MEMBERS)`,
        ).toBe(value);
      }
    }
  });

  it("each FilesErrorTag member name resolves to the correct value", () => {
    for (const [value, members] of Object.entries(VALUE_ENUM_MEMBERS)) {
      if ("FilesErrorTag" in members) {
        const memberName = (members as Record<string, string>)["FilesErrorTag"];
        expect(
          FilesErrorTag[memberName as keyof typeof FilesErrorTag],
          `FilesErrorTag["${memberName}"] should equal "${value}" (from VALUE_ENUM_MEMBERS)`,
        ).toBe(value);
      }
    }
  });

  it("every DatasourceErrorTag member appears in VALUE_ENUM_MEMBERS under the correct enum", () => {
    for (const [memberName, value] of Object.entries(DatasourceErrorTag)) {
      const entry = (VALUE_ENUM_MEMBERS as Record<string, Record<string, string>>)[value];
      expect(
        entry,
        `Value "${value}" (DatasourceErrorTag.${memberName}) has no entry in VALUE_ENUM_MEMBERS`,
      ).toBeDefined();
      expect(
        entry["DatasourceErrorTag"],
        `VALUE_ENUM_MEMBERS["${value}"].DatasourceErrorTag should be "${memberName}"`,
      ).toBe(memberName);
    }
  });

  it("every FilesErrorTag member appears in VALUE_ENUM_MEMBERS under the correct enum", () => {
    for (const [memberName, value] of Object.entries(FilesErrorTag)) {
      const entry = (VALUE_ENUM_MEMBERS as Record<string, Record<string, string>>)[value];
      expect(
        entry,
        `Value "${value}" (FilesErrorTag.${memberName}) has no entry in VALUE_ENUM_MEMBERS`,
      ).toBeDefined();
      expect(
        entry["FilesErrorTag"],
        `VALUE_ENUM_MEMBERS["${value}"].FilesErrorTag should be "${memberName}"`,
      ).toBe(memberName);
    }
  });
});

// ---------------------------------------------------------------------------
// ENFORCED_FIELDS and FIELD_ENUM — structural sanity checks
// ---------------------------------------------------------------------------

describe("ENFORCED_FIELDS", () => {
  it("contains exactly the four documented field names", () => {
    expect(new Set(ENFORCED_FIELDS)).toEqual(
      new Set(["tag", "errorTag", "lastErrorTag", "engineCause"]),
    );
  });
});

describe("FIELD_ENUM", () => {
  it("has an entry for every ENFORCED_FIELDS member", () => {
    for (const field of ENFORCED_FIELDS) {
      expect(
        field in FIELD_ENUM,
        `FIELD_ENUM is missing an entry for enforced field "${field}"`,
      ).toBe(true);
    }
  });

  it("lastErrorTag and engineCause map to DatasourceErrorTag (engine-layer fields)", () => {
    expect(
      (FIELD_ENUM as Record<string, string | null>)["lastErrorTag"],
      'FIELD_ENUM["lastErrorTag"] should be "DatasourceErrorTag"',
    ).toBe("DatasourceErrorTag");
    expect(
      (FIELD_ENUM as Record<string, string | null>)["engineCause"],
      'FIELD_ENUM["engineCause"] should be "DatasourceErrorTag"',
    ).toBe("DatasourceErrorTag");
  });

  it("tag and errorTag map to null (context-dependent enum)", () => {
    expect(
      (FIELD_ENUM as Record<string, string | null>)["tag"],
      'FIELD_ENUM["tag"] should be null (context-dependent)',
    ).toBeNull();
    expect(
      (FIELD_ENUM as Record<string, string | null>)["errorTag"],
      'FIELD_ENUM["errorTag"] should be null (context-dependent)',
    ).toBeNull();
  });
});
