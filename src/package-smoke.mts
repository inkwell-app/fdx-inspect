import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const manager = process.env.npm_execpath
if (!manager) throw new Error("Run with pnpm smoke:package")
const temporary = mkdtempSync(join(tmpdir(), "fdx-inspect-pack-"))
try {
  execFileSync(process.execPath, [manager, "pack", "--pack-destination", temporary], {
    stdio: "inherit",
  })
  const archives = readdirSync(temporary).filter((name) => name.endsWith(".tgz"))
  assert.equal(archives.length, 1)
  const archive = archives[0]
  assert.ok(archive)
  writeFileSync(
    join(temporary, "package.json"),
    JSON.stringify({ name: "fdx-consumer", private: true, type: "module" }),
  )
  execFileSync(
    process.execPath,
    [
      manager,
      "add",
      "--ignore-scripts",
      "--ignore-workspace",
      "--store-dir",
      join(temporary, "store"),
      join(temporary, archive),
    ],
    { cwd: temporary, stdio: "inherit" },
  )
  writeFileSync(join(temporary, "sample.fdx"), readFileSync("fixtures/handoff.fdx"))
  const output = execFileSync(
    join(temporary, "node_modules/.bin/fdx-inspect"),
    ["--json", "sample.fdx"],
    { cwd: temporary, encoding: "utf8" },
  )
  assert.equal(JSON.parse(output).results[0].report.counts.scenes, 3)
  const mixed = spawnSync(
    join(temporary, "node_modules/.bin/fdx-inspect"),
    ["--json", "sample.fdx", "missing.fdx"],
    { cwd: temporary, encoding: "utf8" },
  )
  assert.equal(mixed.status, 2)
  const batch = JSON.parse(mixed.stdout)
  assert.equal(batch.results[1].error.code, "file_not_found")
  writeFileSync(
    join(temporary, "consumer.mjs"),
    `import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inspectFdx } from '@inkwell/fdx-inspect';
assert.equal(inspectFdx(readFileSync('sample.fdx','utf8')).counts.paragraphs, 9);
assert.ok(import.meta.resolve('@inkwell/fdx-inspect/schema').endsWith('report.schema.json'));
assert.ok(import.meta.resolve('@inkwell/fdx-inspect/batch-schema').endsWith('batch.schema.json'));
`,
  )
  execFileSync(process.execPath, ["consumer.mjs"], { cwd: temporary, stdio: "inherit" })
  const { Ajv } = await import("ajv")
  const ajv = new Ajv({ strict: true })
  const installed = join(temporary, "node_modules/@inkwell/fdx-inspect")
  ajv.addSchema(JSON.parse(readFileSync(join(installed, "schemas/report.schema.json"), "utf8")))
  const validate = ajv.compile(
    JSON.parse(readFileSync(join(installed, "schemas/batch.schema.json"), "utf8")),
  )
  assert.equal(validate(batch), true, JSON.stringify(validate.errors))
  const policyInput = join(temporary, "batch.json")
  const policy = join(installed, "dist/example-policy.js")
  writeFileSync(policyInput, mixed.stdout)
  assert.equal(spawnSync(process.execPath, [policy, policyInput]).status, 1)
  writeFileSync(policyInput, output)
  assert.equal(spawnSync(process.execPath, [policy, policyInput]).status, 0)
  for (const path of [
    "docs/cli.md",
    "fixtures/handoff.fdx",
    "assets/social-preview.png",
    "dist/example-policy.js",
    "LICENSE",
    "SECURITY.md",
  ])
    assert.deepEqual(readFileSync(join(installed, path)), readFileSync(path))
  process.stdout.write(
    "Packed install: CLI, library, both schemas, mixed results, handoff policy and documentation passed in a fresh consumer\n",
  )
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
