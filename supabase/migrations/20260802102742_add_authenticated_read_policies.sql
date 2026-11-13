create policy "authenticated can read accounts" on accounts for select to authenticated using (true);
create policy "authenticated can read dashboard_snapshots" on dashboard_snapshots for select to authenticated using (true);
create policy "authenticated can read sales_incentive" on sales_incentive for select to authenticated using (true);
create policy "authenticated can read turnover_salary" on turnover_salary for select to authenticated using (true);
create policy "authenticated can read turnover_salary_breakdown" on turnover_salary_breakdown for select to authenticated using (true);
create policy "authenticated can read scrape_runs" on scrape_runs for select to authenticated using (true);
