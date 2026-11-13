# API migration map — old Playwright scraper → new REST API

Maps every entity the old scraper collects to a **confirmed** new-API endpoint.
Each mapping is verified against **live captured traffic** (mitmproxy) with the
on-screen values matching the response fields — no guessing from the app bundle.

- **New API base:** `https://lordicl.com/api/v1`
- **Auth:** phone OTP → Sanctum bearer token. `Authorization: Bearer <token>`,
  `accept: application/json`, `x-locale: en`.
- **Account switching:** `POST /me/switch {"member_id":<id>}` returns a NEW token
  (old one revoked) — adopt it for that account's calls. Scrape sequentially.
- Captured session dir: `/Users/maqdoom/Downloads/apktool` (`capture.har`, runbook).

> ### 📌 Design rule: KEEP the new extras
> The new API returns more than the old scraper captured. **Do not drop the
> extra fields** — add columns/tables for them in the new migration so we store
> them going forward. Each entity below lists its **"KEEP (new)"** fields to add
> to the Supabase schema. Running list of new fields to persist:
> - Sales Incentive: `net`, `paid_on`
> - Dashboard: `ep` (eligibility), `tbp.top_distributors`, `coaching`
> - New earning streams not tracked before: `RESELLER` (+`type`), `SETTLEMENT`
>   (`CBC` is NOT new — it's the promotional pins, entity 3)
> - Turnover Salary breakdown: `level`, per-row `net`, `date`, `status`
> - Promotional pins: `paid_on`
> - (more added as we map each entity)

## Progress

| # | Old entity (table) | New endpoint | Status |
|---|---|---|---|
| 1 | Dashboard (`dashboard_snapshots`) | `GET /member/status` | ✅ confirmed |
| 2 | Sales Incentive (`sales_incentive`) | `GET /member/earnings?stream=IC` | ✅ confirmed |
| 3 | Promotional Incentive Pins (`promotional_incentive_pins`) | `GET /member/earnings?stream=CBC` | ✅ confirmed |
| 4 | DigiGold Buy (`digigold_buy_transactions`) | `GET /digimarket` (`txns[]`) — **BLOCKED** | ⚠️ pending |
| 5 | DigiGold Sell (`digigold_sell_transactions`) | `GET /digimarket` (`txns[]`) — **BLOCKED** | ⚠️ pending |
| 6 | Turnover Salary (`turnover_salary` + `_breakdown`) | `GET /member/earnings?stream=GAP` + `GET /member/earnings/gap-details?month=` | ✅ confirmed |
| — | Gold Rate (`gold_rates`) | `GET /rates` | ✅ (public, captured) |

---

## 1. Dashboard → `GET /member/status`  ✅

The distributor account/dashboard screen is fed by `GET /member/status`. Its
`widgets` object (+ `pi.installments`) is a 1:1 match for `dashboard_snapshots`.
Verified: on-screen values equalled the response fields exactly (capture 2026-11-03).

| Old `dashboard_snapshots` column | New field | Notes |
|---|---|---|
| `my_business` | `widgets.business` | My business value |
| `my_promotional_incentive` | `widgets.pi_value` (= `pi.total_value`) | "MY Sales Incentive" total |
| `my_promotional_incentive_earned` | `pi.installments.paid` | the "(38/…)" |
| `my_promotional_incentive_total` | `pi.installments.total` | the "(…/38)" |
| `my_distributors` | `widgets.distributors` | MY Distributor(s) count |
| `my_gross_b_volume` | `widgets.gross_bv` | Group business value |
| `my_earning` | `widgets.earning` | My incentives |
| `my_withdraw` | `widgets.withdraw` | MY Withdraw |
| `my_tbp_gross_b_volume` | `widgets.tbp_gross_bv` | TBP group business value |
| `my_gift` | `widgets.gift` | |

All values are typed JSON numbers → `parseAmount` not needed for these.

**Sample response (trimmed):**
```json
{
  "ep": { "status": "active", "active_contracts": 2, "active_contract_bv": 101838.9,
          "eligible_up_to": 101838.9, "earned_today": {"total":0,"gap":0,"ic":0,"reseller":0},
          "ep_estimate": 101838.9 },
  "tbp": { "own_bv": 100000, "gross_bv": 2969000, "direct_downlines": 4,
           "top_distributors": [ {"member_code":"LJW…","name":"…","gbv":1313088}, … ],
           "levels_covered": 2, "quality": "District Admin" },
  "coaching": { "current":"District Admin","next":"Zonal Admin","needed_bv":3031000,
                "requirements":[ "Leg 1: …", … ] },
  "pi": { "total_value": 124427.7, "installments": {"paid":38,"total":38},
          "tds_pct": 5, "service_pct": 5 },
  "widgets": { "business":101838.9, "pi_value":124427.7, "distributors":11,
               "gross_bv":2984160.6, "earning":59750, "withdraw":111988,
               "tbp_gross_bv":2969000, "gift":0 }
}
```

**KEEP (new) — add to schema:** `ep` (eligibility/active contracts),
`tbp.top_distributors` (top downline with GBV — likely its own table),
`coaching` (rank progress & requirements). Store these in new columns/tables.

**Fetcher output shape (to keep `db.mjs` upsertDashboardSnapshot unchanged):**
```js
{
  myBusiness: widgets.business,
  myPromotionalIncentive: widgets.pi_value,
  myPromotionalIncentiveCount: { earned: pi.installments.paid, total: pi.installments.total },
  myDistributors: widgets.distributors,
  myGrossBVolume: widgets.gross_bv,
  myEarning: widgets.earning,
  myWithdraw: widgets.withdraw,
  myTbpGrossBVolume: widgets.tbp_gross_bv,
  myGift: widgets.gift,
}
```
(`upsertDashboardSnapshot` runs `parseAmount` on these; harmless on numbers, so no
DB change needed. Could drop `parseAmount` later for cleanliness.)

---

## 2. Sales Incentive → `GET /member/earnings?stream=IC`  ✅

The "My Incentives" screen, **Sales Incentive (IC)** tab. Endpoint is the earnings
list filtered to the `IC` stream. **Laravel-paginated** — `per_page=20`, follow
`next_page_url` until null (sample: `total=38`, `last_page=2`). Verified against
the on-screen rows (capture 2026-11-03).

| Old `sales_incentive` column | New field | Notes |
|---|---|---|
| `bill_date` | `date` | already ISO `YYYY-MM-DD` — no `parseDdMmYyyy` |
| `invoice_no` | `reference` | |
| `from_distributor` | `from` | |
| `si_value` | `amount` | number |
| `status` | `status` | `"paid"` / `"pending"` (lowercase) |
| `pay_via` | — | **no equivalent in API** → set null, or drop column |

**KEEP (new) — add to schema:** `net` (amount after TDS/charges), `paid_on`
(payment date). Add `net` + `paid_on` columns to `sales_incentive`.

**Row shape:**
```json
{"stream":"IC","date":"2026-10-09","amount":150,"status":"paid",
 "from":"VALLIYAMMAL M","reference":"33835","net":150,"paid_on":"2026-10-09"}
```

**Other streams on the same endpoint** (one call each, same row shape):
`stream=GAP` → Turnover-based Salary (**entity 6**);
`stream=CBC`, `stream=RESELLER` (+`type=…`), `stream=SETTLEMENT` → **new** earning
types the old scraper never had.

---

## 3. Promotional Incentive Pins → `GET /member/earnings?stream=CBC`  ✅

"My Incentives" screen, **Promotional Incentive (CBC)** tab. Paginated; the
`reference` is the pin code. Verified against on-screen rows (capture 2026-11-03).

| Old `promotional_incentive_pins` column | New field | Notes |
|---|---|---|
| `code` | `reference` | pin code e.g. `2NIKDJ` |
| `dated` | `date` | ISO |
| `amount` | `amount` | number |
| `status` | `status` | `pending` / `paid` |
| `category` | — | no equivalent → null or `"CBC"` |

Row: `{"stream":"CBC","date":"2027-07-01","amount":15000,"status":"pending","reference":"2NIKDJ","paid_on":null}`

**KEEP (new):** `paid_on`.
**Change-detection:** old "redeemed" was `active/pending → closed`; now it's
`pending → paid`. Update `upsertPromotionalIncentivePins` diff + Telegram text.

**Fetcher output shape (keep `upsertPromotionalIncentivePins` unchanged):**
```js
{ code: reference, category: null, dated: date, amount, status }
```

---

## 6. Turnover Salary → `GET /member/earnings?stream=GAP` + gap-details  ✅

"My Incentives" screen, **Turnover-based Salary (GAP)** tab. Two calls:

**A) Monthly summary** (`turnover_salary`) ← `GET /member/earnings?stream=GAP`
(paginated; rows are `merged:true` monthly aggregates):

