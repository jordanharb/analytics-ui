# Repository Guidelines

## Project Structure & Module Organization
- Front-end source lives in `src/`, with Woke Palantir views under `src/views/` and the Legislature & Campaign Finance module in `src/legislature/`.
- HTTP handlers for the Next/Vercel bridge sit in `api/` and `src/legislature/api/`; re-use Supabase helpers from `src/lib/` and `src/legislature/lib/`.
- SQL functions, migrations, and investigative scripts are in `sql/`; long-running data utilities sit in `scripts/`.
- Static assets reside in `public/`, while production artifacts from Vite land in `dist/` (do not edit by hand).

## Build, Test, and Development Commands
- `npm run dev` — launch the Vite dev server with hot reload and proxy rules.
- `npm run build` — type-check and build the production bundle; run this before release branches.
- `npm run build:no-typecheck` — faster production build when TypeScript coverage is already validated.
- `npm run lint` — execute ESLint using `eslint.config.js`; fixes must be applied before merging.
Testing is not wired yet, so perform manual validation and document it in pull requests.

## Coding Style & Naming Conventions
- Two-space indentation across TS/TSX and JSON.
- React components belong in `.tsx` with PascalCase names (`LegislatureApp.tsx`); hooks/utilities use camelCase; constants use `UPPER_SNAKE_CASE`.
- Prefer functional components with explicit props typing; avoid default exports except for pages required by Next tooling.
- Let ESLint and Prettier (via ESLint) dictate formatting—run `npm run lint -- --fix` when in doubt.

## Testing Guidelines
- No automated suite exists. If you add tests, follow React Testing Library patterns and colocate files as `Component.test.tsx` next to the component.
- Report manual smoke steps (build, key user flows) in PR descriptions until `npm test` is available.

## Commit & Pull Request Guidelines
- Follow Conventional Commit prefixes (`feat:`, `fix:`, `chore:`, `refactor:`). Keep messages scoped to one logical change.
- PRs should include a short summary, linked issue or TODO reference, screenshots/GIFs for UI updates, and explicit verification steps (e.g., `npm run build`).
- Flag follow-up work with TODO bullets instead of mixing large refactors into one review.

## Security & Configuration Tips
- Copy `.env.example` to `.env` and supply both Woke Palantir (`VITE_SUPABASE_URL`, etc.) and Campaign Finance (`VITE_CAMPAIGN_FINANCE_SUPABASE_URL`, `CAMPAIGN_FINANCE_SUPABASE_SERVICE_KEY`) secrets locally.
- Never commit secrets or production data; the app surfaces clear errors when keys are missing.
- Avoid direct edits inside Supabase SQL files without coordinating migrations.

## Agent-Specific Instructions
- Use `rg`/`rg --files` for discovery and `apply_patch` for edits to preserve user changes.
- Keep MCP client/server updates synchronized—tool declarations in `api/mcp` must reflect available Supabase queries.
- Stage only files you touched; if unexpected changes appear, pause and confirm with the user.
