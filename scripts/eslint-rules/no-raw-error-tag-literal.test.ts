// RuleTester suite for the custom ESLint rule `ft5/no-raw-error-tag-literal`
// (Task 3). The rule lives at tools/eslint-rules/no-raw-error-tag-literal.mjs
// (Decision 5); this test lives under scripts/ because the repo's vitest
// `include` scans scripts/**, packages/**, apps/**, services/** — NOT tools/**
// (same reason Task 1's drift guard lives under packages/ipc-contracts).
//
// The rule is SYNTACTIC (Decision 2 — no type services). It enforces the four
// fields tag/errorTag/lastErrorTag/engineCause (Decision 1) and offers OPT-IN
// ESLint suggestions, never an autofix applied by `--fix` (Decision 3).

import { RuleTester } from "eslint";
import tseslint from "typescript-eslint";
import { afterAll, describe, it } from "vitest";

import rule from "../../tools/eslint-rules/no-raw-error-tag-literal.mjs";

// Wire ESLint's RuleTester to vitest's globals (this repo runs vitest without
// `globals: true`, so RuleTester cannot find describe/it on its own).
RuleTester.afterAll = afterAll;
RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;

const ruleTester = new RuleTester({
  languageOptions: {
    parser: tseslint.parser,
    ecmaVersion: 2022,
    sourceType: "module",
  },
});

