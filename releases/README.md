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

