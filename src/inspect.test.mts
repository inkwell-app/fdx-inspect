import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { test } from "node:test"
import { Ajv } from "ajv"
import { formatMarkdown, inspectFdx, MAX_BYTES } from "./inspect.js"

const doc = (body: string, extra = "") =>
  `<FinalDraft DocumentType="Script"><Content>${body}</Content>${extra}</FinalDraft>`
const p = (type: string, text = "Example", attrs = "") =>
  `<Paragraph Type="${type}" ${attrs}><Text>${text}</Text></Paragraph>`
const sample = readFileSync("fixtures/handoff.fdx", "utf8")
const ajv = new Ajv({ strict: true })
const schema = JSON.parse(readFileSync("schemas/report.schema.json", "utf8"))
const validate = ajv.compile(schema)
const validateBatch = ajv.compile(JSON.parse(readFileSync("schemas/batch.schema.json", "utf8")))
const cli = (...args: string[]) =>
  spawnSync(process.execPath, ["dist/cli.js", ...args], { encoding: "utf8" })

test("inventories native dual dialogue, notes and title pages without counting nested prose twice", () => {
  const report = inspectFdx(sample)
  assert.equal(report.ok, true)
  assert.deepEqual(report.counts, {
    paragraphs: 9,
    scenes: 3,
    action: 2,
    character: 2,
    dialogue: 2,
    parenthetical: 0,
    transition: 0,
    unknown: 0,
    dualDialogue: 1,
    notes: 1,
    pageBreaks: 1,
    revisedParagraphs: 2,
    numberedScenes: 3,
    lockedScenes: 2,
    omittedScenes: 1,
    textRuns: 10,
  })
  assert.deepEqual(
    report.scenes.map((s) => s.paragraphs),
    [6, 1, 2],
  )
  assert.deepEqual(report.pages, { locked: true, markers: 2, insertedMarkers: 1 })
  assert.equal(report.health, "readable")
  assert.equal(validate(report), true, JSON.stringify(validate.errors))
})
test("heading classification excludes attached note prose while retaining note inventory", () => {
  const report = inspectFdx(
    doc(
      '<Paragraph Type="Scene Heading"><Text>OMIT</Text><ScriptNote><Paragraph Type="Action"><Text>Keep numbering.</Text></Paragraph></ScriptNote><Text>TED</Text></Paragraph>',
    ),
  )
  assert.equal(report.counts.omittedScenes, 1)
  assert.equal(report.scenes[0]?.omitted, true)
  assert.equal(report.counts.paragraphs, 1)
  assert.equal(report.counts.notes, 1)
  assert.equal(report.counts.textRuns, 3)
  assert.ok(report.findings.some((finding) => finding.code === "omitted_scenes"))
  assert.equal(validate(report), true, JSON.stringify(validate.errors))
})
test("reports never contain screenplay, title, note, character or arbitrary attribute values", () => {
  const sentinel = "PRIVATE_SCRIPT_SENTINEL"
  const report = inspectFdx(
    doc(
      p(sentinel, sentinel, `RevisionID="${sentinel}"`),
      `<TitlePage>${p("General", sentinel)}</TitlePage><Revisions><Revision ID="${sentinel}" Name="${sentinel}"/></Revisions>`,
    ),
  )
  assert.ok(!JSON.stringify(report).includes(sentinel))
  assert.ok(!formatMarkdown(report).includes(sentinel))
})
test("finds missing, duplicate and empty revision IDs including text-run and active-set references", () => {
  const report = inspectFdx(
    doc(
      '<Paragraph Type="Action"><Text RevisionID="2">Changed.</Text></Paragraph>',
      '<Revisions ActiveSet="3"><Revision ID="1"/><Revision ID="1"/><Revision/></Revisions>',
    ),
  )
  assert.deepEqual(report.revisions, {
    sets: 3,
    referencedIds: 2,
    undefinedIds: 2,
    duplicateIds: 1,
    missingIds: 1,
  })
  assert.equal(report.health, "readable_with_warnings")
})
test("unrevised paragraph and run sentinels pass library, strict CLI and handoff policy", () => {
  for (const id of ["0", " 0 ", "&#48;", "", " "]) {
    const report = inspectFdx(
      doc(
        `<Paragraph Type="Action" RevisionID="${id}"><Text RevisionID="${id}">Original.</Text></Paragraph>`,
      ),
    )
    assert.equal(report.counts.revisedParagraphs, 0, id)
    assert.equal(report.revisions.referencedIds, 0, id)
    assert.equal(report.revisions.undefinedIds, 0, id)
    assert.equal(report.health, "readable", id)
    assert.equal(validate(report), true, JSON.stringify(validate.errors))
  }
  const directory = mkdtempSync(join(tmpdir(), "fdx-unrevised-"))
  try {
    const result = spawnSync(process.execPath, ["dist/cli.js", "--strict", "--json", "-"], {
      input: doc(
        '<Paragraph Type="Action" RevisionID="0"><Text RevisionID="0">Original.</Text></Paragraph>',
      ),
      encoding: "utf8",
    })
    assert.equal(result.status, 0, result.stderr)
    const path = join(directory, "batch.json")
    writeFileSync(path, result.stdout)
    assert.equal(spawnSync(process.execPath, ["dist/example-policy.js", path]).status, 0)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
test("zero run IDs do not hide real revision markers, definitions or active-set references", () => {
  const report = inspectFdx(
    doc(
      '<Paragraph Type="Action" RevisionID="0"><Text RevisionID=" 2 ">Changed.</Text></Paragraph>' +
        '<Paragraph Type="Action" RevisionID=" 3 "><Text RevisionID="0">Missing definition.</Text></Paragraph>' +
        '<Paragraph Type="Action" RevisionID="0" Revised="Yes"><Text RevisionID="0">Marked.</Text></Paragraph>',
      '<Revisions ActiveSet=" 0 "><Revision ID="0"/><Revision ID=" 2 "/></Revisions>',
    ),
  )
  assert.equal(report.counts.revisedParagraphs, 3)
  assert.deepEqual(report.revisions, {
    sets: 2,
    referencedIds: 3,
    undefinedIds: 1,
    duplicateIds: 0,
    missingIds: 0,
  })
  assert.equal(report.health, "readable_with_warnings")
  assert.equal(validate(report), true, JSON.stringify(validate.errors))
})
test("caps scene maps without capping aggregate counts or subsequent scene accounting", () => {
  const report = inspectFdx(sample, { maxScenes: 1 })
  assert.equal(report.scenes.length, 1)
  assert.equal(report.scenes[0]?.paragraphs, 6)
  assert.equal(report.counts.scenes, 3)
  assert.equal(report.sceneMapTruncated, true)
  assert.equal(inspectFdx(sample, { maxScenes: 0 }).scenes.length, 0)
  for (const maxScenes of [-1, 0.5, NaN, 10001])
    assert.throws(() => inspectFdx(sample, { maxScenes }))
})
test("rejects malformed, multi-root, wrong document and repeated Content rather than reporting a clean file", () => {
  for (const xml of [
    "",
    "<broken>",
    doc(p("Action")) + doc(""),
    '<FinalDraft DocumentType="Novel"><Content/></FinalDraft>',
    '<FinalDraft DocumentType="Script"><Content/><Content/></FinalDraft>',
  ]) {
    const report = inspectFdx(xml)
    assert.equal(report.ok, false, xml)
    assert.equal(validate(report), true, JSON.stringify(validate.errors))
  }
})
test("rejects DTD, entity declarations, excessive nesting and oversized input", () => {
  for (const xml of [
    '<!DOCTYPE FinalDraft [<!ENTITY name "expanded">]>' + doc(p("Action", "&name;")),
    doc("<x>".repeat(130) + "</x>".repeat(130)),
    " ".repeat(MAX_BYTES + 1),
  ]) {
    assert.equal(inspectFdx(xml).ok, false)
  }
  assert.equal(inspectFdx(doc(p("Action", "<![CDATA[<!DOCTYPE literal>]]>"))).ok, true)
})
test("size limits reject otherwise valid XML in the library and on stdin", () => {
  const large = doc(p("Action", "x".repeat(MAX_BYTES)))
  assert.equal(inspectFdx(large).findings[0]?.code, "input_too_large")
  const result = spawnSync(process.execPath, ["dist/cli.js", "--json", "-"], {
    input: large,
    encoding: "utf8",
  })
  assert.equal(result.status, 2)
  assert.equal(JSON.parse(result.stdout).results[0].error.code, "input_too_large")
})
test("unknown wrappers and paragraph types warn; empty content is readable with warnings", () => {
  assert.equal(
    inspectFdx(doc("<Unexpected/>" + p("Custom"))).findings.filter((f) => f.severity === "warning")
      .length,
    2,
  )
  assert.equal(inspectFdx(doc("")).health, "readable_with_warnings")
  assert.equal(inspectFdx(doc(p("Action", "A &amp; B."))).ok, true)
})
test("CLI JSON schema, stdin, batch failures and strict exit codes are useful in CI", () => {
  const normal = cli("--json", "fixtures/handoff.fdx")
  assert.equal(normal.status, 0, normal.stderr)
  assert.equal(validateBatch(JSON.parse(normal.stdout)), true, JSON.stringify(validateBatch.errors))
  const batch = cli("--json", "fixtures/handoff.fdx", "missing.fdx")
  assert.equal(batch.status, 2)
  assert.equal(JSON.parse(batch.stdout).results.length, 2)
  const stdin = spawnSync(process.execPath, ["dist/cli.js", "--strict", "--json", "-"], {
    input: doc(p("Custom")),
    encoding: "utf8",
  })
  assert.equal(stdin.status, 1)
  assert.equal(validateBatch(JSON.parse(stdin.stdout)), true)
  const malformed = spawnSync(process.execPath, ["dist/cli.js", "--json", "-"], {
    input: "<broken>",
    encoding: "utf8",
  })
  assert.equal(malformed.status, 2)
  for (const args of [
    [],
    ["--max-scenes", "-1", "fixtures/handoff.fdx"],
    ["--no-redact"],
    ["-", "-"],
  ])
    assert.equal(cli(...args).status, 2)
})
test("fixture paths stay inside the chosen checkout and inspect the actual file", () => {
  const root = mkdtempSync(join(tmpdir(), "fdx-fixture-"))
  try {
    mkdirSync(join(root, "fixtures/good"), { recursive: true })
    writeFileSync(join(root, "fixtures/good/input.fdx"), sample)
    assert.equal(cli("--fixture", "good", "--fixtures-dir", root).status, 0)
    mkdirSync(join(root, "outside"))
    writeFileSync(join(root, "outside/input.fdx"), sample)
    symlinkSync(join(root, "outside"), join(root, "fixtures/escape"))
    assert.equal(cli("--fixture", "escape", "--fixtures-dir", root).status, 2)
    assert.equal(cli("--fixture", "../outside", "--fixtures-dir", root).status, 2)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
test("schema rejects accidental raw text, negative counts and contradictory finding severity", () => {
  const report = inspectFdx(sample)
  assert.equal(validate({ ...report, title: "unexpected" }), false)
  assert.equal(validate({ ...report, counts: { ...report.counts, scenes: -1 } }), false)
  assert.equal(
    validate({ ...report, findings: [{ code: "locked_pages", severity: "error", count: 1 }] }),
    false,
  )
  assert.equal(validate({ ...report, health: "unreadable", findings: [] }), false)
  assert.equal(validate({ ...report, health: "readable_with_warnings", findings: [] }), false)
  assert.equal(validate({ ...report, ok: false }), false)
  assert.equal(
    validate({
      ...report,
      findings: [{ code: "missing_revision_sets", severity: "warning", count: 1 }],
    }),
    false,
  )
})
test("entity validity covers text, attributes, legal character references and literal regions", () => {
  for (const text of ["&private;", "&bare", "&#0;", "&#xD800;", "&#x110000;", "&#65535;", "\u0000"])
    assert.equal(inspectFdx(doc(p("Action", text))).ok, false, text)
  assert.equal(inspectFdx(doc(p("Action", "valid", 'RevisionID="&private;"'))).ok, false)
  for (const text of [
    "A &amp; B &lt; C",
    "&#65;&#x1F600;",
    "<![CDATA[&private;]]>",
    "<!-- &private; -->Text",
  ])
    assert.equal(inspectFdx(doc(p("Action", text))).ok, true, text)
  assert.equal(inspectFdx(doc(p("Scene Heading", "&#79;MITTED"))).counts.omittedScenes, 1)
})
test("Markdown distinguishes unreadable, absent, omitted and partially capped maps", () => {
  const failed = formatMarkdown(inspectFdx("<broken>"))
  assert.match(failed, /Inventory unavailable/)
  assert.ok(!failed.includes("0 scenes"))
  assert.match(formatMarkdown(inspectFdx(doc(p("Action")))), /No scene headings/)
  assert.match(formatMarkdown(inspectFdx(sample, { maxScenes: 0 })), /Scene map omitted/)
  assert.match(formatMarkdown(inspectFdx(sample, { maxScenes: 1 })), /Showing 1 of 3 scenes/)
})
test("CLI preserves file identity, machine errors and actionable usage diagnostics", () => {
  const result = spawnSync(
    process.execPath,
    ["dist/cli.js", "fixtures/handoff.fdx", "missing.fdx", "-"],
    { encoding: "utf8", input: doc(p("Action")) },
  )
  assert.equal(result.status, 2)
  for (const input of ["fixtures/handoff.fdx", "missing.fdx", "standard input"])
    assert.ok(result.stdout.includes(input))
  assert.match(
    cli("--max-scenes", "10001", "fixtures/handoff.fdx").stderr,
    /--max-scenes.*0 to 10000/,
  )
  assert.match(cli("--max-scenes").stderr, /Missing value for --max-scenes/)
  assert.match(
    cli("--fixture", "absent", "--fixtures-dir", "/does-not-exist").stderr,
    /CHECKOUT\/fixtures\/ID\/input.fdx/,
  )
  const invalid = spawnSync(process.execPath, ["dist/cli.js", "--json", "-"], {
    input: Buffer.from([0xff]),
    encoding: "utf8",
  })
  assert.equal(JSON.parse(invalid.stdout).results[0].error.code, "invalid_encoding")
  assert.equal(validateBatch(JSON.parse(invalid.stdout)), true)
  assert.equal(
    JSON.parse(cli("--json", "fixtures").stdout).results[0].error.code,
    "not_regular_file",
  )
  const escaped = cli("<b>unsafe`[link](url)\n.fdx")
  assert.ok(!escaped.stdout.includes("<b>"))
  assert.ok(!escaped.stdout.includes("\n.fdx"))
})
test("published warning and mixed-batch walkthrough exercises the handoff policy", () => {
  const warning = cli("--strict", "--json", "fixtures/missing-revision.fdx")
  assert.equal(warning.status, 1)
  assert.equal(JSON.parse(warning.stdout).results[0].report.revisions.undefinedIds, 1)
  const batch = cli(
    "--strict",
    "--json",
    "fixtures/handoff.fdx",
    "fixtures/missing-revision.fdx",
    "fixtures/malformed.fdx",
  )
  assert.equal(batch.status, 2)
  assert.equal(validateBatch(JSON.parse(batch.stdout)), true)
  const directory = mkdtempSync(join(tmpdir(), "fdx-policy-"))
  try {
    const path = join(directory, "batch.json")
    writeFileSync(path, batch.stdout)
    assert.equal(spawnSync(process.execPath, ["dist/example-policy.js", path]).status, 1)
    writeFileSync(path, cli("--json", "fixtures/handoff.fdx").stdout)
    assert.equal(spawnSync(process.execPath, ["dist/example-policy.js", path]).status, 0)
    writeFileSync(path, cli("--json", "missing.fdx").stdout)
    assert.equal(spawnSync(process.execPath, ["dist/example-policy.js", path]).status, 1)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