| Old `turnover_salary` column | New field | Notes |
|---|---|---|
| `month` | `month` | `YYYY-MM` |
| `total_tb_salary` | `amount` | gross |
| `net_total` | `net` | after deductions |
| `no_of_packets` | `entries` | "N days of turnover salary" |
| `charges` | derive `amount − net` | not a field |

Row: `{"stream":"GAP","merged":true,"month":"2026-11","amount":44750,"net":40275,"entries":21,"status":"paid"}`

**B) Per-month breakdown** (`turnover_salary_breakdown`) ← `GET /member/earnings/gap-details?month=<YYYY-MM>`
(triggered by "View details"; call once per month). Response `{month,total,net,rows[]}`:

| Old `turnover_salary_breakdown` column | New field (`rows[]`) | Notes |
|---|---|---|
| `from_distributor` | `from` | |
| `distributor_id` | `from_code` | now the member code `LJW…` (was numeric) |
| `tbp_salary` | `amount` | per-contribution gross |

Row: `{"date":"2026-11-01","from":"HAFIZA BEGUM","from_code":"LJW2411297143298","level":1,"amount":5000,"net":4500,"status":"paid"}`

**KEEP (new) — add to schema:** breakdown `level` (downline level), per-row `net`,
`date`, `status`. (Old `distributor_id` was numeric; it's now `from_code` text —
widen the column or add `from_code`.)

