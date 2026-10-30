import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type InspectionReport, inspectFdx } from "./inspect.js"

const source = JSON.parse(readFileSync(".github/interop-source.json", "utf8")) as {
  repository: string
  commit: string
}
assert.equal(source.repository, "https://github.com/inkwell-app/screenplay-interop.git")
assert.match(source.commit, /^[a-f0-9]{40}$/)
const checkout = mkdtempSync(join(tmpdir(), "fdx-interop-"))
try {
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", checkout, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim()
  git("init", "--quiet")
  git("fetch", "--quiet", "--depth=1", source.repository, source.commit)
  git("checkout", "--quiet", "--detach", "FETCH_HEAD")
  assert.equal(git("rev-parse", "HEAD"), source.commit)
  let checked = 0
  for (const name of readdirSync(join(checkout, "fixtures")).sort()) {
    const directory = join(checkout, "fixtures", name)
    if (!existsSync(join(directory, "input.fdx"))) continue
    const expected = JSON.parse(readFileSync(join(directory, "expected.json"), "utf8")) as {
      health: string
      counts?: Partial<InspectionReport["counts"]>
    }
    const report = inspectFdx(readFileSync(join(directory, "input.fdx"), "utf8"))
    assert.equal(
      report.health,
      expected.health === "malformed" ? "unreadable" : expected.health,
      name,
    )
    // Only compare identical units. Dialogue blocks, name variants and transfer
    // predictions belong to the peer contract, not this inventory's contract.
    for (const key of [
      "scenes",
      "lockedScenes",
      "numberedScenes",
      "omittedScenes",
      "revisedParagraphs",
    ] as const)
      if (expected.counts?.[key] !== undefined)
        assert.equal(report.counts[key], expected.counts[key], `${name}: ${key}`)
    checked++
  }
  assert.ok(checked > 0, "No external FDX fixtures were tested")
  process.stdout.write(
    `Checked health and shared count units for ${checked} pinned public FDX fixtures\n`,
  )
} finally {
  rmSync(checkout, { recursive: true, force: true })
}
