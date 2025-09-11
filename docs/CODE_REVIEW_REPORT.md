# Sonic Flow Code Review Report

This report summarizes critical findings, the first‑principles rationale, and concrete implementation changes. The focus areas are Electron security hardening, TypeScript/ESLint strictness, Cloudflare Worker runtime purity, IPC validation, and maintainability.

---

## 1) Executive Summary
- Strengths: clean preload bridges (renderer avoids Node), useful tests, Sentry across app/worker, and solid Forge+Vite setup with fuses.
- Issues to address (priority):
  - Enable Electron sandbox and tighten navigation/URL policies.
  - Validate IPC inputs and restrict external URL opening.
  - Enforce strict TypeScript and ESLint rules (remove broad relaxations).
  - Remove Node compatibility in the Worker to keep a Web‑only runtime.
  - Normalize package manager/lockfiles.

Outcome: These changes reduce the attack surface, catch bugs earlier at compile/lint time, and keep platform boundaries crisp.

---

## 2) Why These Changes (First Principles)

### Electron threat model (renderer as untrusted DOM)
- In Electron, the renderer is a powerful browser view. If the renderer is compromised (XSS, dependency supply chain, or navigation to untrusted origins), it must not be able to escalate to native privileges. The two guardrails are:
  - Process isolation: `contextIsolation: true` and `sandbox: true` prevent the renderer from accessing Node or Electron internals.
  - Strict navigation: deny popups and cross‑origin navigations; only allow explicit, validated external URLs via the main process.

### Principle of least privilege at app boundaries
- Preload bridges and IPC are privilege gateways. Every input crossing the boundary (renderer → main) must be validated; every output (main → renderer) must avoid leaking sensitive context. Unvalidated payloads or arbitrary `shell.openExternal` calls become escalation vectors.

### Type soundness and feedback loops
- Strict TypeScript and ESLint rules provide fast, local feedback for entire classes of defects (unchecked nulls, fallthrough switches, unused/accidental shadowing, value/import drift). Weak settings trade short‑term convenience for long‑term brittleness.

### Worker runtime purity
- Cloudflare Workers run in a WebWorker environment. Allowing Node compatibility/types blurs boundaries, invites accidental Node APIs, and risks production/runtime mismatches. Keeping it Web‑only reduces surprises and preserves portability.

### Operational resilience
- Clear CSP/COOP/COEP policies, bounded WS/frame handling, and predictable toolchains (single package manager) minimize rare, high‑severity failures that are expensive to debug in production.

---

## 3) Actionable Changes (with code)

### A) Electron: enable sandbox and harden navigation

1) Set `sandbox: true` and add open/navigation guards in `src/main.ts` (main and onboarding windows). Also add explicit allowlist for external URLs.

```ts
// src/main.ts (inside BrowserWindow options for both windows)
webPreferences: {
  contextIsolation: true,
  sandbox: true,          // was false
  nodeIntegration: false,
  preload: path.join(__dirname, "preload.js"),
}

// After window creation, add strict navigation controls
mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
mainWindow.webContents.on("will-navigate", (e, url) => {
  // Disallow navigations; renderer should only load app routes
  e.preventDefault();
});

// Replace permissive permission handler: remove entirely unless you have a concrete permission to grant.
// mainWindow.webContents.session.setPermissionRequestHandler(...)  // REMOVE

// Validate and restrict external URLs opened via IPC
const allowedExternal = (
  url: string,
  isDev: boolean,
): boolean => {
  try {
    const u = new URL(url);
    // allow https/mailto; allow custom schemes we own; allow localhost in dev only
    if (["https:", "mailto:", "sonicflow:", "sonicflow-dev:"] .includes(u.protocol)) return true;
    if (isDev && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return true;
    // System Preferences deep links (macOS)
    if (u.protocol === "x-apple.systempreferences:") return true;
  } catch {}
  return false;
};

ipcMain.handle("open-external", async (_event, url: string) => {
  const isDev = !app.isPackaged;
  if (!allowedExternal(url, isDev)) {
    return { ok: false, error: "URL not allowed" };
  }
  try {
    await shell.openExternal(url);
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
});
```

2) Tighten CSP injection while keeping dev ergonomics (leave `unsafe-eval` out; minimize `connect-src`). Consider moving the policy to a helper and using env to switch dev/prod.

```ts
// src/main.ts (onHeadersReceived)
const isDev = !app.isPackaged;
const connect = [
  "connect-src 'self' https://api.sonicflow.app wss://api.sonicflow.app https://*.sentry.io https://*.ingest.sentry.io",
  ...(isDev ? [
    "http://localhost:*", "ws://localhost:*", "http://127.0.0.1:8787", "ws://127.0.0.1:8787",
  ] : []),
].join(" ");
const scriptSrc = "script-src 'self'"; // avoid unsafe-eval/inline
const styleSrc = "style-src 'self' 'unsafe-inline'"; // inline styles acceptable, but consider nonces later
const imgSrc = "img-src 'self' data:";
const fontSrc = "font-src 'self' data:";
const csp = ["default-src 'self'", connect, scriptSrc, styleSrc, imgSrc, fontSrc].join("; ");
```

