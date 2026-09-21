# V2V Transform

AI video-to-video transformation: upload a video, choose a style, and get a restyled result.
Built with Next.js, TypeScript, Tailwind CSS, MongoDB, Uploadcare, Cloudinary and the Magic Hour API.

**Live app:** https://v2v-nu.vercel.app

## Quick start

```bash
pnpm install
cp .env.example .env.local   # fill in the keys, see comments in the file
pnpm dev
```

Open http://localhost:3000.

## How a job flows

In plain language: you upload a clip in the browser -> the server copies it to Cloudinary and
asks Magic Hour to render it -> Magic Hour calls the server back when the render finishes ->
the server copies the result into Cloudinary and saves it -> if that callback never arrives,
the server asks Magic Hour directly instead, the next time History is loaded.

In more detail:

1. **Upload.** The browser uploads the file directly to Uploadcare (a signed, direct upload —
   the file never passes through this app's server). The server then validates it (size,
   format, actual duration) against Uploadcare's own file info, not the browser's claim, and
   copies it into Cloudinary so Magic Hour can fetch it over a plain HTTPS URL.
2. **Transform.** `POST /api/transform` sends the Cloudinary URL and the chosen style to
   Magic Hour and gets back a job ID within a few seconds. The job is saved as `processing`,
   in phase `queued` (or `submitting`, if even that answer was lost — see Known limitations).
3. **Provider.** Magic Hour renders the video in the background; this can take anywhere from
   under a minute to several minutes depending on clip length and load.
4. **Webhook _or_ status check.** Magic Hour finishes and calls the one webhook registered on
   the account (`POST /api/webhook`) with the result. If that call is ever lost — a dropped
   connection, or (in local development) no webhook reachable at all — the server instead asks
   Magic Hour directly the next time someone loads or refreshes the History page. This "status
   check" needs no manual action; see "Local development" below for why it exists.
5. **Result.** Either path runs the same "finalize" step: the rendered video is copied into
   Cloudinary, the job is marked `complete`, and its card in History updates.

A job that is taking unusually long shows "Taking longer than expected. Still checking", and
later "Stopped checking" if it passes a longer grace period — both keep checking in the
background, and a result that arrives late is still saved. Retry starts a brand-new job
without cancelling the one already running (Magic Hour has no cancel API), so the original may
still finish and be charged even after a Retry.

Every transform run with `PROVIDER_MODE=real` (the default — see `.env.example`) spends real
Magic Hour credits, locally exactly as in production. Set `PROVIDER_MODE=fake` only for
`pnpm test:e2e`, which sets it automatically; do not set it in a normal `pnpm dev` session
unless you specifically want to avoid spending credits and are prepared for the app to use
in-memory Uploadcare/Cloudinary fakes instead of your real accounts.

## Local development

Magic Hour cannot call `localhost`, and it registers **one** webhook URL for the whole
account — there is no per-environment callback. Pick one of these two options.

**Option A — rely on the status check (recommended default).** Do nothing: leave the
account's webhook registration pointed at production. As explained above, the app asks Magic
Hour directly whenever History is loaded or refreshed, so a job started locally still
completes with no webhook involved. This only became viable this cycle, now that the status
check runs the same finalize step the webhook does; it is the safer default for local work
because it never touches the one shared registration.

**Option B — a tunnel with a temporary dev webhook.** Use this only when you specifically need
to exercise the webhook code path itself (for example, testing signature verification). Run a
tunnel — `ngrok http 3000` or `cloudflared tunnel --url http://localhost:3000` — and register
its public URL, `https://<tunnel>.example/api/webhook`, at
https://magichour.ai/developer. **This replaces the account's one webhook registration**, so
while it's active Magic Hour stops calling the production deployment; a production job still
waiting on a webhook isn't lost — the status check catches it up the next time someone loads
History — but it won't complete the instant it renders. **When you are done,
re-register the production URL** — `https://v2v-nu.vercel.app/api/webhook`, or your own
production domain — at the same dashboard page. This step is not optional: skipping it leaves
production depending on the status check alone until someone remembers to fix it.

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

