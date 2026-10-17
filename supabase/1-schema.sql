-- Step 3 of the setup guide: paste all of this into Supabase > SQL Editor and press Run.

-- Every task, list, recurring task and your settings live in this one table.
create table if not exists public.items (
  user_id    uuid not null references auth.users(id) on delete cascade,
  id         text not null,
  kind       text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- Each device that has notifications turned on.
create table if not exists public.push_subscriptions (
  endpoint   text primary key,
  user_id    uuid not null references auth.users(id) on delete cascade,
  p256dh     text not null,
  auth       text not null,
  device     text,
  created_at timestamptz not null default now()
);

-- Access rules: each account can only ever see and change its own rows.
alter table public.items enable row level security;
alter table public.push_subscriptions enable row level security;

drop policy if exists "own items" on public.items;
create policy "own items" on public.items
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "own subscriptions" on public.push_subscriptions;
create policy "own subscriptions" on public.push_subscriptions
  for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Live sync between devices.
alter table public.items replica identity full;
do $$ begin
  alter publication supabase_realtime add table public.items;
exception when duplicate_object then null; end $$;
