# Contribute to FDX Inspect

Useful contributions start with a file and a result: a structural signal we
missed, an incorrect count, a clearer finding, or a workflow that needs support.

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm check:generated
```

Add a focused behavioral test with each parser or CLI change. Keep examples
small and original; include the creator and license when adding a fixture.
The build compiles and typechecks the implementation, tests and helpers. Run
`pnpm build` before invoking a `check:` or `smoke:` script directly.
For a report defect, use the **Incorrect report** issue form. For a new workflow,
use **Feature request**. For a new edge case, use **Fixture proposal**.

Reports use structural counts and positions. A reproduction should demonstrate
the shape that fails without requiring a full screenplay. Attach only material
you are entitled to publish. For vulnerabilities, follow [SECURITY.md](SECURITY.md).

After changing report fields or the sample fixture, run `pnpm generate` and
review the generated schemas and example report. Keep changes to public finding
codes explicit in your PR. Run `pnpm smoke:package` before release-related work;
it installs the tarball into a fresh consumer and exercises the CLI and library.

Maintainers review changes for correct counts, useful output, source credit and
clear documentation. We use squash merges. Our [code of conduct](CODE_OF_CONDUCT.md)
applies to issues, pull requests and discussions about the project.
