# V2V Transform

AI video-to-video transformation: upload a video, choose a style, and get a restyled result.
Built with Next.js, TypeScript, Tailwind CSS, MongoDB, Uploadcare, Cloudinary and the Magic Hour API.

## Quick start

```bash
pnpm install
cp .env.example .env.local   # fill in the keys, see comments in the file
pnpm dev
```

Open http://localhost:3000.

## Scripts

| Command           | What it does                                          |
| ----------------- | ----------------------------------------------------- |
| `pnpm dev`        | Start the development server                          |
| `pnpm build`      | Production build                                      |
| `pnpm lint`       | ESLint (Next.js, TypeScript, jsx-a11y rules)          |
| `pnpm typecheck`  | TypeScript type check                                 |
| `pnpm format`     | Prettier                                              |
| `pnpm test`       | Unit and integration tests (Vitest)                   |
| `pnpm test:e2e`   | End-to-end and accessibility tests (Playwright)       |
| `pnpm check`      | Lint, typecheck, format check and tests               |
| `pnpm db:indexes` | Create the MongoDB indexes (run once per environment) |

## Tests and CI

- The project needs Node 22.22.2 or later. `.nvmrc` pins 22; run `nvm use`.
- `pnpm test` runs unit and integration tests. Integration tests start an in-memory MongoDB
  (`mongodb-memory-server`); the first run downloads a MongoDB binary.
- `pnpm test:e2e` starts an in-memory MongoDB and `PROVIDER_MODE=fake`, so no Uploadcare or
  Cloudinary account is used, on port 3100: `next dev` locally, or `next build` then
  `next start` when `CI` is set. Install the browsers once with
  `pnpm exec playwright install chromium webkit`.
- GitHub Actions runs lint, typecheck, format check, tests and `pnpm audit` on every pull
  request and on pushes to `main`, plus the Playwright suite (Chromium and WebKit).

## Design documentation

Architecture decisions and diagrams live in [`docs/`](docs/), starting with
[`docs/decisions-report.md`](docs/decisions-report.md).