**Fetcher output shape (to keep `db.mjs` upsertSalesIncentive unchanged):**
```js
// per row, across all pages:
{ billDate: date, invoiceNo: reference, fromDistributor: from,
  siValue: amount, status, payVia: null }
```
(`upsertSalesIncentive` runs `parseDdMmYyyy(billDate)` + `parseAmount(siValue)`;
`date` is already ISO so `parseDdMmYyyy` returns null → **either pass `date` as
`DD-MM-YYYY`, or relax the DB layer to accept ISO**. Flag for the client build.)

---

## 4 & 5. DigiGold Buy / Sell → `GET /digimarket`  ⚠️ BLOCKED (awaiting data)

> **Deferred (2026-11-04):** DigiGold buy/sell will be done later, by decision.
> Until then `digigold_buy_transactions` / `digigold_sell_transactions` only hold
> old-site data and are not updated (the old Playwright scraper's cron is paused).

The Digi Market overview endpoint carries holdings + a `txns` array that is
almost certainly where buy/sell transactions live — but it is **EMPTY** for the
test account (DOULATH BEGUM has 0.0194 g gold, 0 transactions), so the row shape
for buy/sell could NOT be captured. **Do not guess the fields.**

```json
{"metals":{"gold":{"rate":12730,"grams":0.0194,"value":246.96,"invested":0},
           "silver":{"rate":200,"grams":0,"value":0,"invested":0}},
 "cash_balance":0,"min_buy":100,"platform_fee_pct":1,"txns":[]}
```

**TODO (needs the team / a real transaction):**
- Why is `txns` empty even though the old system had DigiGold buy/sell history?
  (Did DigiGold history not migrate to the new backend? Ask the team.)
- Capture `txns[]` from an account that actually has DigiGold activity (or a
  ₹100 test buy), then map old `digigold_buy_transactions`
  (order_id, buy_date, weight_gm, gold_worth, price_on_day) and
  `digigold_sell_transactions` (sell_date, weight_gm, gold_worth,
  transaction_remarks, wallet_remarks, status), and see whether buy vs sell is a
  `type` field. There may also be a separate history/withdraw endpoint.

---

## New earning streams to keep for future (not in old scraper)

Same endpoint `GET /member/earnings?stream=…`, same row shape
(`date, amount, status, reference, net, paid_on`). Captured as `200` but empty
for the test account — wire them up when data exists:

- **Billing Margin** → `stream=RESELLER` with `type` ∈ { `BILL_MARGIN`,
  `GOLD_MARGIN`, `SILVER_MARGIN`, `STOCK_TRANSFER_MARGIN`, `RD_RENEWAL_MARGIN` }
  (one call per type).
- **Settlement** → `stream=SETTLEMENT`.

Suggested future tables: `reseller_margins` (with a `type` column) and
`settlements`. Not built now — documented so we don't rediscover them.

---

## Build status — mapped items wired (2026-11-03)

New files (additive; the old Playwright scraper is untouched and still works):

```
src/api/client.mjs        fetch wrapper, Bearer auth, stream-preserving paginator,
                          401 -> SessionExpiredError, isoToDdMmYyyy()
src/api/auth.mjs          requestOtp(phone) / verifyOtp(phone, code)
src/api/accounts.mjs      listAccounts(token) / switchAccount(token, account.id)
src/fetchers/goldRate.mjs            -> GET /rates
src/fetchers/dashboard.mjs           -> GET /member/status
src/fetchers/salesIncentive.mjs      -> GET /member/earnings?stream=IC
src/fetchers/promotionalIncentive.mjs-> GET /member/earnings?stream=CBC
src/fetchers/turnoverSalary.mjs      -> GET /member/earnings?stream=GAP (+gap-details)
src/login-api.mjs         OTP login -> stores token    (pnpm run login:api -- <phone>)
src/scrape-api.mjs        orchestrator                 (pnpm run scrape:api)
src/db.mjs                + getPhoneApiToken / savePhoneApiToken / markPhoneSessionExpired
```

Fetchers return the EXACT shapes the existing `db.mjs` upserts expect, so the DB
layer, change-diffing and Telegram alerts are reused unchanged. **Verified live:**
all 5 fetchers returned correct real data (dashboard numbers, 38 SI rows across 2
pages, 12 pins, 3 salary months + 21 breakdown rows).

### One-time DB migration (required)
```sql
ALTER TABLE phone_sessions ADD COLUMN IF NOT EXISTS api_token text;
```

### Optional migration (to persist the "KEEP (new)" fields)
```sql
ALTER TABLE sales_incentive            ADD COLUMN IF NOT EXISTS net numeric, ADD COLUMN IF NOT EXISTS paid_on date;
ALTER TABLE promotional_incentive_pins ADD COLUMN IF NOT EXISTS paid_on date;
-- turnover_salary_breakdown: level int, net numeric, date date, status text
-- dashboard extras (ep / top_distributors / coaching): new tables (TBD)
```
(The fetchers already return these extra fields; `db.mjs` just doesn't map them
yet — add the columns + mapping when ready. Nothing breaks without them.)

### Run
```
pnpm run login:api -- <phone>     # once (OTP via WhatsApp) -> stores token
pnpm run scrape:api               # each run: switch per account, fetch, upsert, persist token
```

### Not wired (by decision)
- DigiGold buy/sell (entities 4 & 5) — blocked, `/digimarket` txns empty.
- RESELLER / SETTLEMENT streams — new, documented, empty for now.
- `scrape-api` doesn't yet have its own GitHub Actions workflow (old `scrape.yml`
  still drives Playwright). Add a parallel `scrape-api.yml` (no Chromium install)
  when ready to cut over.
