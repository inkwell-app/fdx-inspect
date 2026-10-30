# CLI guide

Build once with `corepack pnpm build`, then run `node dist/cli.js --help`.

| Option | Behavior |
| --- | --- |
| `--json` | Write a JSON batch envelope to stdout |
| `--markdown` | Write Markdown reports; this is the default |
| `--strict` | Return exit 1 if any readable input has warnings |
| `--max-scenes N` | Include at most N scene-map entries, from 0 to 10000; default 1000 |
| `--fixture ID --fixtures-dir DIR` | Read `DIR/fixtures/ID/input.fdx` from an interop checkout |
| `--version` | Print the package version |
| `--` | Treat remaining arguments as file names, including names beginning with `-` |
| `-` | Read UTF-8 XML from stdin, once per invocation |

Files are processed in argument order. A file error does not stop later inputs.
For JSON, each `results` entry contains `input` and either `report` or `error`.
The `input` field preserves the supplied path (fixture mode uses its resolved
path). Review paths before sharing a batch report. Markdown separates reports
with horizontal rules in the same order as the supplied files, with an escaped
input label above every report. File errors expose `error.code` and
`error.message`: branch on the code, not the English message.

| File-error code | Meaning |
| --- | --- |
| `file_not_found` | Input path does not exist |
| `permission_denied` | The process cannot read the path |
| `not_regular_file` | A directory or other non-file input was supplied |
| `input_too_large` | Input exceeded 8 MiB |
| `invalid_encoding` | Input is not valid UTF-8 |
| `read_failed` | Another read failure occurred |

For installed-package integrations, import the `InspectionBatch`, `InputResult`
and `InputErrorCode` TypeScript types from `@inkwell/fdx-inspect`. The schemas
are exported at `@inkwell/fdx-inspect/schema` and `@inkwell/fdx-inspect/batch-schema`.

## Add a check to CI

After installing and building this checkout:

```sh
node /path/to/fdx-inspect/dist/cli.js --strict --json scripts/*.fdx > fdx-report.json
```

Have your CI retain `fdx-report.json` even when the command fails. A warning
means review is needed, not that the file cannot be opened. Set your own policy
by reading finding codes from JSON if `--strict` is too broad for your workflow.

## Work through a warning and a failed batch

The original `fixtures/missing-revision.fdx` points at revision set 9 but defines
only set 1. Run:

```sh
node dist/cli.js --strict --json fixtures/missing-revision.fdx > warning.json
# Exit 1; the report contains missing_revision_sets with count 1.

node dist/cli.js --strict --json fixtures/handoff.fdx fixtures/missing-revision.fdx fixtures/malformed.fdx > batch.json
# Exit 2; all three results remain in the JSON, in that order.

node dist/example-policy.js batch.json
# Exit 1; unreadable files and missing revision definitions block this handoff.
```

For the warning, restore the missing revision definition in the source
application or export a corrected file. For the malformed example, export valid
FDX. Re-run the same command and compare the finding codes.

The [example policy](https://github.com/inkwell-app/fdx-inspect/blob/main/src/example-policy.ts) always rejects unreadable/file-error
results and blocks missing, duplicate or empty revision definitions. Other
readable findings are left for a manual check. This is a sample handoff policy,
not a claim that every workflow should use the same rules.

In GitHub Actions, after checkout, install and build, retain the artifact even
when the inspection step fails:

```yaml
- name: Inspect handoff
  run: node dist/cli.js --strict --json fixtures/missing-revision.fdx > fdx-report.json
- name: Save report
  if: always()
  uses: actions/upload-artifact@v4
  with:
    name: fdx-report
    path: fdx-report.json
    if-no-files-found: error
```

Use your own file paths in production. The inspection step remains failed;
`always()` ensures the report is available for diagnosis.

## Diagnose an error

- **File not found:** check the path and your current directory.
- **Expected UTF-8 XML:** use Final Draft's FDX export; PDF, ZIP and legacy FDR
  files are different formats.
- **Input too large:** the limit is 8 MiB per file, including stdin. A batch can
  contain multiple files within that limit.
- **Unsupported XML:** DTD/custom entity declarations and nesting beyond 128
  levels are outside the supported format.
- **Unknown option or fixture:** use `--help`; pass the interop checkout root,
  not its `fixtures` subdirectory. Fixture IDs cannot contain path separators.

The full [report reference](report.md) explains findings and counting rules.
