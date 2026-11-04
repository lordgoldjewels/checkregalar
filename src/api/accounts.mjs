// Linked-account listing + switching.
//
// IMPORTANT: POST /me/switch is a full re-auth - it returns a NEW token and
// REVOKES the one you called it with. Callers MUST adopt the returned token for
// that account's subsequent calls, or they get 401. Because the scraper runs
// sequentially (one account at a time) it never hits the race that logs the
// interactive app out - as long as it always uses the freshest token.

import { apiGet, apiPost } from "./client.mjs";

// GET /me/accounts -> [{ id, member_code, name, status, branch, current }]
export async function listAccounts(token) {
  const data = await apiGet(token, "/me/accounts");
  return data.data ?? [];
}

// POST /me/switch { member_id } -> { token, mode, member }
// Returns the NEW token; use it from here on for this account.
//
// The `member_id` is the `id` field from /me/accounts on the SAME backend
// (lordicl.com). (A past mismatch was just a cross-backend artifact: next.lordicl
// used a different id space.) So: switchAccount(token, account.id).
export async function switchAccount(token, memberId) {
  const data = await apiPost(token, "/me/switch", { member_id: memberId });
  return { token: data.token, mode: data.mode, member: data.member ?? null };
}
