// Phone-OTP auth against the new API. Replaces the Playwright cookie login.
//
//   requestOtp(phone)            -> sends the OTP (delivered via WhatsApp)
//   verifyOtp(phone, code)       -> { token, mode, member }
//
// NOTE: OTP is rate/volume-capped on the WhatsApp side, so logging in should be
// rare. The scraper logs in once, then chains tokens via account switches (see
// accounts.mjs) and persists the latest token between runs - no per-run OTP.

import { apiPost } from "./client.mjs";

export async function requestOtp(phone) {
  // 200 with no useful body; throws on failure.
  await apiPost(null, "/auth/otp/request", { phone: String(phone) });
  return true;
}

export async function verifyOtp(phone, code, deviceName = "android") {
  // Response shape (same as /me/switch): { token, mode, member, customer }
  const data = await apiPost(null, "/auth/otp/verify", {
    phone: String(phone),
    code: String(code),
    device_name: deviceName,
  });
  return { token: data.token, mode: data.mode, member: data.member ?? null };
}
