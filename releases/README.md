# Spoke Release Notes

Write each release once in `changelog.json`. The tag workflow validates the entry before building, then publishes its Markdown to GitHub after signing, notarization, and updater assets succeed. The website reads that public release feed; it needs no token, webhook, or second content edit.

## Write an entry

Add the next version at the top of the catalog before `npm version patch`:

- `version`: the exact app version, without `v`.
- `headline`: Title Case; focus on the main user benefit. Prefer a relevant, restrained pop culture reference.
- `summary`: one or two professional, friendly sentences about what users get.
- `items`: `new`, then `improved`, then `performance`, then `fixed`. Use clear, specific titles and explain the user impact.
- Use plain text in fields. Do not use line breaks, Markdown headings, implementation jargon, unsupported performance claims, or unreleased work.

The website derives the version and UTC release date from GitHub's published tag. Never use a commit date as the release date. These rules follow the website's `.claude/CHANGELOG_RULES.md`; there is now one entry per published version rather than manual batches of patches.

```sh
npm run test:release-notes
npm run release:notes -- --version 0.1.33 --check
npm run release:notes -- --version 0.1.33 --output /tmp/spoke-release-notes.md
```

Release preflight also requires notes for the current package version. Missing notes or invalid categories stop a tagged build before the expensive packaging steps.

## Website format

The generated body starts with `<!-- spoke-changelog:v1 -->`, then a `#` headline and summary. Category headings use `##`, item titles use `###`, and descriptions are plain paragraphs. The marker identifies this contract and is not displayed by GitHub. The website validates and renders text as React content; it never executes release HTML or Markdown.

The website refreshes the server-side GitHub data cache after five minutes, on subsequent visits. Only published stable releases with a DMG, matching arm64 ZIP, updater manifest, and valid reviewed notes enter the feed. Its checked-in generated snapshot provides a fallback when GitHub cannot be reached. No notes are generated from raw commit titles during publication: reviewed product copy is required.

## Historical backfill evidence

The first backfill covers ten previously published versions. Each entry was written from the changes between adjacent release tags, not the old website's cloud-era changelog examples.

| Version | Audited range | Main evidence |
| --- | --- | --- |
| 0.1.32 | v0.1.31..v0.1.32 | Speech bars and Bounce; capture ownership; faster finish, cleanup, and clipboard delivery |
| 0.1.31 | v0.1.30..v0.1.31 | Pause-aware chunks; panel preload; cloud path removal; packaged speech detection |
| 0.1.30 | v0.1.29..v0.1.30 | Final NVIDIA number formatting; Parakeet recommendation; Nemotron profile; filler punctuation |
| 0.1.29 | v0.1.28..v0.1.29 | Conservative Parakeet cleanup and number formatting |
| 0.1.28 | v0.1.27..v0.1.28 | Paged history; bounded audio/live text; deferred UI work; failed-stop cleanup |
| 0.1.27 | v0.1.26..v0.1.27 | Preserve dictation after speech detection fails |
| 0.1.26 | v0.1.25..v0.1.26 | Live Nemotron text; model readiness; Whisper vocabulary; cancellation recovery |
| 0.1.25 | v0.1.24..v0.1.25 | Native recording; stable mic identifiers; meter calibration; short dictation handling |
| 0.1.24 | v0.1.23..v0.1.24 | Bounded long dictation; queued notifications; dismissal timing |
| 0.1.23 | v0.1.22..v0.1.23 | Phrase-aware vocabulary; ambiguous-match handling; centralized saves |

Backfill a published version with the same renderer and `gh release edit v<version> --notes-file <file>`. Edit notes only; leave tags, binaries, signatures, and updater assets unchanged.
