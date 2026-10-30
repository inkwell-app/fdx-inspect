import assert from "node:assert/strict"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { parse } from "yaml"

const root = process.cwd()
const urls = new Set<string>()
function walk(directory: string): void {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if ([".git", "node_modules", "dist"].includes(entry.name)) continue
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      walk(path)
      continue
    }
    if (!/\.(md|txt|yml|cff|json)$/.test(entry.name) || entry.name === "pnpm-lock.yaml") continue
    const text = readFileSync(path, "utf8")
    if (entry.name.endsWith(".md")) {
      for (const [, href] of text.matchAll(/\]\(([^)]+)\)|src="([^"]+)"/g)) {
        if (!href || /^(https?:|mailto:|#)/.test(href)) continue
        const target = href.split("#")[0]
        assert.ok(target)
        assert.ok(existsSync(resolve(dirname(path), target)), `Missing target in ${path}: ${href}`)
      }
      for (const [, href] of text.matchAll(/src="([^"]+)"/g)) {
        assert.ok(href)
        assert.ok(existsSync(resolve(dirname(path), href)))
      }
    }
    for (const [href] of text.matchAll(/https?:\/\/[^\s)<>"']+/g)) {
      const url = new URL(href)
      if (url.hostname === "www.inkwell.software" && /\.(md|txt|yml)$/.test(entry.name)) {
        // Require attribution fields, not authored campaign values. GA4's optional
        // utm_id and utm_source_platform remain checked when supplied to --live.
        for (const key of ["utm_source", "utm_medium", "utm_campaign", "utm_content"])
          assert.ok(url.searchParams.get(key)?.trim(), `${path}: missing ${key}`)
      }
      if (url.hostname === "github.com" && url.pathname.startsWith("/inkwell-app/fdx-inspect/")) {
        const target = url.pathname.match(/^\/inkwell-app\/fdx-inspect\/blob\/main\/(.+)$/)?.[1]
        if (target)
          assert.ok(existsSync(join(root, target)), `Missing own-repository target: ${target}`)
        continue
      }
      if (url.hostname === "www.inkwell.software") urls.add(url.toString())
    }
  }
}
walk(root)
const labelRows = JSON.parse(readFileSync(".github/labels.json", "utf8")) as { name: string }[]
const labels = new Set(labelRows.map((row) => row.name))
interface IssueForm {
  body?: { type: string; id?: string }[]
  labels?: string[]
}
for (const name of readdirSync(".github/ISSUE_TEMPLATE")) {
  const form = parse(readFileSync(`.github/ISSUE_TEMPLATE/${name}`, "utf8")) as IssueForm
  if (!form.body) continue
  for (const label of form.labels ?? [])
    assert.ok(labels.has(label), `Issue form uses an absent label: ${label}`)
  const ids = form.body.filter((field) => field.type !== "markdown").map((field) => field.id)
  assert.equal(new Set(ids).size, ids.length, "Issue form IDs must be unique")
  assert.ok(ids.every(Boolean))
}
const pkg = JSON.parse(readFileSync("package.json", "utf8")) as {
  dependencies: Record<string, string>
}
assert.deepEqual(Object.keys(pkg.dependencies), ["fast-xml-parser"])
for (const name of readdirSync("src").filter((name) => name.endsWith(".ts"))) {
  const code = readFileSync(`src/${name}`, "utf8")
  for (const [, specifier] of code.matchAll(/(?:from\s*|import\s*\()\s*["']([^"']+)["']/g)) {
    assert.ok(specifier)
    assert.ok(
      specifier.startsWith("node:") ||
        specifier === "fast-xml-parser" ||
        /^\.\/[\w.-]+\.js$/.test(specifier),
      `Unexpected runtime import: ${specifier}`,
    )
  }
}
if (process.argv.includes("--live")) {
  for (const href of urls) {
    const response = await fetch(href, { signal: AbortSignal.timeout(30000) })
    assert.ok(response.ok, `${response.status} ${href}`)
    const final = new URL(response.url)
    assert.equal(final.hostname, "www.inkwell.software", `Unexpected redirect: ${response.url}`)
    for (const [key, value] of new URL(href).searchParams)
      if (key.startsWith("utm_"))
        assert.equal(final.searchParams.get(key), value, `Redirect dropped ${key}`)
  }
}
process.stdout.write(
  `Links, issue labels and runtime imports checked; ${urls.size} Inkwell destinations${process.argv.includes("--live") ? " verified live" : " available for --live verification"}\n`,
)
