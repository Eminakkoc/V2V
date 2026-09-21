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
the server asks Magic Hour directly instead, the next time the browser asks for the job list —
which it does by itself, every few seconds, while a job is running.

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
   connection, or (in local development) no webhook reachable at all — the server asks Magic
   Hour directly instead: every `GET /api/history` response is followed by a "status check" of
   that user's unfinished jobs, and the browser polls that endpoint by itself while a job is
   live, from whichever page is open. It needs no manual action; the next section draws it.
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

## How a finished render reaches the browser

![Sequence diagram: the browser polls the history endpoint, each response triggers a status
check of Magic Hour, and both that check and Magic Hour's webhook end in the same claim-guarded
finalize step](docs/diagrams/polling-sequence.svg)

A render takes minutes, and nothing here holds a connection open that long. Two independent
paths bring the result back, and either one alone is enough:

- **The webhook is the fast path.** Magic Hour calls `POST /api/webhook` the moment a render
  finishes. The signature is verified before the body is even parsed.
- **The status check is the safety net.** Every `GET /api/history` response is followed —
  after the response has already been sent — by a check of up to five of that user's
  unfinished jobs, skipping any that were asked about in the last 60 seconds. A webhook that
  never arrives therefore costs a delay, not the job.

The browser is what keeps that safety net running. While a job is live it polls
`GET /api/history` every 3 seconds, backing off to 10 and then 30 as the job runs on, and stops
entirely once nothing is left to watch. Polling pauses while the tab is hidden or the browser is
offline, and resumes on its own. It lives in the root layout rather than on one page, so it
survives moving between Create and History.

Both paths end in the same `finalize` step, which takes an exclusive claim on the job before
doing anything. That is what makes the race safe: whichever of the two arrives second finds the
job already claimed and does nothing, so a result is never stored twice.

## Where the videos are stored

![Diagram: the browser uploads to Uploadcare, Cloudinary fetches copies into sources/ and
results/, Magic Hour reads the source URL, and MongoDB holds only urls and
metadata](docs/diagrams/storage.svg)

Three services hold video and the app server holds none of it. Every copy is made by one
service fetching a URL from another, so no clip is ever streamed through a Vercel function.

1. The browser uploads the original straight to **Uploadcare**, with a short-lived signature
   issued by `POST /api/uploadcare-signature`.
2. The browser sends only the resulting CDN URL to `POST /api/upload`.
3. The server checks size, type and real duration against Uploadcare's own file info — never
   the browser's claim.
4. It asks **Cloudinary** to fetch that URL into `sources/`. This copy exists because Magic
   Hour needs a plain HTTPS URL it can read without authentication.
5. The `sources` row is written to **MongoDB**: the Uploadcare uuid and URL, the Cloudinary
   public id and URL, and the format, bytes, duration and dimensions Cloudinary reported.
6. `POST /api/transform` sends Magic Hour that Cloudinary URL, the chosen style and the trim
   range.
7. Finalize asks Cloudinary to fetch the finished render into `results/`. Magic Hour's own
   download URL expires, which is why the render is copied rather than linked.
8. The job row gets `output.cloudinaryUrl` and is marked complete.
9. Both the source and the result play back from Cloudinary. The poster frame is an
   on-the-fly Cloudinary transformation of the video, not a separate stored file.

MongoDB stores URLs and metadata only — never a byte of video. Nothing is removed on its own;
see "Cleaning up after a live manual test".

## Who you are: the signed anonymous cookie

![Sequence diagram: the root layout detects a missing cookie, POST /api/session mints and signs
one, and every later request verifies the signature and scopes its database queries to that user
id](docs/diagrams/auth-cookie.svg)

There is no sign-in. Identity is a single cookie, `v2v_uid`, holding a random UUID, the time it
was issued, and an HMAC-SHA256 signature over both, keyed with `SESSION_COOKIE_SECRET`.

- **Minted on the first visit.** The root layout reads the cookie as it renders; if it is
  missing, unreadable or over 30 days old, the page includes a small client component whose
  only job is to call `POST /api/session`. That endpoint's entire answer is the `Set-Cookie`
  header — 204, no body.
- **Verified on every request.** Each route re-derives the signature and compares it in
  constant time. The user id it yields scopes every `sources` and `jobs` query, so no request
  can reach another visitor's rows.
- **Unforgeable rather than secret.** The cookie is `HttpOnly` (no script on the page can read
  it), `SameSite=Lax`, `Secure` outside localhost, and lasts a year. The signing secret never
  leaves the server, so a user id cannot be invented.