## Troubleshooting

- **A job stays "Confirming with Magic Hour" indefinitely.** Magic Hour's answer to the
  create call was lost, and no webhook delivery naming that job has arrived since. This is the
  dormant `SUBMISSION_UNCONFIRMED` case (see Known limitations) — nothing currently recovers
  it automatically. Retry starts a fresh job; the original may still finish on its own but the
  app can no longer confirm it did.
- **A job sits "Queued" or "Rendering" in local development and never updates by itself.**
  Expected if you're using Option A (see "Local development") — the status check only runs
  when the History page is loaded or refreshed, so reload the page rather than waiting for it
  to update on its own.
- **"Taking longer than expected. Still checking" appears.** The job's estimated deadline
  passed but its grace period has not; this is not an error. Keep reloading History and it
  will keep checking.
- **"Stopped checking" appears.** The grace period passed with no result yet. The job may
  still finish at Magic Hour — a late webhook, or the once-an-hour recheck, will still pick up
  the result if it arrives. Retry is available if you'd rather not wait.
- **`POST /api/webhook` returns 401.** `MAGIC_HOUR_WEBHOOK_SECRET` doesn't match the secret
  Magic Hour issued for whichever URL is _currently_ registered — most often because the
  registration changed (a tunnel was registered, or re-registered) without updating the
  environment variable to match, or because the delivery's timestamp is more than 5 minutes
  old. Re-copy the secret from https://magichour.ai/developer for the currently registered URL.
- **A route returns 504 / times out.** Check the route's `export const maxDuration` in
  `src/app/api/*/route.ts` against what actually ran long — a slow Cloudinary or Magic Hour
  call is the usual cause. The request needs to be retried; nothing about a timeout resolves
  itself.
- **Running locally without a tunnel and a job never completes.** Confirm nothing registered a
  tunnel URL and then let the tunnel exit, leaving the account's one webhook registration
  pointed at a dead address. Falling back to Option A (do nothing, rely on the status check)
  works regardless of what is currently registered.
- **`pnpm dev` fails immediately with "Invalid environment: ...".** One or more variables in
  `.env.local` are missing or malformed; the message names each one — check it against the
  matching comment in `.env.example`.

## Provider setup and deployment

One-time steps for whoever deploys this project. Registering the webhook (step 4 below) is
still required for production: without it, a job only completes when a real user's browser
happens to be polling History (see "How a job flows"), and a browser that isn't open drives no
recovery at all. Local development doesn't need it — see "Local development" above.

1. **Create accounts and collect keys.**
   - **Uploadcare** — sign up, then open the project's API keys at
     https://app.uploadcare.com/projects/-/api-keys/ for `NEXT_PUBLIC_UPLOADCARE_PUBLIC_KEY`
     and `UPLOADCARE_SECRET_KEY`. Enable **signed uploads** under "Uploading settings" at
     https://app.uploadcare.com/projects/-/settings/ — required; the browser uploader is
     configured to request a signature and fails without it.
   - **Cloudinary** — sign up, then open https://console.cloudinary.com/app/settings/api-keys
     for `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY` and `CLOUDINARY_API_SECRET`. Leave
     delivery at its default (plain HTTPS) type — Magic Hour must be able to fetch the source
     URL without authentication.
   - **MongoDB Atlas** — create a cluster, then at https://cloud.mongodb.com/ create a
     database user scoped to `readWrite` on this one database only (your cluster → Database
     Access), and copy the connection string (your cluster → Connect → Drivers) for
     `MONGODB_URI`.
   - **Magic Hour** — sign up at https://magichour.ai/developer for `MAGIC_HOUR_API_KEY`.
     `MAGIC_HOUR_WEBHOOK_SECRET` doesn't exist yet — it's issued in step 4 below, once a
     webhook URL is registered.

