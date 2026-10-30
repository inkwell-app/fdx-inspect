# Sources and credits

- **FDX Inspect:** original implementation, documentation, sample screenplay
  and graphics by Inkwell. MIT license; see [LICENSE](../LICENSE).
- **fast-xml-parser:** XML parsing and syntax validation by Amit Kumar Gupta
  and contributors. MIT license. [Source](https://github.com/NaturalIntelligence/fast-xml-parser).
- **screenplay-interop:** original test files by Inkwell, MIT license. Used as
  an external interoperability corpus; files are not bundled here.
  [Source](https://github.com/inkwell-app/screenplay-interop).
  CI fetches the exact commit in [the source pin](https://github.com/inkwell-app/fdx-inspect/blob/main/.github/interop-source.json)
  and compares health and identically defined count units across its FDX files.
  Run `pnpm check:interop` after building to repeat that networked check.
- **Contributor Covenant:** the community code of conduct follows version 2.1,
  licensed CC BY 4.0. Attribution and links appear in
  [CODE_OF_CONDUCT.md](../CODE_OF_CONDUCT.md).

Final Draft's [version 13 user guide](https://www.finaldraft.com/downloads/manuals/fd13-user-guide-win-exported.pdf)
describes production features such as revision sets and locked pages. This
project's executable tests define its supported XML observations; it does not
claim vendor certification or a complete specification of FDX.