- **Renewed quietly.** Past 30 days the same user id is re-signed and re-set, so a returning
  visitor keeps their history.
- **A broken cookie is not an error.** Missing, tampered with and malformed all mean the same
  thing: a new anonymous visitor with an empty history. That is also this design's cost —
  clearing cookies, or switching browser or device, starts over.

## Architecture notes

### Why polling, not WebSockets or SSE

A render takes minutes and the result arrives from a third party, so the browser has to learn
about it somehow. Vercel can hold a long-lived connection — SSE within the function's duration
limit, WebSockets in public beta — and both were rejected in favour of the browser polling
`GET /api/history`.

- **The connection would have to be rebuilt constantly anyway.** A function's maximum duration
  is 300 s on the Hobby plan, so an SSE stream has to reconnect every few minutes, and a single
  render can outlast several of those windows.
- **A polling fallback would still be needed.** Reconnect logic covers a flaky network, not a
  closed laptop or a tab restored an hour later, so the catch-up path has to exist regardless —
  and once it exists, the streaming transport is a second mechanism delivering the same string.
- **A held connection costs a function instance per open tab,** for as long as the tab is open
  and whether or not anything is happening; a poll costs one short request every few seconds and
  nothing at all once the work finishes.
- **There is no stream of events to carry.** A job changes state perhaps four times over several
  minutes — `queued`, `rendering`, `finalizing`, `complete` — which is not a workload that
  justifies a streaming transport.
- **Polling does double duty.** The same request that refreshes the list is what triggers the
  status check that recovers a lost webhook, so one mechanism covers both the normal path and
  the failure path; a WebSocket would have needed that check wired up separately.
- **WebSockets on Vercel are in public beta,** which is not what the one time-critical path of
  the app should depend on.

What this costs: a finished render can sit up to 30 seconds before the browser notices it, which
is invisible next to a render measured in minutes. The real cost is that the status check only
runs while a browser is open — this app has no cron, and a cron would not have helped much
anyway, since the Hobby plan allows one run per day with per-hour precision. The webhook is what
covers the closed-browser case, which is why registering it is required in production.

### Edge cases the flow has to survive

**Upload and submission**

- The browser's claimed size and type are ignored; the file is re-checked against Uploadcare's
  own file info, because anything the client asserts can be forged.
- A trim range longer than the cap, or ending past the source's real duration, is refused before
  any paid call — with a 0.05 s epsilon, since Cloudinary rounds the duration it reports.
- A file Cloudinary cannot make sense of (no duration, dimensions or format) fails the upload
  rather than becoming a paid render that was doomed from the start.
- A double-submitted form cannot become two paid renders: a unique `{userId, idempotencyKey}`
  index means the second request returns the first job.
- If Magic Hour's answer to the create call is lost, the job row already exists and is kept in
  phase `submitting` so nothing is silently dropped.
- Such a job has no Magic Hour ID, so nothing can be asked about it — only a webhook matched by
  name can rescue it, and past the grace period it is marked `SUBMISSION_UNCONFIRMED`.
- A definite rejection (402, 422, 401) is stored as a failed job carrying Magic Hour's own
  reason, rather than a generic error.

**The webhook**

- A missing, malformed or mismatched signature is rejected with 401, and a missing secret fails
  closed rather than open.
- A delivery whose timestamp sits more than five minutes from now, in either direction, is
  rejected, so a captured delivery cannot be replayed.
- The raw body is verified before it is parsed, because re-serialising a parsed body changes the
  bytes and breaks the HMAC.
- A delivery that matches no job, or a body that does not parse, is answered 200 — redelivery
  would never succeed either, and 24 hours of retries help nobody.
- A transient failure inside finalize answers 500 so Magic Hour redelivers; a permanent one
  answers 200 with the job marked failed.
- A late `video.errored` for a job that already completed leaves the stored result alone.
- A redelivered `video.completed` is harmless, because finalize claims the job before doing
  anything and a claimed job is not claimed twice.

**Polling and the status check**

- The webhook and the status check can arrive at the same moment; the exclusive claim means
  exactly one of them stores the result.
- A function killed mid-finalize leaves the job claimed, and the claim is treated as crashed and
  re-taken after five minutes.
- Overlapping polls stamp `lastCheckedAt` when a job is selected rather than when its check
  ends, so the same job is never checked twice at once.
- A provider call that outruns its 10-second budget leaves the job exactly as it was, so a check
  can never half-write a state.
