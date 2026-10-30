import { readFileSync, writeFileSync } from "node:fs"
import { isDeepStrictEqual } from "node:util"
import { FINDINGS, type Finding, formatMarkdown, INPUT_ERRORS, inspectFdx } from "./inspect.js"

const integer = { type: "integer", minimum: 0 }
const bool = { type: "boolean" }
const object = (properties: Record<string, unknown>) => ({
  type: "object",
  additionalProperties: false,
  required: Object.keys(properties),
  properties,
})
const counts = (value: object) =>
  object(Object.fromEntries(Object.keys(value).map((key) => [key, integer])))
const blank = inspectFdx("")
const severity = (values: Finding["severity"][]) => ({
  type: "object",
  properties: { severity: { enum: values } },
})
const report = {
  $schema: "http://json-schema.org/draft-07/schema#",
  $id: "https://github.com/inkwell-app/fdx-inspect/blob/main/schemas/report.schema.json",
  title: "FDX inspection report v1",
  ...object({
    schemaVersion: { const: 1 },
    ok: bool,
    health: { enum: ["readable", "readable_with_warnings", "unreadable"] },
    counts: counts(blank.counts),
    revisions: counts(blank.revisions),
    metadata: object(Object.fromEntries(Object.keys(blank.metadata).map((key) => [key, bool]))),
    pages: object({ locked: bool, markers: integer, insertedMarkers: integer }),
    scenes: {
      type: "array",
      maxItems: 10000,
      items: object({
        index: { type: "integer", minimum: 1 },
        paragraph: { type: "integer", minimum: 1 },
        paragraphs: integer,
        dialogue: integer,
        numbered: bool,
        locked: bool,
        omitted: bool,
      }),
    },
    sceneMapTruncated: bool,
    findings: {
      type: "array",
      items: {
        oneOf: Object.entries(FINDINGS).map(([code, [severity]]) =>
          object({
            code: { const: code },
            severity: { const: severity },
            count: { type: "integer", minimum: 1 },
          }),
        ),
      },
    },
  }),
  oneOf: [
    {
      properties: {
        ok: { const: true },
        health: { const: "readable" },
        findings: { type: "array", items: severity(["info"]) },
      },
    },
    {
      properties: {
        ok: { const: true },
        health: { const: "readable_with_warnings" },
        findings: {
          type: "array",
          items: severity(["info", "warning"]),
          contains: severity(["warning"]),
        },
      },
    },
    {
      properties: {
        ok: { const: false },
        health: { const: "unreadable" },
        findings: { type: "array", contains: severity(["error"]) },
      },
    },
  ],
}
const batch = {
  $schema: report.$schema,
  $id: "https://github.com/inkwell-app/fdx-inspect/blob/main/schemas/batch.schema.json",
  title: "FDX CLI batch v1",
  ...object({
    schemaVersion: { const: 1 },
    results: {
      type: "array",
      minItems: 1,
      items: {
        oneOf: [
          object({ input: { type: "string" }, report: { $ref: report.$id } }),
          object({
            input: { type: "string" },
            error: object({
              code: { enum: Object.keys(INPUT_ERRORS) },
              message: { type: "string", minLength: 1 },
            }),
          }),
        ],
      },
    },
  }),
}
const files = {
  "schemas/report.schema.json": `${JSON.stringify(report, null, 2)}\n`,
  "schemas/batch.schema.json": `${JSON.stringify(batch, null, 2)}\n`,
  "docs/example-report.md": formatMarkdown(
    inspectFdx(readFileSync("fixtures/handoff.fdx", "utf8")),
  ),
}
for (const [path, contents] of Object.entries(files)) {
  if (process.argv.includes("--check")) {
    const actual = readFileSync(path, "utf8")
    const matches = path.endsWith(".json")
      ? isDeepStrictEqual(JSON.parse(actual), JSON.parse(contents))
      : actual === contents
    if (!matches) throw new Error(`Generated artifact differs: ${path}`)
  } else writeFileSync(path, contents)
}
