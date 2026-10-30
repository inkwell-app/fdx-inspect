# Report reference

`inspectFdx(xml, { maxScenes })` returns `schemaVersion: 1`, a health result,
counts, metadata-presence flags, revision accounting, locked-page accounting,
a scene map and findings. `maxScenes` must be an integer from 0 to 10000.
Malformed input returns an unreadable report; invalid API options throw a
`RangeError`. The function does not read files.

## Counting rules

- **Paragraphs:** screenplay `Content/Paragraph` elements, including the
  paragraphs inside native `DualDialogue` wrappers. A wrapper without a type
  is not itself a screenplay paragraph. Title-page and note paragraphs are
  excluded from this count.
- **Scenes:** Scene Heading paragraphs. Each scene starts at its heading and
  ends immediately before the next heading. Paragraphs before the first heading
  contribute to document totals but not to a scene.
- **Dialogue:** Dialogue paragraphs, not spoken words, turns or characters.
- **Revised paragraphs:** paragraphs carrying revision markers or containing
  meaningful revision references. Empty and zero `RevisionID` values on
  paragraphs or text runs mean no revision. IDs are compared after trimming
  whitespace; undefined IDs include the active set, which still names a catalog
  entry even when its ID is zero.
  Duplicate IDs count extra definitions beyond the first.
- **Text runs:** Text nodes beneath screenplay paragraphs, including their
  notes. Text runs are not word counts.
- **Omitted scenes:** headings whose text is `OMITTED` or whose SceneProperties
  explicitly carries a true Omitted attribute.
- **Page markers:** Page entries in LockedPages. Inserted markers match a
  numeric prefix followed by letters, such as `3A`. These are not printed pages.
- **Scene map:** ordinal positions and counts, without scene headings or raw
  scene numbers. Capping the map never caps document totals.

## Field dictionary

| Field | Unit or meaning |
| --- | --- |
| `revisions.sets` | Revision definition elements, including duplicates or missing IDs |
| `revisions.referencedIds` | Distinct IDs referenced by paragraph descendants or ActiveSet |
| `revisions.undefinedIds` | Distinct referenced IDs with no definition |
| `revisions.duplicateIds` | Extra definitions after the first definition for an ID |
| `revisions.missingIds` | Definitions with an empty or absent ID |
| `pages.locked` | Presence of a LockedPages element, not confirmation of an active production lock |
| `pages.markers` / `insertedMarkers` | Page elements / page labels with a letter suffix |
| `metadata.*` | Presence of the named top-level element; its layout/font settings are not validated |
| `scenes[].index` | One-based scene-heading order |
| `scenes[].paragraph` | One-based supported screenplay paragraph position, with dual-dialogue wrappers excluded |
| `scenes[].paragraphs` / `dialogue` | Paragraphs / dialogue paragraphs in that scene, including its heading |
| `scenes[].numbered` / `locked` / `omitted` | Presence of numbering, scene-lock attribute, or an omitted placeholder |

The [sample report](example-report.md) has one revision definition, one distinct
referenced ID and no missing, undefined or duplicate IDs. Its three scene starts
are paragraphs 1, 7 and 8.

`finding.count` uses the affected unit: paragraphs for revisions and unknown
paragraphs; distinct IDs for missing sets; extra definitions for duplicate sets;
definitions for invalid sets; scenes for numbering/omissions; blocks for dual
dialogue; note elements for notes; unsupported elements for unknown elements.
`locked_pages`, `scene_map_truncated`, empty-content and error findings are
occurrence flags with count 1, not a page count or omitted-scene total.

The schema enforces coherent states: readable means `ok: true` with only
informational findings; readable-with-warnings requires a warning and no error;
unreadable means `ok: false` with an error. Counts in an unreadable result are
initialized placeholders, not observations. The Markdown view labels inventory
unavailable rather than displaying those zeros.

## Finding codes

| Code | Severity | Interpretation |
| --- | --- | --- |
| `input_too_large` | error | More than 8 MiB of UTF-8 XML |
| `malformed_xml` | error | XML syntax cannot be read |
| `unsupported_xml` | error | DTD/custom entities or excessive nesting |
| `unsupported_document` | error | Not one FinalDraft Script with one Content |
| `empty_content` | warning | No supported screenplay paragraphs |
| `unknown_elements` | warning | Unsupported containers in screenplay Content |
| `unknown_paragraphs` | warning | Unrecognized paragraph types |
| `missing_revision_sets` | warning | Referenced IDs lack definitions |
| `duplicate_revision_sets` | warning | IDs occur more than once |
| `invalid_revision_sets` | warning | A revision definition has no ID |
| `revisions` | info | Revised paragraphs occur |
| `locked_pages` | info | LockedPages metadata exists |
| `scene_numbers` | info | Scene numbering exists |
| `omitted_scenes` | info | Omitted placeholders exist |
| `dual_dialogue` | info | Native side-by-side dialogue exists |
| `notes` | info | ScriptNote elements exist |
| `scene_map_truncated` | info | Some scene-map entries were omitted by the cap |

Codes and severity belong to the report contract. English descriptions belong
to the formatter. Consumers should branch on codes, not parse formatted text.
Use the JSON schemas for field validation. New report versions will accompany
breaking changes; the package is currently version 0.1.0.

## Coverage and limits

Supported paragraph types include scene heading, action, character, dialogue,
parenthetical, transition, general, shot and lyrics. Types are compared after
trimming and lowercasing. XML element and attribute names remain case-sensitive.

This tool does not certify Final Draft conformance or simulate Inkwell's
importer. It does not calculate rendered pages, identify character-name variants,
inspect embedded media, assess story quality or validate every vendor extension.
Unknown Content containers produce warnings rather than being silently flattened.
Raw XML attributes, title, author and screenplay text are omitted from reports.
There is no option to restore them; use the original FDX when comparing text.

Compare [the original fixture](../fixtures/handoff.fdx) and
[its generated report](example-report.md) for a worked example.
