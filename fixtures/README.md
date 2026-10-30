# The third signal

`handoff.fdx` is an original synthetic screenplay by Inkwell, released under
this repository's MIT license. Its short scenes demonstrate revision marks,
native dual dialogue, scene numbers, an omitted scene, notes and locked pages.

Expected inventory: 3 scenes, 9 screenplay paragraphs, 2 dialogue paragraphs,
1 dual-dialogue block, 2 revised paragraphs, 1 revision set, 2 locked-page
markers (including 3A), 3 numbered scenes, 2 locked scenes and 1 omitted scene.
The note's paragraph and the title page are not screenplay paragraphs.

Compare the [rendered report](../docs/example-report.md) with the XML. For
isolated edge cases, use [screenplay-interop](https://github.com/inkwell-app/screenplay-interop).

`missing-revision.fdx` is another original Inkwell example under MIT: its Action
references set 9 while only set 1 is defined. `malformed.fdx` is deliberately
unclosed XML. Together they demonstrate warning and unreadable results in the
[CI walkthrough](../docs/cli.md#work-through-a-warning-and-a-failed-batch).