ruleTester.run("no-raw-error-tag-literal", rule, {
  valid: [
    // Const reference — the correct form.
    "const e = { tag: DatasourceErrorTag.AuthRevoked };",
    "if (e.tag === FilesErrorTag.Disconnected) {}",
    "const e = { lastErrorTag: DatasourceErrorTag.Unsupported };",
    // Non-tag values on enforced fields — not in the vocabulary, never flagged.
    'const e = { engineCause: "range-not-honored" };',
    'const e = { lastErrorTag: "service-restart" };',
    'const e = { lastErrorTag: "err" };',
    // A tag value on a NON-enforced field — out of scope.
    'const e = { someField: "auth-revoked" };',
    // Quoted/string-literal key — mirrors the guard's JSON `"tag":` skip.
    'const e = { "tag": "auth-revoked" };',
    // `case` over a non-tag discriminant (the DatasourceMimeFamily false
    // positive the regex guard had to allowlist) — not flagged.
    'switch (m.kind) { case "other": break; }',
    // Type-position declarations are TS type nodes (TSPropertySignature /
    // TSLiteralType), never Property values — the rule does not visit them.
    'interface X { readonly tag: "not-found"; }',
    'type T = "auth-revoked" | "disconnected";',
  ],
  invalid: [
    // --- construction, unique value → ONE suggestion (+ import prepend) ---
    {
      code: 'const e = { tag: "auth-expired" };',
      errors: [
        {
          messageId: "raw",
          data: { value: "auth-expired" },
          suggestions: [
            {
              messageId: "use",
              data: { ref: "DatasourceErrorTag.AuthExpired" },
              output:
                'import { DatasourceErrorTag } from "@ft5/ipc-contracts";\nconst e = { tag: DatasourceErrorTag.AuthExpired };',
            },
          ],
        },
      ],
    },
    // --- construction, SHARED value on `tag` → TWO suggestions ---
    {
      code: 'const e = { tag: "auth-revoked" };',
      errors: [
        {
          messageId: "raw",
          data: { value: "auth-revoked" },
          suggestions: [
            {
              messageId: "use",
              data: { ref: "DatasourceErrorTag.AuthRevoked" },
              output:
                'import { DatasourceErrorTag } from "@ft5/ipc-contracts";\nconst e = { tag: DatasourceErrorTag.AuthRevoked };',
            },
            {
              messageId: "use",
              data: { ref: "FilesErrorTag.AuthRevoked" },
              output:
                'import { FilesErrorTag } from "@ft5/ipc-contracts";\nconst e = { tag: FilesErrorTag.AuthRevoked };',
            },
          ],
        },
      ],
    },
    // --- errorTag construction, Files-unique value → ONE suggestion ---
    {
      code: 'const e = { errorTag: "disconnected" };',
      errors: [
        {
          messageId: "raw",
          data: { value: "disconnected" },
          suggestions: [
            {
              messageId: "use",
              data: { ref: "FilesErrorTag.Disconnected" },
              output:
                'import { FilesErrorTag } from "@ft5/ipc-contracts";\nconst e = { errorTag: FilesErrorTag.Disconnected };',
            },
          ],
        },
      ],
    },
    // --- engineCause: SHARED value forced to DatasourceErrorTag by FIELD_ENUM ---
    {
      code: 'const e = { engineCause: "rate-limited" };',
      errors: [
        {
          messageId: "raw",
          data: { value: "rate-limited" },
          suggestions: [
            {
              messageId: "use",
              data: { ref: "DatasourceErrorTag.RateLimited" },
              output:
                'import { DatasourceErrorTag } from "@ft5/ipc-contracts";\nconst e = { engineCause: DatasourceErrorTag.RateLimited };',
            },
          ],
        },
      ],
    },
    // --- lastErrorTag construction (Datasource-unique) ---
    {
      code: 'const e = { lastErrorTag: "network-error" };',
      errors: [
        {
          messageId: "raw",
          data: { value: "network-error" },
          suggestions: [
            {
              messageId: "use",
              data: { ref: "DatasourceErrorTag.NetworkError" },
              output:
                'import { DatasourceErrorTag } from "@ft5/ipc-contracts";\nconst e = { lastErrorTag: DatasourceErrorTag.NetworkError };',
            },
          ],
        },
      ],
    },
    // --- comparison, member discriminant, both operand orders ---
    {
      code: 'if (e.tag === "disconnected") {}',
      errors: [
        {
          messageId: "raw",
          data: { value: "disconnected" },
          suggestions: [
            {
              messageId: "use",
              data: { ref: "FilesErrorTag.Disconnected" },
              output:
                'import { FilesErrorTag } from "@ft5/ipc-contracts";\nif (e.tag === FilesErrorTag.Disconnected) {}',
            },
          ],
        },
      ],
    },
    {
      code: 'if ("disconnected" === e.tag) {}',
      errors: [
        {
          messageId: "raw",
          data: { value: "disconnected" },
          suggestions: [
            {
              messageId: "use",
              data: { ref: "FilesErrorTag.Disconnected" },
              output:
                'import { FilesErrorTag } from "@ft5/ipc-contracts";\nif (FilesErrorTag.Disconnected === e.tag) {}',
            },
          ],
        },
      ],
    },
    // --- case arm scoped to a `.tag` discriminant (shared value → 2) ---
    {
      code: "switch (e.tag) { case \"conflict\": break; }",
      errors: [
        {
          messageId: "raw",
          data: { value: "conflict" },
          suggestions: [
            {
              messageId: "use",
              data: { ref: "DatasourceErrorTag.Conflict" },
              output:
                'import { DatasourceErrorTag } from "@ft5/ipc-contracts";\nswitch (e.tag) { case DatasourceErrorTag.Conflict: break; }',
            },
            {
              messageId: "use",
              data: { ref: "FilesErrorTag.Conflict" },
              output:
                'import { FilesErrorTag } from "@ft5/ipc-contracts";\nswitch (e.tag) { case FilesErrorTag.Conflict: break; }',
            },
          ],
        },
      ],
    },
    // --- `!==` comparison (same path as ===) ---
    {
      code: 'if (e.tag !== "auth-expired") {}',
      errors: [
        {
          messageId: "raw",
          data: { value: "auth-expired" },
          suggestions: [
            {
              messageId: "use",
              data: { ref: "DatasourceErrorTag.AuthExpired" },
              output:
                'import { DatasourceErrorTag } from "@ft5/ipc-contracts";\nif (e.tag !== DatasourceErrorTag.AuthExpired) {}',
            },
          ],
        },
      ],
    },
    // --- tag literal wrapped in `as const` — parity with the grep guard ---
    {
      code: 'const e = { tag: "auth-revoked" as const };',
      errors: [
        {
          messageId: "raw",
          data: { value: "auth-revoked" },
          suggestions: [
            {
              messageId: "use",
              data: { ref: "DatasourceErrorTag.AuthRevoked" },
              output:
                'import { DatasourceErrorTag } from "@ft5/ipc-contracts";\nconst e = { tag: DatasourceErrorTag.AuthRevoked as const };',
            },
            {
              messageId: "use",
              data: { ref: "FilesErrorTag.AuthRevoked" },
              output:
                'import { FilesErrorTag } from "@ft5/ipc-contracts";\nconst e = { tag: FilesErrorTag.AuthRevoked as const };',
            },
          ],
        },
      ],
    },
    // --- import APPEND to an existing @ft5/ipc-contracts value import ---
    {
      code: 'import { FilesErrorTag } from "@ft5/ipc-contracts";\nconst e = { tag: "auth-expired" };',
      errors: [
        {
          messageId: "raw",
          data: { value: "auth-expired" },
          suggestions: [
            {
              messageId: "use",
              data: { ref: "DatasourceErrorTag.AuthExpired" },
              output:
                'import { FilesErrorTag, DatasourceErrorTag } from "@ft5/ipc-contracts";\nconst e = { tag: DatasourceErrorTag.AuthExpired };',
            },
          ],
        },
      ],
    },
    // --- NO duplicate import when the enum is already imported ---
    {
      code: 'import { DatasourceErrorTag } from "@ft5/ipc-contracts";\nconst e = { tag: "auth-expired" };',
      errors: [
        {
          messageId: "raw",
          data: { value: "auth-expired" },
          suggestions: [
            {
              messageId: "use",
              data: { ref: "DatasourceErrorTag.AuthExpired" },
              output:
                'import { DatasourceErrorTag } from "@ft5/ipc-contracts";\nconst e = { tag: DatasourceErrorTag.AuthExpired };',
            },
          ],
        },
      ],
    },
  ],
});
