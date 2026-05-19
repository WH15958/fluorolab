<claude-mem-context>
# Memory Context from Past Sessions

*No context yet. Complete your first session and context will appear here.*

Use claude-mem search tools for manual memory queries.
</claude-mem-context>

# FluoroLab

Fluorescence data analysis platform (React 19 + Vite 8 + TypeScript 6 + TailwindCSS 4).

## Commands

```sh
npm run dev        # Vite dev server
npm run build      # Vite build
npm run lint       # ESLint flat config
npm run preview    # Vite preview
```

No test framework. For type checking: `npx tsc --noEmit`.

## Key Conventions

- Path alias `@/` → `./src/` (configured in `vite.config.ts` and `tsconfig.app.json`)
- `eraableSyntaxOnly: true` — no `enum`, no parameter properties, no `namespace`
- `verbatimModuleSyntax: true` — must use `import type` for type-only imports
- TailwindCSS 4 is CSS-first (no `tailwind.config.js`); import with `@import "tailwindcss"` in CSS
- ESLint uses flat config (`eslint.config.js`)

## Architecture

Single-page, 3-tab layout. No router, no state management library — all state lifted to `App.tsx`.

| Tab | Component | Purpose |
|-----|-----------|---------|
| `upload` | `UploadPanel` | CSV/TXT file parsing (auto-detect delimiter, header) |
| `steady-state` | `SteadyStatePanel` | Spectrum visualization, peak fitting (gaussian/lorentzian/voigt) |
| `transient` | `TransientPanel` | TCSPC decay fitting, IRF convolution, multi-exponential models |

### Key modules

| Path | Role |
|------|------|
| `src/types/fluorescence.ts` | All type definitions |
| `src/utils/fileParser.ts` | TXT/CSV parser (own impl, not papaparse) |
| `src/utils/steadyStateAnalysis.ts` | Spectrum analysis, LM peak fitting, CSV/PNG export |
| `src/utils/fittingEngine.ts` | Transient decay: LM optimizer, IRF convolution, smart initials |

### Data flow

```
UploadPanel ──onSteadyAdd/onTransientAdd/onIRFAdd──→ App state ──→ SteadyStatePanel / TransientPanel
                                                        ↓
                                          onSteadyRemove/onTransientRemove/onIRFRemove
```

Dataset identity uses randomly generated IDs (`ds-{timestamp}-{random}`).

## UI

- Inline `style` objects, no CSS modules or styled-components
- `lucide-react` for icons, `recharts` for charts
- Chinese UI labels throughout
- Custom SVG-to-PNG export via canvas in `steadyStateAnalysis.ts`

## Deploy

GitHub Actions (`deploy.yml`) builds on push to `main` and deploys to GitHub Pages. The `GITHUB_PAGES=true` env var sets Vite `base` to `/fluorolab/`. For local builds with correct base path, set the env var:

```sh
$env:GITHUB_PAGES='true'; npm run build
```

## Unused Dependencies

`mathjs` and `papaparse` are in `package.json` but never imported — the app uses its own math and CSV parsing.
