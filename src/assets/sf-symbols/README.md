# SF Symbols Source

Drop macOS SF Symbol SVG exports into this folder. Each file name becomes the
icon key used by `<SfIcon name="..." />`:

- `lock.shield.svg` → `<SfIcon name="lock.shield" />`
- `mic.fill.regular.svg` → `<SfIcon name="mic.fill" weight="regular" />`
- Nested folders are flattened by dots, so `navigation/compass.fill.svg`
  resolves to `<SfIcon name="navigation.compass.fill" />`

Guidelines:

1. Use Apple-provided mono SVGs to retain system look-and-feel.
2. Remove width/height attributes if possible; the component will inject its
   own sizing and `currentColor` styling.
3. Keep file names lowercase with dots separating segments to match SF Symbol
   naming.

Vite’s `import.meta.glob` eagerly bundles all SVGs placed here, so rebuilding
the app after adding or removing icons is enough—no manual JSON updates needed.

How-to: 

Literally just go to the SF Symbols app, pick the symbol you want, right click, and select the option 'Copy Image as' which should let you copy in SVG.