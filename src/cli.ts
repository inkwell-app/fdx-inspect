#!/usr/bin/env node
import { createReadStream, readFileSync } from "node:fs"
import { realpath, stat } from "node:fs/promises"
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import { TextDecoder } from "node:util"
import {
  INPUT_ERRORS,
  type InputErrorCode,
  type InputResult,
  type InspectionBatch,
} from "./batch.js"
import { formatMarkdown, inspectFdx, MAX_BYTES } from "./inspect.js"

const HELP = `fdx-inspect — inspect Final Draft screenplay files

Usage: fdx-inspect [options] file.fdx [more.fdx ...]
       fdx-inspect --json - < file.fdx
       fdx-inspect --fixture fdx-locked-pages --fixtures-dir ../screenplay-interop

  --json              JSON batch envelope (including a single input)
  --markdown          Markdown reports (default)
  --strict            Exit 1 when a readable file has warnings
  --max-scenes N      Scene-map limit, 0–10000 (default 1000)
  --fixture ID        Inspect a fixture from a screenplay-interop checkout
  --fixtures-dir DIR  Checkout containing fixtures/ID/input.fdx
  --help              Show this help
  --version           Show the CLI version
  --                  Treat remaining arguments as file names

Exit: 0 readable; 1 warnings with --strict; 2 invalid input, I/O or usage.
Files are UTF-8 XML, up to 8 MiB each. '-' reads standard input once.
`
class UsageError extends Error {}
class InputError extends Error {
  constructor(readonly code: InputErrorCode) {
    super(INPUT_ERRORS[code])
  }
}
const label = (path: string): string =>
  JSON.stringify(path === "-" ? "standard input" : path).replace(
    /[&<>`*_\[\]\\]/g,
    (character) => `&#${character.charCodeAt(0)};`,
  )

async function readInput(path: string): Promise<string> {
  if (path !== "-" && !(await stat(path)).isFile()) throw new InputError("not_regular_file")
  const stream = path === "-" ? process.stdin : createReadStream(path)
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.length
    if (bytes > MAX_BYTES) throw new InputError("input_too_large")
    chunks.push(buffer)
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))
  } catch {
    throw new InputError("invalid_encoding")
  }
}
async function main(): Promise<void> {
  const args = process.argv.slice(2)
  let json = false
  let strict = false
  let maxScenes = 1000
  let fixture: string | undefined
  let fixturesDir: string | undefined
  const paths: string[] = []
  let literal = false
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (!arg) continue
    if (literal) {
      paths.push(arg)
      continue
    }
    if (arg === "--") {
      literal = true
      continue
    }
    if (arg === "--help") {
      process.stdout.write(HELP)
      return
    }
    if (arg === "--version") {
      const pkg: unknown = JSON.parse(
        readFileSync(new URL("../package.json", import.meta.url), "utf8"),
      )
      if (!pkg || typeof pkg !== "object" || !("version" in pkg) || typeof pkg.version !== "string")
        throw new Error("Invalid package version")
      process.stdout.write(`${pkg.version}\n`)
      return
    }
    if (arg === "--json") {
      json = true
      continue
    }
    if (arg === "--markdown") {
      json = false
      continue
    }
    if (arg === "--strict") {
      strict = true
      continue
    }
    if (["--max-scenes", "--fixture", "--fixtures-dir"].includes(arg)) {
      const value = args[++i]
      if (!value || value.startsWith("--")) throw new UsageError(`Missing value for ${arg}`)
      if (arg === "--fixture") fixture = value
      else if (arg === "--fixtures-dir") fixturesDir = value
      else {
        if (!/^\d+$/.test(value) || Number(value) > 10000)
          throw new UsageError("--max-scenes must be an integer from 0 to 10000")
        maxScenes = Number(value)
      }
      continue
    }
    if (arg.startsWith("-") && arg !== "-")
      throw new UsageError("Unknown option; use --help or -- before a file name")
    paths.push(arg)
  }
  if (fixture !== undefined || fixturesDir !== undefined) {
    if (!fixture || !fixturesDir || paths.length || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(fixture))
      throw new UsageError(
        "Use --fixture ID with --fixtures-dir CHECKOUT and no file arguments; IDs use lowercase letters, numbers and hyphens",
      )
    let base: string
    let target: string
    try {
      base = await realpath(join(resolve(fixturesDir), "fixtures"))
      target = await realpath(join(base, fixture, "input.fdx"))
    } catch {
      throw new UsageError(
        "Could not open fixture: expected CHECKOUT/fixtures/ID/input.fdx; check the checkout path, ID and permissions",
      )
    }
    const rel = relative(base, target)
    if (isAbsolute(rel) || rel === ".." || rel.startsWith(`..${sep}`))
      throw new UsageError(
        "Fixture escapes the fixtures directory; choose a file inside that checkout",
      )
    paths.push(target)
  }
  if (!paths.length || paths.filter((path) => path === "-").length > 1)
    throw new UsageError("Provide at least one file, or '-' once for standard input; see --help")
  const results: InputResult[] = []
  let exitCode = 0
  for (const path of paths) {
    try {
      const report = inspectFdx(await readInput(path), { maxScenes })
      results.push({ input: path, report })
      exitCode = Math.max(
        exitCode,
        !report.ok ? 2 : strict && report.health === "readable_with_warnings" ? 1 : 0,
      )
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined
      const errorCode: InputErrorCode =
        error instanceof InputError
          ? error.code
          : code === "ENOENT"
            ? "file_not_found"
            : code === "EACCES" || code === "EPERM"
              ? "permission_denied"
              : "read_failed"
      results.push({ input: path, error: { code: errorCode, message: INPUT_ERRORS[errorCode] } })
      exitCode = 2
    }
  }
  const batch: InspectionBatch = { schemaVersion: 1, results }
  if (json) process.stdout.write(`${JSON.stringify(batch, null, 2)}\n`)
  else
    process.stdout.write(
      results
        .map(
          (result) =>
            `Input: ${label(result.input)}\n\n` +
            ("report" in result
              ? formatMarkdown(result.report)
              : `# FDX inspection\n\n**${result.error.code}**: ${result.error.message}\n`),
        )
        .join("\n---\n\n"),
    )
  process.exitCode = exitCode
}
main().catch((error: unknown) => {
  process.stderr.write(
    `fdx-inspect: ${error instanceof UsageError ? error.message : "Unexpected failure; report the command and version to the maintainers"}.\n`,
  )
  process.exitCode = 2
})
