# Supabase Setup for MuseForge

MuseForge works locally without Supabase. For deployment, configure Supabase so public portfolio links and reviews persist after backend restarts.

## 1. Environment variables

Add these in your backend deployment environment:

```env
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_or_secret_key
SUPABASE_PORTFOLIOS_TABLE=public_portfolios
SUPABASE_REVIEWS_TABLE=public_reviews
```

Keep `SUPABASE_SERVICE_ROLE_KEY` private. Never put it in frontend `.env`, README screenshots, or public GitHub files.

## 2. Portfolio table

Run this in Supabase SQL Editor:

```sql
create table if not exists public_portfolios (
  id text primary key,
  portfolio_data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists public_portfolios_created_at_idx
on public_portfolios (created_at desc);
```

## 3. Reviews table

Run this in Supabase SQL Editor:

```sql
create table if not exists public_reviews (
  id uuid primary key default gen_random_uuid(),
  name text,
  email text,
  rating integer not null check (rating >= 1 and rating <= 5),
  review text not null check (char_length(review) >= 5 and char_length(review) <= 1000),
  created_at timestamptz not null default now()
);

create index if not exists public_reviews_created_at_idx
on public_reviews (created_at desc);
```

## 4. Local fallback

If Supabase is missing or still has placeholder values, MuseForge automatically uses local JSON files in the user data directory:

- `public-portfolios.json`
- `reviews.json`

## 5. Health check

After deployment, open:

```text
https://your-backend-url/health
```

Expected production values:

```json
{
  "publicPortfolioStorage": "supabase",
  "reviewsStorage": "supabase"
}
```
