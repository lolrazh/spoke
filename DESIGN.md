## Sonic Flow Design System (App)

This app uses the same neutral palette and component styling as the website, adapted for native macOS vibrancy.

### Tokens
- Colors (CSS variables in `src/index.css`): `--background`, `--foreground`, `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive`, `--border`, `--input`, `--ring`.
- Radii: `--radius` (scale via Tailwind `rounded-md/lg` etc.), semantic: `--radius-window`, `--radius-pill`.
- Glass surfaces: `--surface-base-rgb`, `--surface-alpha-*`, `--stroke-fg*`, `--blur-md/lg`.
- Motion: `--duration-*`, `--delay-*`, `--ease-*`.

Use Tailwind color utilities via the CSS vars (e.g., `bg-background`, `text-foreground`) and the semantic text utilities `.text-subtle`, `.text-dimmed` for secondary/tertiary text.

### Surfaces
- `card-primary`: primary glass surface, subtle border, medium blur; hover slightly strengthens.
- `card-floating`: floating glass surface for nav/sheets; gentle shadow.
- `card-elevated`: subtle elevation surface; gentlest shadow.

Prefer these classes for panels/cards instead of plain opaque backgrounds.

### Components
- Button (`src/components/ui/button.tsx`):
  - `variant="default"` → `btn-primary` (glass primary)
  - `variant="secondary"` → `btn-secondary` (glass secondary)
  - Sizes: `sm`, `default`, `lg`
- Select (`src/components/ui/select.tsx`): glass trigger/content using `card-floating`.
- Switch: neutral token-based track; keep unless a glass variant is needed.

### Pill
The pill keeps the current neutral look (no brand accent). Visuals live in `src/index.css` under `.pill-*`, `.dot`, `.waveform-bar`.

### Typography
- Body: `Lexend Deca`
- Headings: `DM Serif Display`
- Utilities: `.heading-gradient`, `.text-subtle`, `.text-dimmed`

### Do/Don’t
- Do use `card-*` surfaces for panels; avoid opaque `bg-*` unless necessary.
- Do use `border-border` and `text-foreground` (not raw hexes).
- Don’t reintroduce legacy color names; rely on CSS vars/values instead.

### Where to change things
- Global tokens/surfaces: `src/index.css`
- Tailwind theme/radius/fonts: `tailwind.config.js`
- UI primitives: `src/components/ui/*`


