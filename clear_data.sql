-- Clears all scraped data, keeping accounts (users) and phone_sessions.
-- turnover_salary_breakdown is truncated alongside turnover_salary since it
-- has a FK to it; RESTART IDENTITY resets the bigint id sequences to 1.
TRUNCATE TABLE
  public.dashboard_snapshots,
  public.sales_incentive,
  public.turnover_salary_breakdown,
  public.turnover_salary,
  public.scrape_runs
RESTART IDENTITY;
