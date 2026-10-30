import { XMLParser, XMLValidator } from "fast-xml-parser"

export type { InputErrorCode, InputResult, InspectionBatch } from "./batch.js"
export { INPUT_ERRORS } from "./batch.js"

export const MAX_BYTES = 8 * 1024 * 1024
const MAX_DEPTH = 128
export const FINDINGS = {
  input_too_large: ["error", "File exceeds the 8 MiB inspection limit."],
  malformed_xml: ["error", "XML is not well formed. Export a fresh FDX file and try again."],
  unsupported_xml: [
    "error",
    "DTD declarations, custom entities and deeply nested XML are unsupported.",
  ],
  unsupported_document: [
    "error",
    "Expected one FinalDraft Script document with one Content element.",
  ],
  empty_content: ["warning", "No screenplay paragraphs were found."],
  unknown_elements: [
    "warning",
    "Content contains elements outside the supported paragraph and dual-dialogue structure.",
  ],
  unknown_paragraphs: [
    "warning",
    "Some paragraph types need a manual check in the receiving application.",
  ],
  revisions: [
    "info",
    "Revision marks are present. Compare revision colors and marks after import.",
  ],
  missing_revision_sets: ["warning", "Revision references have no matching revision set."],
  duplicate_revision_sets: ["warning", "Revision set IDs are duplicated."],
  invalid_revision_sets: ["warning", "Some revision sets have no ID."],
  locked_pages: [
    "info",
    "Locked-page metadata is present. Compare page labels against the production PDF.",
  ],
  scene_numbers: ["info", "Scene numbers are present. Compare numbering after import."],
  omitted_scenes: [
    "info",
    "Omitted scene placeholders are present. Keep their numbering in the handoff.",
  ],
  dual_dialogue: ["info", "Dual dialogue is present. Check side-by-side layout after import."],
  notes: ["info", "Script notes are present. Check the receiving application's note support."],
  scene_map_truncated: [
    "info",
    "The scene map was capped; document totals still cover the whole file.",
  ],
} as const
export type FindingCode = keyof typeof FINDINGS
export interface Finding {
  code: FindingCode
  severity: "info" | "warning" | "error"
  count: number
}
export interface SceneSummary {
  index: number
  paragraph: number
  paragraphs: number
  dialogue: number
  numbered: boolean
  locked: boolean
  omitted: boolean
}
export interface InspectionReport {
  schemaVersion: 1
  ok: boolean
  health: "readable" | "readable_with_warnings" | "unreadable"
  counts: {
    paragraphs: number
    scenes: number
    action: number
    character: number
    dialogue: number
    parenthetical: number
    transition: number
    unknown: number
    dualDialogue: number
    notes: number
    pageBreaks: number
    revisedParagraphs: number
    numberedScenes: number
    lockedScenes: number
    omittedScenes: number
    textRuns: number
  }
  metadata: {
    titlePage: boolean
    pageLayout: boolean
    fontSpec: boolean
    moresAndContinueds: boolean
  }
  revisions: {
    sets: number
    referencedIds: number
    undefinedIds: number
    duplicateIds: number
    missingIds: number
  }
  pages: { locked: boolean; markers: number; insertedMarkers: number }
  scenes: SceneSummary[]
  sceneMapTruncated: boolean
  findings: Finding[]
}

// This boundary owns the parser's preserveOrder representation. No private importer types.
type XmlNode = Record<string, unknown>
const element = (node: XmlNode): string => Object.keys(node).find((key) => key !== ":@") ?? ""
const children = (node: XmlNode): XmlNode[] => {
  const value = node[element(node)]
  return Array.isArray(value) ? (value as XmlNode[]) : []
}
const attr = (node: XmlNode, name: string): string => {
  const attrs = node[":@"] as Record<string, unknown> | undefined
  const value = attrs?.[`@_${name}`]
  return typeof value === "string" ? value : ""
}
const yes = (value: string): boolean => /^(yes|true|1)$/i.test(value)
const direct = (nodes: XmlNode[], name: string): XmlNode[] =>
  nodes.filter((node) => element(node) === name)
