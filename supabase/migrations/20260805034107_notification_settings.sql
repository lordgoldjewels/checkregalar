create table public.notification_settings (
  type text primary key,
  enabled boolean not null default true
);

insert into public.notification_settings (type) values
  ('sales_incentive'), ('turnover_salary'), ('promotional_incentive'),
  ('digigold_buy'), ('digigold_sell'),
  ('scrape_crashed'), ('failed_to_load_home'), ('session_expired'),
  ('account_scrape_failure'), ('partial_run_summary');

alter table public.notification_settings enable row level security;

create policy "authenticated can read notification_settings"
  on public.notification_settings for select to authenticated using (true);

create policy "authenticated can update notification_settings"
  on public.notification_settings for update to authenticated using (true) with check (true);