- Polling pauses while the tab is hidden or the browser is offline, and re-syncs on return; a
  result that lands in the meantime is collected, not missed.
- After five consecutive failed requests the page stops and says so, rather than hammering an
  endpoint that is plainly down.
- Past its deadline a job becomes `timed_out` ("still checking"), and past deadline plus the
  roughly two-hour grace it becomes `abandoned` and is only re-checked hourly, for 24 hours.
- With nobody on the app, no status check runs at all, and the webhook is the only thing that
  can finish the job.

**Retry and late results**

- Retry never cancels the original, because Magic Hour has no cancel API — so the first render
  can still complete, and can still be charged.
- The original becomes `superseded` and moves under "Previous attempts", but keeps being
  checked, since a late result is still worth storing.
- A result that arrives after the app gave up is still saved; "Stopped checking" describes this
  app's behaviour, not Magic Hour's.

## Local development

Magic Hour cannot call `localhost`, and it registers **one** webhook URL for the whole
account — there is no per-environment callback. Pick one of these two options.

**Option A — rely on the status check (recommended default).** Do nothing: leave the
account's webhook registration pointed at production. As explained above, the app asks Magic
Hour directly after every history request, and the browser makes those requests by itself every
few seconds while a job is running — so a job started locally still completes, with no webhook
involved and nothing to reload by hand. This only became viable this cycle, now that the status
check runs the same finalize step the webhook does; it is the safer default for local work
because it never touches the one shared registration.

**Option B — a tunnel with a temporary dev webhook.** Use this only when you specifically need
to exercise the webhook code path itself (for example, testing signature verification). Run a
tunnel — `ngrok http 3000` or `cloudflared tunnel --url http://localhost:3000` — and register
its public URL, `https://<tunnel>.example/api/webhook`, at
https://magichour.ai/developer. **This replaces the account's one webhook registration**, so
while it's active Magic Hour stops calling the production deployment; a production job still
waiting on a webhook isn't lost — the status check catches it up as soon as a browser has the
app open again — but it won't complete the instant it renders. **When you are done,
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

- The project needs Node 22, from 22.22.2 up (`engines` is `^22.22.2`, so Node 23+ is not
  accepted). `.nvmrc` pins 22; run `nvm use`.
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
- **A job sits "Queued" or "Rendering" and stops updating.** Live updates pause while the tab
  is hidden or the browser is offline, and resume by themselves — switch back to the tab
  first. If the page is visible and still frozen, the poll gave up after five consecutive
  failed requests and says so ("We lost track of job updates"); reload the page. Nothing is
  lost either way: a result that lands while nothing is watching is still saved.
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
- **"You are offline" appears and cards stop updating.** The browser lost its connection.
  Nothing is lost and nothing is failing: the page stops asking for updates rather than
  retrying and giving up, and it resumes on its own the moment you are back online. A job
  that finishes while you are offline is collected on the next check, not missed.

- **`pnpm dev` fails immediately with "Invalid environment: ...".** One or more variables in
  `.env.local` are missing or malformed; the message names each one — check it against the
  matching comment in `.env.example`.

## Provider setup and deployment

One-time steps for whoever deploys this project. Registering the webhook (step 4 below) is
still required for production: without it, a job only completes while a real user's browser is
open and polling (see "How a finished render reaches the browser"), and a browser that isn't
open drives no recovery at all. Local development doesn't need it — see "Local development" above.

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

- **The mobile layout has never run on a real handset.** The Playwright suite covers iPhone
  WebKit against fakes; no real phone has run the flow end to end. One pass — pick a clip,
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
- **A lost webhook is recovered only while a browser is open.** The status check that stands
  in for a missing webhook runs after a history request, and those requests come from the
  browser's own polling — there is no timer or scheduled job on the server. With the app open
  a job recovers within seconds; with nobody on the app, nothing checks at all, and the job
  waits until the next visit.
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
| Rate limiting             | 10 requests/user and 30/IP per 10 minutes, counted separately for `/api/upload`, `/api/transform` and `/api/uploadcare-signature`, tracked in MongoDB; exceeded returns `429 RATE_LIMITED`.                                                         | `src/server/services/rate-limit.ts`                |
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

The three diagrams above are generated from the PlantUML sources beside them in
[`docs/diagrams/`](docs/diagrams/); edit the `.puml` file and re-render to change one. The full
architecture decision record and the detailed per-endpoint lifecycle diagrams live in the rest
of `docs/`, which is not committed to this repository.
