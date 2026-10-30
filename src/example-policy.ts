import { readFileSync } from "node:fs"
import type { InspectionBatch } from "./inspect.js"

// A stricter revision-handoff policy, invoked after the CLI has written JSON.
// In a consumer package, register both exported schemas with Ajv before reading
// reports from another tool or an untrusted producer.
const batch = JSON.parse(
  readFileSync(process.argv[2] ?? "fdx-report.json", "utf8"),
) as InspectionBatch
if (batch.schemaVersion !== 1 || !Array.isArray(batch.results) || !batch.results.length)
  throw new Error("Expected an FDX Inspect v1 batch")
const blocked = new Set([
  "missing_revision_sets",
  "duplicate_revision_sets",
  "invalid_revision_sets",
])
const failure = batch.results.some(
  (result) =>
    "error" in result ||
    !result.report?.ok ||
    result.report.findings.some((finding) => blocked.has(finding.code)),
)
process.stdout.write(
  failure
    ? "Resolve unreadable files and revision definitions before handoff.\n"
    : "Revision policy passed.\n",
)
process.exitCode = failure ? 1 : 0
