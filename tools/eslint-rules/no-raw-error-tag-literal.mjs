/**
 * ESLint rule: ft5/no-raw-error-tag-literal
 *
 * Forbids raw `DatasourceErrorTag` / `FilesErrorTag` value literals in error-tag
 * context, mirroring (and complementing) the Vitest grep-scan guard at
 * packages/ipc-contracts/src/__tests__/error-tag-const-convention.test.ts.
 *
 * Design (openspec/changes/add-error-tag-literal-lint/design.md):
 *  - Decision 1: enforced fields = tag / errorTag / lastErrorTag / engineCause.
 *  - Decision 2: SYNTACTIC AST rule (no type services — the flat config defers
 *    `projectService`). Visits VALUE positions only, so type-position
 *    declarations (`readonly tag: "..."`, string-literal union types) are never
 *    flagged; scopes `case` arms to a `.tag`/`.errorTag`/... discriminant so the
 *    DatasourceMimeFamily `case "other"` false positive cannot arise.
 *  - Decision 3: OPT-IN suggestions only. There is deliberately NO `fix`, so
 *    `eslint --fix` never rewrites a shared value to the wrong enum.
 *  - Decision 4: exceptions (off-vocabulary ServiceErrorTag / AuthFailedTag
 *    literals, off-taxonomy fixtures) are handled per-site via
 *    `// eslint-disable-next-line ft5/no-raw-error-tag-literal -- <reason>`, not
 *    a built-in allowlist; the shared vocabulary is the single source of truth.
 *
 * Vocabulary is imported from the shared module so the rule and the Vitest guard
 * can never drift (the drift guard keeps that module in sync with the enums).
 */

import {
  ENFORCED_FIELDS,
  FIELD_ENUM,
  TAG_VALUES,
  VALUE_ENUM_MEMBERS,
} from "../error-tag-vocabulary.mjs";

const TAG_SET = new Set(TAG_VALUES);
const FIELD_SET = new Set(ENFORCED_FIELDS);
const IPC_CONTRACTS = "@ft5/ipc-contracts";

/** The field name a discriminant/operand refers to, or null. */
function fieldNameOf(node) {
  if (!node) return null;
  // Peel optional-chaining: `err?.tag` is a ChainExpression wrapping an
  // (optional) MemberExpression. Without this the rule misses the common
  // `x?.tag === "..."` / `switch (x?.tag)` error-handling shapes.
  if (node.type === "ChainExpression") node = node.expression;
  if (
    node.type === "MemberExpression" &&
    !node.computed &&
    node.property.type === "Identifier"
  ) {
    return node.property.name;
  }
  if (node.type === "Identifier") return node.name;
  return null;
}

/** True if `node` is a string Literal whose value is a known tag value. */
function isTagLiteral(node) {
  return (
    node &&
    node.type === "Literal" &&
    typeof node.value === "string" &&
    TAG_SET.has(node.value)
  );
}

/**
 * Peel TS expression wrappers (`as const`, `satisfies`, `!`) and return the
 * underlying tag Literal, or null. Keeps the rule's coverage aligned with the
 * text-based grep guard, which matches `tag: "x" as const` too.
 */
function unwrapToTagLiteral(node) {
  let cur = node;
  while (
    cur &&
    (cur.type === "TSAsExpression" ||
      cur.type === "TSSatisfiesExpression" ||
      cur.type === "TSNonNullExpression")
  ) {
    cur = cur.expression;
  }
  return isTagLiteral(cur) ? cur : null;
}

/**
 * Candidate `Enum.Member` references for a (value, field) pair.
 * - lastErrorTag / engineCause force DatasourceErrorTag (FIELD_ENUM).
 * - tag / errorTag are context-dependent → one ref for a unique value, two for
 *   a shared value (DatasourceErrorTag first, then FilesErrorTag).
 */
