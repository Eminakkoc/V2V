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

| Command          | What it does                                    |
| ---------------- | ----------------------------------------------- |
| `pnpm dev`       | Start the development server                    |
| `pnpm build`     | Production build                                |
| `pnpm lint`      | ESLint (Next.js, TypeScript, jsx-a11y rules)    |
| `pnpm typecheck` | TypeScript type check                           |
| `pnpm format`    | Prettier                                        |
| `pnpm test`      | Unit and integration tests (Vitest)             |
| `pnpm test:e2e`  | End-to-end and accessibility tests (Playwright) |
| `pnpm check`     | Lint, typecheck, format check and tests         |

## Design documentation

Architecture decisions and diagrams live in [`docs/`](docs/), starting with
[`docs/decisions-report.md`](docs/decisions-report.md).
