// Thin HTTP client for the new LORDICL REST API (replaces the Playwright
// browser scrape). Base host moved from next.lordicl.com -> lordicl.com with
// the 3.11.15 app; next.lordicl.com now only 301-redirects, so always use
// lordicl.com. Auth is a Sanctum bearer token.
//
// Node 22 has global fetch + AbortSignal.timeout, so no deps needed.

export const API_BASE = "https://lordicl.com/api/v1";
export const DEFAULT_TIMEOUT_MS = 20000;

// Thrown on a 401 so callers can treat it as "session expired" (re-login / alert)
// instead of a generic failure. The app's own 401 handling is what logs users
// out; for the scraper we surface it explicitly and keep going per-account.
export class SessionExpiredError extends Error {
  constructor(message) {
    super(message);
    this.name = "SessionExpiredError";
  }
}

// Mirror the LORDICL app's okhttp requests exactly (verified against capture.har
// on host lordicl.com, app 3.11.15). Fields are built in the order the app puts
// them on the wire: accept, x-locale, [authorization], accept-encoding,
// [content-type], user-agent. okhttp is 4.12.0 in this build. accept-encoding
// advertises zstd/br/gzip like the app; the server replies gzip and Node 24's
// undici decodes it transparently (and zstd too, if the server ever uses it).
// x-locale=en keeps responses in English. content-type is only sent when there
// is a request body, matching the app (empty POSTs go out with no content-type).
// Note: Node/undici may renormalize header order/case on the wire and uses its
// own TLS stack, so a byte- or JA3-exact match isn't possible from Node; the
// names/values here are what the server actually checks, and these are verified
// working against the live API.
function headers(token, { contentType } = {}) {
  const h = { accept: "application/json", "x-locale": "en" };
  if (token) h.authorization = `Bearer ${token}`;
  h["accept-encoding"] = "zstd, br, gzip";
  if (contentType) h["content-type"] = contentType;
  h["user-agent"] = "okhttp/4.12.0";
  return h;
}

async function parse(res, path) {
  if (res.status === 401) throw new SessionExpiredError(`401 Unauthenticated on ${path}`);
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${res.status} on ${path}${body ? `: ${body.slice(0, 200)}` : ""}`);
  }
  return res.json();
}

export async function apiGet(token, path, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "GET",
    headers: headers(token),
    signal: AbortSignal.timeout(timeoutMs),
  });
  return parse(res, path);
}

export async function apiPost(token, path, body, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const hasBody = body != null;
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    // content-type only when there's a body, like the app.
    headers: headers(token, hasBody ? { contentType: "application/json" } : undefined),
    body: hasBody ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  return parse(res, path);
}

// Walks a Laravel paginator and returns the flattened `data` rows. `path` may
// carry a query string (e.g. "?stream=IC"). We append &page=N to the ORIGINAL
// path rather than following next_page_url, because the server's next_page_url
// DROPS the query filter (observed: ".../member/earnings?page=2" with no
// stream), which would silently return unfiltered rows.
export async function apiGetAllPages(token, path) {
  const rows = [];
  const sep = path.includes("?") ? "&" : "?";
  let page = 1;
  let lastPage = 1;
  do {
    const body = await apiGet(token, `${path}${sep}page=${page}`);
    rows.push(...(body.data ?? []));
    lastPage = body.last_page ?? page;
    page += 1;
  } while (page <= lastPage && page <= 500);
  return rows;
}

// ISO "2026-10-09" -> "09-10-2026" so the existing db.mjs parseDdMmYyyy()
// keeps working unchanged (it expects DD-MM-YYYY). Pass-through for anything
// that isn't a plain ISO date.
export function isoToDdMmYyyy(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || "");
  return m ? `${m[3]}-${m[2]}-${m[1]}` : iso;
}