function candidateRefs(value, field) {
  const members = VALUE_ENUM_MEMBERS[value];
  if (!members) return [];
  const forced = FIELD_ENUM[field];
  if (forced && members[forced]) return [`${forced}.${members[forced]}`];
  return Object.entries(members).map(([enumName, member]) => `${enumName}.${member}`);
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Reference DatasourceErrorTag / FilesErrorTag values via the const object, not raw string literals.",
      recommended: true,
    },
    hasSuggestions: true,
    schema: [],
    messages: {
      raw: 'Reference the "{{value}}" error tag via its const object (@ft5/ipc-contracts), not a raw string literal.',
      use: "Use {{ref}}",
    },
  },

  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    /** Fix ops to ensure the value `enumName` is imported from @ft5/ipc-contracts. */
    function ensureImportFixes(fixer, enumName) {
      const body = sourceCode.ast.body;
      const ipcImports = body.filter(
        (n) => n.type === "ImportDeclaration" && n.source.value === IPC_CONTRACTS,
      );
      const valueImports = ipcImports.filter((d) => d.importKind !== "type");

      const alreadyImported = valueImports.some((d) =>
        d.specifiers.some(
          (s) =>
            s.type === "ImportSpecifier" &&
            s.importKind !== "type" &&
            (s.imported.name ?? s.imported.value) === enumName,
        ),
      );
      if (alreadyImported) return [];

      const targetImport = valueImports.find((d) =>
        d.specifiers.some((s) => s.type === "ImportSpecifier"),
      );
      if (targetImport) {
        const specs = targetImport.specifiers.filter(
          (s) => s.type === "ImportSpecifier",
        );
        const last = specs[specs.length - 1];
        return [fixer.insertTextAfter(last, `, ${enumName}`)];
      }

      const importLine = `import { ${enumName} } from "${IPC_CONTRACTS}";\n`;
      const first = body[0];
      return [
        first
          ? fixer.insertTextBefore(first, importLine)
          : fixer.insertTextBeforeRange([0, 0], importLine),
      ];
    }

    function buildSuggestions(literalNode, value, field) {
      return candidateRefs(value, field).map((ref) => ({
        messageId: "use",
        data: { ref },
        fix(fixer) {
          const enumName = ref.slice(0, ref.indexOf("."));
          return [
            fixer.replaceText(literalNode, ref),
            ...ensureImportFixes(fixer, enumName),
          ];
        },
      }));
    }

    function reportLiteral(literalNode, field) {
      context.report({
        node: literalNode,
        messageId: "raw",
        data: { value: literalNode.value },
        suggest: buildSuggestions(literalNode, literalNode.value, field),
      });
    }

    return {
      // Construction: `{ tag: "..." }` — Identifier key only (a quoted/string
      // key is the JSON-payload form the guard deliberately skips).
      Property(node) {
        if (node.computed) return;
        if (node.key.type !== "Identifier") return;
        if (!FIELD_SET.has(node.key.name)) return;
        const lit = unwrapToTagLiteral(node.value);
        if (lit) reportLiteral(lit, node.key.name);
      },

      // Comparison: `x.tag === "..."` / `"..." === x.tag` (and !== / ==).
      BinaryExpression(node) {
        if (node.operator !== "===" && node.operator !== "!==" && node.operator !== "==") {
          return;
        }
        const leftField = fieldNameOf(node.left);
        const rightField = fieldNameOf(node.right);
        const rightLit = unwrapToTagLiteral(node.right);
        const leftLit = unwrapToTagLiteral(node.left);
        if (leftField && FIELD_SET.has(leftField) && rightLit) {
          reportLiteral(rightLit, leftField);
        } else if (rightField && FIELD_SET.has(rightField) && leftLit) {
          reportLiteral(leftLit, rightField);
        }
      },

      // `case "..."` — only when the switch discriminates on a tag field.
      SwitchCase(node) {
        const lit = unwrapToTagLiteral(node.test);
        if (!lit) return;
        const field = fieldNameOf(node.parent?.discriminant);
        if (field && FIELD_SET.has(field)) reportLiteral(lit, field);
      },
    };
  },
};
