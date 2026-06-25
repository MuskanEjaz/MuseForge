-- MuseForge Supabase production schema
-- Run this in Supabase SQL Editor before deploying the backend.

create table if not exists public_portfolios (
  id text primary key,
  portfolio_data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists public_portfolios_created_at_idx
on public_portfolios (created_at desc);

create table if not exists public_reviews (
  id text primary key,
  name text not null,
  email text,
  rating integer not null check (rating between 1 and 5),
  review text not null,
  created_at timestamptz not null default now()
);

create index if not exists public_reviews_created_at_idx
on public_reviews (created_at desc);
