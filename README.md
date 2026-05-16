# Job Radar

A green-and-white job-scraper dashboard that pulls live listings from a
read-only Supabase jobs table and lets Claude top up the feed with freshly
sourced roles.

## Stack

- Vite + React + TypeScript
- `@supabase/supabase-js` — read-only client for the `jobs` table
- `@anthropic-ai/sdk` — Claude integration for AI-sourced listings
- `framer-motion` — animations
- `lucide-react` — icons

## Data source

The app reads from this Supabase project (credentials embedded in
`src/lib/radarClient.ts`):

- URL: `https://owsbrhyzkprqgasesbqa.supabase.co`
- Table: `jobs`
- Each job card surfaces the originating `platform` (e.g. Adzuna) so you can
  see where the listing came from.

## Features

- Keyword search across `title` and `description`
- Country filter (auto-derived from `location`)
- Experience filter (Internship → Lead) parsed out of the JD
- Role-family filter (Frontend, Backend, Data/AI, DevOps, etc.)
- 20-per-page pagination with a smooth scroll
- "Boost with Claude" button — Claude pulls 8 recently-posted listings
  matching your query and prepends them to the feed (requires an Anthropic
  API key, saved in `localStorage`)
- Skeleton loaders, staggered card animations, toast notifications, modal
  for the API key

## Run locally

```bash
npm install
npm run dev
```

Open http://localhost:5173.