function* walk(nodes: XmlNode[]): Generator<XmlNode> {
  for (const node of nodes) {
    yield node
    yield* walk(children(node))
  }
}
const words = (nodes: XmlNode[]): string =>
  nodes
    .map((node) =>
      element(node) === "#text"
        ? String(node["#text"])
        : element(node) === "ScriptNote"
          ? ""
          : words(children(node)),
    )
    .join("")

/** Inventory XML signals. This is not an import simulation, paginator or quality score. */
export function inspectFdx(xml: string, options: { maxScenes?: number } = {}): InspectionReport {
  const maxScenes = options.maxScenes ?? 1000
  if (!Number.isSafeInteger(maxScenes) || maxScenes < 0 || maxScenes > 10000)
    throw new RangeError("maxScenes must be an integer from 0 to 10000")
  const report: InspectionReport = {
    schemaVersion: 1,
    ok: true,
    health: "readable",
    counts: {
      paragraphs: 0,
      scenes: 0,
      action: 0,
      character: 0,
      dialogue: 0,
      parenthetical: 0,
      transition: 0,
      unknown: 0,
      dualDialogue: 0,
      notes: 0,
      pageBreaks: 0,
      revisedParagraphs: 0,
      numberedScenes: 0,
      lockedScenes: 0,
      omittedScenes: 0,
      textRuns: 0,
    },
    metadata: { titlePage: false, pageLayout: false, fontSpec: false, moresAndContinueds: false },
    revisions: { sets: 0, referencedIds: 0, undefinedIds: 0, duplicateIds: 0, missingIds: 0 },
    pages: { locked: false, markers: 0, insertedMarkers: 0 },
    scenes: [],
    sceneMapTruncated: false,
    findings: [],
  }
  const add = (code: FindingCode, count = 1): void => {
    if (count > 0) report.findings.push({ code, severity: FINDINGS[code][0], count })
  }
  const fail = (code: FindingCode): InspectionReport => {
    add(code)
    report.ok = false
    report.health = "unreadable"
    return report
  }
  if (Buffer.byteLength(xml, "utf8") > MAX_BYTES) return fail("input_too_large")
  // Remove literal/comment regions before inspecting markup declarations or nesting.
  const markup = xml.replace(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>/g, "")
  if (/<!\s*(DOCTYPE|ENTITY)\b/i.test(markup)) return fail("unsupported_xml")
  // XMLValidator permits undeclared references. Only XML's predefined entities
  // and legal character references are valid without a DTD.
  const entityMarkup = markup.replace(/<\?[\s\S]*?\?>/g, "")
  const validCharacter = (code: number): boolean =>
    code === 9 ||
    code === 10 ||
    code === 13 ||
    (code >= 0x20 && code <= 0xd7ff) ||
    (code >= 0xe000 && code <= 0xfffd) ||
    (code >= 0x10000 && code <= 0x10ffff)
  let invalidReference = false
  const withoutReferences = entityMarkup.replace(
    /&(?:amp|lt|gt|apos|quot|#\d+|#x[\da-fA-F]+);/g,
    (reference) => {
      if (reference.startsWith("&#")) {
        const code = reference.startsWith("&#x")
          ? Number.parseInt(reference.slice(3, -1), 16)
          : Number(reference.slice(2, -1))
        if (!validCharacter(code)) invalidReference = true
      }
      return ""
    },
  )
  if (invalidReference || withoutReferences.includes("&")) return fail("malformed_xml")
  for (const character of xml) {
    if (!validCharacter(character.codePointAt(0) ?? 0)) return fail("malformed_xml")
  }
  let depth = 0
  for (const match of markup.matchAll(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g)) {
    const tag = match[0]
    if (tag.startsWith("<?") || tag.startsWith("<!")) continue
    if (tag.startsWith("</")) depth--
    else if (!tag.endsWith("/>")) depth++
    if (depth > MAX_DEPTH) return fail("unsupported_xml")
  }
  if (XMLValidator.validate(xml) !== true) return fail("malformed_xml")
  let nodes: XmlNode[]
  try {
    nodes = new XMLParser({
      preserveOrder: true,
      ignoreAttributes: false,
      // Numeric decoding is opt-in via htmlEntities in this dependency. The
      // reference check above still admits only XML entities and legal numbers.
      parseTagValue: false,
      parseAttributeValue: false,
      processEntities: true,
      htmlEntities: true,
      ignoreDeclaration: true,
      ignorePiTags: true,
      trimValues: false,
    }).parse(xml) as XmlNode[]
  } catch {
    return fail("malformed_xml")
  }
  const roots = nodes.filter((node) => !element(node).startsWith("#"))
  const root = roots[0]
  if (
    roots.length !== 1 ||
    !root ||
    element(root) !== "FinalDraft" ||
    attr(root, "DocumentType") !== "Script"
  )
    return fail("unsupported_document")
  const rootChildren = children(root)
  const content = direct(rootChildren, "Content")
  if (content.length !== 1) return fail("unsupported_document")
  const contentNode = content[0]
  if (!contentNode) return fail("unsupported_document")
  report.metadata = {
    titlePage: direct(rootChildren, "TitlePage").length > 0,
    pageLayout: direct(rootChildren, "PageLayout").length > 0,
    fontSpec: direct(rootChildren, "FontSpec").length > 0,
    moresAndContinueds: direct(rootChildren, "MoresAndContinueds").length > 0,
  }
  const sets = direct(rootChildren, "Revisions").flatMap((node) =>
    direct(children(node), "Revision"),
  )
  const ids = new Set<string>()
  report.revisions.sets = sets.length
  for (const set of sets) {
    const id = attr(set, "ID").trim()
    if (!id) report.revisions.missingIds++
    else if (ids.has(id)) report.revisions.duplicateIds++
    else ids.add(id)
  }
  const referenced = new Set<string>()
  for (const revision of direct(rootChildren, "Revisions")) {
    const id = attr(revision, "ActiveSet").trim()
    if (id) referenced.add(id)
  }
  const locked = direct(rootChildren, "LockedPages")
  const pages = locked.flatMap((node) => direct(children(node), "Page"))
  report.pages = {
    locked: locked.length > 0,
    markers: pages.length,
    insertedMarkers: pages.filter((node) => /^\d+[A-Za-z]+$/.test(attr(node, "Number"))).length,
  }
  let scene: SceneSummary | undefined
  let unknownElements = 0
  const countParagraph = (paragraph: XmlNode): void => {
    const ownChildren = children(paragraph).filter((node) => element(node) !== "DualDialogue")
    const duals = direct(children(paragraph), "DualDialogue")
    if (
      duals.length &&
      !attr(paragraph, "Type") &&
      !ownChildren.some((node) => element(node) !== "#text")
    ) {
      for (const dual of duals) {
        report.counts.dualDialogue++
        visitContent(children(dual))
      }
      return
    }
    report.counts.paragraphs++
    const type = attr(paragraph, "Type").trim().toLowerCase()
    const descendants = [...walk(ownChildren)]
    const properties = direct(children(paragraph), "SceneProperties")[0]
    if (type === "scene heading") {
      const numbered =
        Boolean(properties && attr(properties, "Number")) || Boolean(attr(paragraph, "Number"))
      const lockedScene = Boolean(properties && yes(attr(properties, "Locked")))
      const omitted =
        Boolean(properties && yes(attr(properties, "Omitted"))) ||
        words(ownChildren).trim().toUpperCase() === "OMITTED"
      report.counts.scenes++
      if (numbered) report.counts.numberedScenes++
      if (lockedScene) report.counts.lockedScenes++
      if (omitted) report.counts.omittedScenes++
      scene = {
        index: report.counts.scenes,
        paragraph: report.counts.paragraphs,
        paragraphs: 0,
        dialogue: 0,
        numbered,
        locked: lockedScene,
        omitted,
      }
      if (report.scenes.length < maxScenes) report.scenes.push(scene)
    } else if (
      type === "action" ||
      type === "character" ||
      type === "dialogue" ||
      type === "parenthetical" ||
      type === "transition"
    )
      report.counts[type]++
    else if (type !== "general" && type !== "shot" && type !== "lyrics") report.counts.unknown++
    if (scene) {
      scene.paragraphs++
      if (type === "dialogue") scene.dialogue++
    }
    const all = [paragraph, ...descendants]
    let revised = false
    for (const node of all) {
      const id = attr(node, "RevisionID").trim()
      // Zero on a paragraph or text run means no revision, not a catalog reference.
      if (id && id !== "0") {
        referenced.add(id)
        revised = true
      }
      if (attr(node, "Revised") || yes(attr(node, "Revision"))) revised = true
      if (element(node) === "ScriptNote") report.counts.notes++
      if (element(node) === "Text") report.counts.textRuns++
    }
    if (revised) report.counts.revisedParagraphs++
    if (yes(attr(paragraph, "StartsNewPage"))) report.counts.pageBreaks++
    // Native FDX nests the two columns beneath a wrapper Paragraph.
    for (const dual of duals) {
      report.counts.dualDialogue++
      visitContent(children(dual))
    }
  }
  const visitContent = (items: XmlNode[]): void => {
    for (const node of items) {
      const name = element(node)
      if (name === "Paragraph") countParagraph(node)
      else if (name === "DualDialogue") {
        report.counts.dualDialogue++
        visitContent(children(node))
      } else if (name === "#text" && !words([node]).trim()) continue
      else unknownElements++
    }
  }
  visitContent(children(contentNode))
  report.revisions.referencedIds = referenced.size
  report.revisions.undefinedIds = [...referenced].filter((id) => !ids.has(id)).length
  report.sceneMapTruncated = report.scenes.length < report.counts.scenes
  if (!report.counts.paragraphs) add("empty_content")
  add("unknown_elements", unknownElements)
  add("unknown_paragraphs", report.counts.unknown)
  add("revisions", report.counts.revisedParagraphs)
  add("missing_revision_sets", report.revisions.undefinedIds)
  add("duplicate_revision_sets", report.revisions.duplicateIds)
  add("invalid_revision_sets", report.revisions.missingIds)
  if (report.pages.locked) add("locked_pages")
  add("scene_numbers", report.counts.numberedScenes)
  add("omitted_scenes", report.counts.omittedScenes)
  add("dual_dialogue", report.counts.dualDialogue)
  add("notes", report.counts.notes)
  if (report.sceneMapTruncated) add("scene_map_truncated")
  if (report.findings.some((finding) => finding.severity === "warning"))
    report.health = "readable_with_warnings"
  return report
}

export function formatMarkdown(report: InspectionReport): string {
  const c = report.counts
  const findings = [
    "## Findings",
    "",
    ...(report.findings.length
      ? report.findings.map(
          (finding) =>
            `- **${finding.severity} · ${finding.code}** (${finding.count}): ${FINDINGS[finding.code][1]}`,
        )
      : ["No findings in the supported checks."]),
    "",
  ]
  const header = ["# FDX inspection", "", `Status: **${report.health.replaceAll("_", " ")}**`, ""]
  if (!report.ok)
    return [
      ...header,
      "Inventory unavailable: the input could not be inspected.",
      "",
      ...findings,
    ].join("\n")
  const rows = report.scenes.map(
    (scene) =>
      `| ${scene.index} | ${scene.paragraph} | ${scene.paragraphs} | ${scene.dialogue} | ${[scene.numbered && "numbered", scene.locked && "locked", scene.omitted && "omitted"].filter(Boolean).join(", ") || "—"} |`,
  )
  const map = !c.scenes
    ? ["No scene headings were found."]
    : !rows.length
      ? [`Scene map omitted by the configured cap. Document totals include all ${c.scenes} scenes.`]
      : [
          `Showing ${rows.length} of ${c.scenes} scenes.`,
          "",
          "| Scene | Start paragraph | Paragraphs | Dialogue | Signals |",
          "| --- | --- | --- | --- | --- |",
          ...rows,
        ]
  return [
    ...header,
    `${c.scenes} scenes · ${c.paragraphs} paragraphs · ${c.dialogue} dialogue paragraphs`,
    "",
    `Revision sets: ${report.revisions.sets} · Revised paragraphs: ${c.revisedParagraphs} · Locked-page markers: ${report.pages.markers}`,
    "",
    ...findings,
    "## Scene map",
    "",
    ...map,
    "",
    "Counts describe XML structure, not printed page count or import fidelity.",
    "",
  ].join("\n")
}