### B) IPC input validation (use zod)

Add light runtime validation on IPC payloads to avoid malformed inputs reaching privileged code paths.

```ts
// Example: src/main.ts
import { z } from "zod";

const MicSelect = z.object({ id: z.string().min(1) });
ipcMain.handle("mic:select", (_event, payload: unknown) => {
  const parsed = MicSelect.safeParse(payload);
  if (!parsed.success) return { ok: false };
  const { id } = parsed.data;
  micPreferences.selectedMicId = id;
  persistMicPreferences();
  BrowserWindow.getAllWindows().forEach((w) => w.webContents.send("mic:selected-changed", { id }));
  return { ok: true };
});
```

If you prefer not to add a new dependency, implement minimal type guards instead.

### C) TypeScript strictness (root)

Tighten compiler options to catch bugs earlier. Adjust incrementally by addressing resulting errors.

```jsonc
// tsconfig.json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] },
    "outDir": "dist",

    // Strictness
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "exactOptionalPropertyTypes": true,
    "noUncheckedIndexedAccess": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "useUnknownInCatchVariables": true,
    "verbatimModuleSyntax": true,
    "importsNotUsedAsValues": "error",
    "preserveValueImports": true,

    // Hygiene
    "esModuleInterop": true,
    "skipLibCheck": false,
    "allowJs": false,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"]
}
```

Notes:
- `jsx: "react-jsx"` aligns with React 17+ transform (optional but recommended).
- `skipLibCheck: false` is stricter; set to true temporarily if vendor types cause friction.

### D) ESLint policy

Strengthen rules and reduce overrides to keep type hygiene.

```jsonc
// .eslintrc.json (conceptual changes)
{
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "plugin:import/recommended",
    "plugin:import/typescript"
  ],
  "plugins": ["@typescript-eslint", "import", "promise"],
  "rules": {
    "no-empty": ["error", { "allowEmptyCatch": true }],
    "@typescript-eslint/consistent-type-imports": ["error", { "prefer": "type-imports" }],
    "@typescript-eslint/no-floating-promises": "error",
    "import/no-default-export": "error",
    "promise/catch-or-return": "error",
    "promise/no-return-wrap": "error"
  },
  "overrides": [
    { "files": ["**/*.{test,spec}.{ts,tsx}", "src/test/**"], "rules": {
      "@typescript-eslint/no-explicit-any": "off",
      "import/no-default-export": "off"
    }}
  ]
}
```

Scope the existing broad “off” overrides (worker/main/tests) to individual rules that are needed, not blanket disables.

### E) Worker: remove Node compatibility and Node types

Keep the Worker strictly Web to avoid accidental Node API usage.

```jsonc
// worker/tsconfig.json (key changes)
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "noEmit": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable", "WebWorker"],
    "strict": true,
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "types": ["@cloudflare/workers-types"]
  }
}

// worker/wrangler.jsonc (remove Node compat flags)
{
  "compatibility_date": "2025-08-16",
  // "compatibility_flags": ["nodejs_compat", "nodejs_als"], // REMOVE unless strictly required
}
```

If a library needs Node polyfills, prefer a Worker‑compatible alternative.

### F) Package manager/lockfile normalization

Choose a single package manager across root and worker. If you stay with npm (current scripts use npm):
- Keep `package-lock.json` files.
- Remove the `packageManager` yarn field from root `package.json`.
- Ensure `worker/package-lock.json` remains and avoid mixing pnpm/yarn.

Alternatively, standardize on pnpm or yarn and remove all npm lockfiles accordingly.

---

## 4) Suggested Tests
- API config: unit tests for `getTranscribeUrl`/`getTranscribeWsUrl` query override and dev/prod selection.
- IPC: test validation guards (e.g., `mic:select` rejects empty id).
- Worker WS: tests for oversized frame handling and orderly close with clear codes.
- Permissions hook: polling transitions with mocked providers.

---

## 5) Rollout Plan and Risk
- Start with sandbox/navigation/URL allowlist — minimal user‑visible impact, high security value. If issues appear, toggle via feature flag while you adapt renderer assumptions.
- Tighten TS/ESLint incrementally; fix violations in the touched areas per PR to keep diffs small.
- Remove Worker Node compat in a separate PR; validate with `wrangler dev` and CI.
- Lockfile normalization in a brief PR to avoid long‑lived drift.

Rollback is straightforward: revert the last PR for each scoped change.

---

## 6) Next Steps (I can implement on request)
- Apply the sandbox/navigation/URL allowlist changes and add a small zod dependency for IPC validation (or inline guards if you prefer zero deps).
- Tighten tsconfig/eslint config and address first wave of violations.
- Clean wrangler/tsconfig for Worker and re‑test locally.
- Normalize package manager metadata/lockfiles.

This keeps each step small, reversible, and testable.

