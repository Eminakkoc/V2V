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

| Command               | What it does                                                               |
| --------------------- | -------------------------------------------------------------------------- |
| `pnpm dev`            | Start the development server                                               |
| `pnpm build`          | Production build                                                           |
| `pnpm lint`           | ESLint (Next.js, TypeScript, jsx-a11y rules)                               |
| `pnpm typecheck`      | TypeScript type check                                                      |
| `pnpm format`         | Prettier                                                                   |
| `pnpm test`           | Unit and integration tests (Vitest)                                        |
| `pnpm test:e2e`       | End-to-end and accessibility tests (Playwright)                            |
| `pnpm check`          | Lint, typecheck, format check and tests                                    |
| `pnpm db:indexes`     | Create the MongoDB indexes (run once per environment)                      |
| `pnpm cleanup:manual` | Remove the sources a live manual-test run left behind (dry run by default) |
| `pnpm transform:real` | Trigger and poll a real transform against a deployed instance (see below)  |

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

## Cleaning up after a live manual test

The app has no "delete a source" feature, so a manual test run against the real providers
leaves its uploads in place — in Uploadcare, in Cloudinary and in the `sources` collection.
`pnpm cleanup:manual` clears them together.

```bash
pnpm cleanup:manual                          # last 24 hours, prints only
pnpm cleanup:manual --since 2026-09-19       # from a date instead
pnpm cleanup:manual --since 2026-09-19 --delete   # actually remove them
```

It prints what it would remove and deletes nothing unless `--delete` is passed. It refuses
to run unless `PROVIDER_MODE` is `real`, removes each source from both providers before
dropping its database row, and stops at the first failure so nothing is left half-removed.
An Uploadcare file shared by a source outside the window is kept — re-sending the same
upload reuses one file across several sources.

## Provider setup and deployment

One-time steps for whoever deploys this project. Skip the webhook step and the app still
works — the status check reconciles jobs on its own — but completions arrive faster with it
registered.

1. **Set the environment variables in Vercel.** Open the project's Settings → Environment
   Variables page (https://vercel.com/dashboard → the project → Settings → Environment
   Variables) and set every key from `.env.example` for **Production**. Mark these five as
   **Sensitive**: `UPLOADCARE_SECRET_KEY`, `CLOUDINARY_API_SECRET`, `MAGIC_HOUR_API_KEY`,
   `MAGIC_HOUR_WEBHOOK_SECRET` and `SESSION_COOKIE_SECRET`. Confirm `PROVIDER_MODE` is
   `real` or unset — `parseConfig` refuses `fake` on Vercel.

2. **Deploy, then create the indexes.**

   ```bash
   pnpm dlx vercel@latest deploy --prod
   pnpm db:indexes
   ```

3. **Register the webhook.** At https://magichour.ai/developer, create a webhook pointing
   at `https://<production-domain>/api/webhook` and subscribe it to `video.started`,
   `video.completed` and `video.errored`. Copy the issued secret into Vercel as
   `MAGIC_HOUR_WEBHOOK_SECRET` and redeploy so the new value is picked up.

   There is one webhook URL per Magic Hour account. A job started from a preview
   deployment is still completed by the production webhook — that is expected, not a bug.

4. **Run a real transform and measure it.** Upload a short clip (5–10 s) through the
   deployed Create page to get a real `sourceId`. Copy the `v2v_uid` cookie the app just
   set for you, then run:

   ```bash
   V2V_COOKIE="v2v_uid=<value>" pnpm transform:real https://<production-domain> <sourceId>
   ```

   It prints each status change with a timestamp as the job moves through rendering, then
   the total wall-clock time, the clip length and `creditsCharged`. Those are the numbers
   that turn the guessed `JOB_DEADLINE_*` constants in `.env.example` into measured ones.

## Known limitations

- **Camera recording has never run on real hardware.** `openCamera()` in
  `src/components/upload/source-uploader.tsx`, and the `camera=(self)` / `microphone=(self)`
  Permissions-Policy it depends on, are covered only by unit tests and by end-to-end tests
  against a fake camera. Verifying it needs a physical device and human judgement.
- **The mobile layout has never run on a real handset.** The Playwright suite covers iPhone
  WebKit against fakes; no real phone has run the flow end to end. One pass — record a clip,
  confirm it uploads and the summary renders — is the last unexercised user-facing path.
- **Identity is an anonymous cookie.** There is no sign-in; clearing the cookie loses the
  history tied to it.
- **No playback conversion.** Cloudinary serves the stored original, with no transcoding, so
  an iPhone HEVC clip may not play in some Android and desktop browsers.
- **No poster above 40 MB.** On the Cloudinary free plan, on-the-fly transformations stop at
  40 MB, so uploads between 40 MB and 100 MB have no poster image. Playback is unaffected.
- **Uploads accumulate until deleted manually.** See the cleanup section above.

## Design documentation

Architecture decisions and diagrams live in [`docs/`](docs/), starting with
[`docs/decisions-report.md`](docs/decisions-report.md).