2. **Set the environment variables in Vercel.** Open the project's Settings → Environment
   Variables page (https://vercel.com/dashboard → the project → Settings → Environment
   Variables) and set every key from `.env.example` for **Production**. Mark these seven as
   **Sensitive** — every variable `.env.example` comments as `# secret`:
   `UPLOADCARE_SECRET_KEY`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET`,
   `MAGIC_HOUR_API_KEY`, `MAGIC_HOUR_WEBHOOK_SECRET`, `MONGODB_URI` and
   `SESSION_COOKIE_SECRET`. Confirm `PROVIDER_MODE` is `real` or unset — `parseConfig` refuses
   `fake` on Vercel.

3. **Deploy, then create the indexes.** `pnpm db:indexes` always runs with
   `--env-file=.env.local` — it never reads Vercel's environment — so before running it
   here, point `.env.local`'s `MONGODB_URI`/`MONGODB_DB_NAME` at the **production**
   database, not a local or preview one. Skipping this leaves the unique
   `{userId, idempotencyKey}` index missing in production, silently, with no runtime
   check to catch it: two truly concurrent submits then become two paid renders instead
   of one.

   ```bash
   pnpm dlx vercel@latest deploy --prod
   pnpm db:indexes
   ```

   Point `.env.local` back at your local database afterwards before resuming development.

4. **Register the webhook.** At https://magichour.ai/developer, create a webhook pointing
   at `https://<production-domain>/api/webhook` (this app's production URL is currently
   `https://v2v-nu.vercel.app/api/webhook`) and subscribe it to `video.started`,
   `video.completed` and `video.errored`. Copy the issued secret into Vercel as
   `MAGIC_HOUR_WEBHOOK_SECRET` and redeploy so the new value is picked up.

   There is one webhook URL per Magic Hour account. A job started from a preview
   deployment is still completed by the production webhook — that is expected, not a bug.
   Registering a tunnel for local development temporarily replaces this URL; see "Local
   development" above for the step that restores it.

5. **Run a real transform and measure it.** Upload a short clip (5–10 s) through the
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
- **Matching a webhook to a job by name is best-effort.** When a job's Magic Hour ID never got
  saved, the webhook falls back to matching on the `name` field it sent Magic Hour — but Magic
  Hour's own docs list `name` as optional on a delivery, and there's no API to look a job up
  another way. A delivery that arrives without `name` for such a job can never be matched.
- **A lost webhook is recovered only when someone loads History.** The status check that
  stands in for a missing webhook runs when the History page is loaded or refreshed, not on a
  timer or schedule — if no one has the page open, nothing checks in the meantime, and the job
  simply waits until the next visit.
- **A cancelled job is labelled differently depending on how it's discovered.** A cancellation
  that arrives by webhook is stored as `MAGIC_HOUR_JOB_FAILED` (the same code used for a real
  render failure); the same cancellation found by the status check is correctly stored as
  `MAGIC_HOUR_JOB_CANCELED`. This is a known, pre-existing inconsistency in the webhook's
  handling and has been left alone rather than fixed.
- **A lost submission can get stuck forever.** If Magic Hour's answer to the initial create
  call never arrives, the job stays at phase `submitting` with no Magic Hour ID recorded — and
  the status check only ever looks at jobs that already have one, so it can never reach this
  job. Nothing currently recovers it automatically; it stays on "Confirming with Magic Hour"
  indefinitely unless a later webhook happens to match it by name.
- **Sorting by duration is computed per request, not stored.** History's "sort by clip length"
  computes each job's duration (`endSeconds - startSeconds`) at query time rather than reading
  a stored, indexed field. This is fine at the scale of one browser's own history and would
  need a stored, indexed duration field to stay fast at a much larger scale.
- **The offline banner was never built.** The architecture doc (section 16) and design finding
  F25 both call for an app-wide banner that appears when the browser goes offline and pauses
  polling; no cycle has implemented it (there are zero references to "offline" UI anywhere in
  `src/`). Going offline today shows no indication at all.
- **Timestamps are shown in UTC, not the reader's local time.** Every timestamp renders with an
  explicit "UTC" label rather than converting to the viewer's timezone, so the server-rendered
  and client-rendered strings are always identical and never mismatch on hydration. Converting
  to local time is left to the reader.

