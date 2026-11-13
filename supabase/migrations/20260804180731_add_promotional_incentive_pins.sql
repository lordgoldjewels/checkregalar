create table public.promotional_incentive_pins (
  id bigint generated always as identity primary key,
  account_id text not null references public.accounts(member_id),
  code text not null,
  category text,
  dated date,
  amount numeric,
  status text not null,
  created_at timestamptz not null default now(),
  unique (account_id, code)
);

alter table public.promotional_incentive_pins enable row level security;

create policy "authenticated read" on public.promotional_incentive_pins
  for select to authenticated using (true);

grant select on public.promotional_incentive_pins to authenticated;
grant all on public.promotional_incentive_pins to service_role;
grant usage, select on sequence promotional_incentive_pins_id_seq to service_role;
