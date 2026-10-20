# Creator Campaign Monitor

A standalone private app for weekly Amazon Creator Connections report comparisons. It does not access Amazon accounts or accept campaigns.

## What it does

- Separate **Accepted Campaigns ZIP** and **All Active Campaigns ZIP** uploads. CSV samples also work.
- Opens every CSV in a ZIP, validates all rows, merges duplicates, and publishes only after successful processing and upload.
- Keeps accepted campaign IDs and their ASINs permanently across imports. Accept a new campaign in Amazon, then include it in your next accepted report to add its ASINs automatically.
- Matches exact ASINs, excludes accepted campaign IDs, and distinguishes new campaign IDs and campaigns reopening between reports.
- Manual ASIN/product URL watches, notes, pauses, permanent exclusions, reviewed markers, search, and filters.
- The first active import establishes a baseline. Subsequent active imports compare against the preceding snapshot. “New/reopened” labels describe the latest report comparison, not an ongoing event log.
- Weekly notifications appear inside the dashboard. Email, push notifications, live Amazon polling, and automatic acceptance are not implemented.

## Infrastructure

New private GitHub repository: `creator-campaign-monitor`. Deploy the static Vite build to Cloudflare Workers static assets or Cloudflare Pages. Supabase provides password authentication and private compressed datasets. No service-role secret belongs in the app.

### Supabase setup

1. Create a separate Supabase project. If the account has reached the two-project Free limit, resolve that before creating it. Do not delete or pause existing apps without choosing to do so.
2. Run `supabase/migrations/202610200001_campaign_datasets.sql` in that project's SQL editor, or apply it through the Supabase CLI migration workflow.
3. Disable public signups and create the owner user in Supabase Authentication. The app has no signup screen. Each user's data is protected by owner-specific RLS; do not share an owner login.
4. Copy the project URL and publishable key into `.env.local` using `.env.example`. Both are public browser configuration; never supply a service-role key.
5. Configure the deployed domain in Supabase Auth settings. Use the dashboard to manage the owner's password; password recovery UI is not included in this first version.

### Local development

Node 22+:

```sh
npm ci
cp .env.example .env.local
npm run dev
```

### Cloudflare deployment

For Workers Builds connected to the GitHub repository:

- Build command: `npm ci && npm run build`
- Deploy command: `npm run deploy`
- Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` as **build** variables; Vite embeds these public values during the build.
- `wrangler.jsonc` deploys `dist/` with SPA fallback. With no variables configured, the app shows a setup screen and cannot access data.

For Cloudflare Pages, use build command `npm run build`, output directory `dist`, and the same build variables. No custom domain is required.

## Data size and persistence

Parsing, matching, and compression run in a dedicated Web Worker. Dataset payloads are gzip-compressed and split into approximately 480 KB binary chunks encoded as base64 in Postgres text columns. The accepted snapshot stores distinct ASINs and campaign IDs, rather than millions of indexed relationship rows. Active snapshots store the latest campaigns, plus the preceding campaign availability map. Controls are saved separately.

A transactional `monitor_publish` RPC verifies chunk completeness and uses an expected current batch ID to reject stale-tab saves. Previous published datasets are removed after replacement; interrupted staging uploads remain recoverable and are pruned by the next successful save of the same kind after one day. Up to 12 small import summaries are retained. Payload byte counts exclude base64 expansion, table/index overhead, temporary old-plus-new upload space, and Postgres maintenance overhead. Measure actual database usage after importing complete reports.

All matching runs client-side, so initial restore downloads the saved compressed datasets. This trades database indexes/rows for browser memory and network usage. Use a desktop browser for large reports. This version supports uploads up to 250 MB and total expanded CSV bytes up to 750 MB. A full-scale check with all five CSVs remains required before production acceptance; only one sample from each export was available during development.

Changing the accepted report or manual watches recalculates against the latest stored active report. Removed/paused products stay excluded on future accepted imports. Accepted IDs and imported ASINs are cumulative; active campaign snapshots are replaced. No CSV income, financial, or existing app tables are used.

Reports are point-in-time snapshots: openings can disappear before you visit Amazon. Availability requires positive slots, positive budget, and current campaign dates in America/New_York. Exact ASIN matching does not infer parent/child variations. The Amazon export does not include a verified campaign deep link, so results link to Creator Connections and offer a copyable campaign ID for manual lookup.

## Validation

```sh
npm run check
npm run test:real -- /path/to/accepted.csv /path/to/active.csv
npm audit --omit=dev
```

Tests cover parsing and quoting, multi-file ZIP extraction, malformed files, swapped report types, watchlist overrides, accepted-ID exclusion, baseline/new/reopened classification, and database atomic publication, optimistic concurrency, cleanup and cross-user RLS using embedded Postgres (PGlite). Real-export verification reconciles row counts and round-trips an actual report through ZIP parsing and gzip persistence.

No real report data, account credentials, or generated user datasets are included in this repository.
