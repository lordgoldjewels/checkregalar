create table accounts (
  member_id text primary key,
  name text not null,
  phone_number text not null,
  upline_member_id text references accounts(member_id),
  created_at timestamptz not null default now()
);

create table dashboard_snapshots (
  id bigint generated always as identity primary key,
  account_id text not null references accounts(member_id),
  captured_at timestamptz not null,
  my_business numeric,
  my_promotional_incentive numeric,
  my_promotional_incentive_earned int,
  my_promotional_incentive_total int,
  my_distributors int,
  my_gross_b_volume numeric,
  my_earning numeric,
  my_withdraw numeric,
  my_tbp_gross_b_volume numeric,
  my_gift numeric,
  created_at timestamptz not null default now()
);
create index dashboard_snapshots_account_captured_idx on dashboard_snapshots (account_id, captured_at desc);

create table sales_incentive (
  id bigint generated always as identity primary key,
  account_id text not null references accounts(member_id),
  bill_date date not null,
  invoice_no text not null,
  from_distributor text,
  si_value numeric,
  status text,
  pay_via text,
  created_at timestamptz not null default now(),
  unique (account_id, invoice_no)
);

create table turnover_salary (
  id bigint generated always as identity primary key,
  account_id text not null references accounts(member_id),
  month text not null,
  no_of_packets int,
  total_tb_salary numeric,
  charges numeric,
  net_total numeric,
  updated_at timestamptz not null default now(),
  unique (account_id, month)
);

create table turnover_salary_breakdown (
  id bigint generated always as identity primary key,
  turnover_salary_id bigint not null references turnover_salary(id) on delete cascade,
  from_distributor text,
  distributor_id text,
  tbp_salary numeric
);
create index turnover_salary_breakdown_parent_idx on turnover_salary_breakdown (turnover_salary_id);

create table scrape_runs (
  id bigint generated always as identity primary key,
  phone_number text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  accounts_scraped int not null default 0,
  errors jsonb
);

alter table accounts enable row level security;
alter table dashboard_snapshots enable row level security;
alter table sales_incentive enable row level security;
alter table turnover_salary enable row level security;
alter table turnover_salary_breakdown enable row level security;
alter table scrape_runs enable row level security;
