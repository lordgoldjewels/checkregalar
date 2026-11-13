create table public.gold_rates (
  id bigint generated always as identity primary key,
  captured_at timestamptz not null default now(),
  rate_per_gm numeric not null check (rate_per_gm > 0)
);
create index gold_rates_captured_at_idx on public.gold_rates (captured_at desc);
alter table public.gold_rates enable row level security;
create policy "authenticated read" on public.gold_rates for select to authenticated using (true);
grant select on public.gold_rates to authenticated;
grant all on public.gold_rates to service_role;