## Security

| Control                   | What it does                                                                                                                                                                                                                                        | Where                                              |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Input validation          | Every endpoint parses its body/query with Zod before doing any work; JSON bodies are size-capped before parsing.                                                                                                                                    | route handlers                                     |
| File validation           | An uploaded file is checked against Uploadcare's own file info, not the browser's claim.                                                                                                                                                            | `POST /api/transform`                              |
| Ownership scoping         | Every query on `sources`/`jobs` is scoped by the caller's signed user ID; no cross-user access.                                                                                                                                                     | repositories                                       |
| SSRF-safe inputs          | `POST /api/upload` accepts only URLs on our Uploadcare CDN host; `POST /api/transform` accepts only a `sourceId`, never a raw URL from the browser.                                                                                                 | route handlers                                     |
| Signed anonymous identity | The `v2v_uid` cookie is `HttpOnly`, `Secure`, `SameSite=Lax` and HMAC-signed with `SESSION_COOKIE_SECRET`, so a user ID can't be forged.                                                                                                            | `src/server/services/identity.ts`                  |
| Webhook verification      | HMAC-SHA256 over `timestamp.rawBody`, constant-time comparison, 5-minute replay window; fails closed if the secret is missing.                                                                                                                      | `POST /api/webhook`                                |
| Signed uploads            | A short-lived Uploadcare upload signature is issued by our own endpoint, so only this app can upload into the project.                                                                                                                              | `POST /api/uploadcare-signature`                   |
| Rate limiting             | 10 requests/user and 30/IP per 10 minutes on `/api/upload` and `/api/transform`, tracked in MongoDB; exceeded returns `429 RATE_LIMITED`.                                                                                                           | `src/server/services/rate-limit.ts`                |
| Secrets                   | Only `NEXT_PUBLIC_UPLOADCARE_PUBLIC_KEY` reaches the browser; every other key is server-only, parsed at boot, and never logged.                                                                                                                     | `src/config/env.ts`                                |
| Transport                 | HTTPS + HSTS enforced by Vercel; MongoDB Atlas over TLS; all provider calls over HTTPS.                                                                                                                                                             | Vercel, Atlas                                      |
| Security headers          | A `Content-Security-Policy` scoped to our origin plus the Uploadcare/Cloudinary domains in use, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin-when-cross-origin`, a restrictive `Permissions-Policy`. | `next.config.ts`, `src/config/security-headers.ts` |
| Dependency hygiene        | `pnpm audit` runs in CI on every pull request.                                                                                                                                                                                                      | GitHub Actions                                     |

## Glossary

- **Source** — an uploaded video (its Uploadcare file, its Cloudinary copy, and its row in the
  `sources` collection). One source can be transformed more than once.
- **Job** — one transform attempt: the database record tracking a single Magic Hour render
  from submission to its outcome.
- **Phase** — a job's finer-grained state while its status is `processing`: `submitting`
  (Magic Hour hasn't confirmed receipt yet), `queued` (Magic Hour accepted it), or `rendering`
  (Magic Hour is actively rendering it).
- **Status check** — the server asking Magic Hour directly whether a job is done, used to
  recover from a webhook that may have been missed. See "How a job flows".
- **Finalize** — the one shared step, run by both the webhook and the status check, that copies
  a completed render into Cloudinary and marks the job `complete`.
- **Claim** — an exclusive, time-limited lock (status `finalizing`, with a `claimedAt` stamp) a
  job holds while finalizing, so the webhook and the status check can never both finalize the
  same job at once. A claim older than 5 minutes is presumed crashed and can be re-claimed.
- **Superseded** — the status a job gets once Retry replaces it. The original keeps running at
  Magic Hour and can still complete, but its card moves under "Previous attempts" instead of
  showing at the top level of History.

## Design documentation

Architecture decisions and diagrams live in [`docs/`](docs/), starting with
[`docs/decisions-report.md`](docs/decisions-report.md).
