// One-time OTP login to the new API. Sends the OTP (WhatsApp), prompts for the
// code, then stores the bearer token in phone_sessions.api_token so scrape-api
// can resume without OTP. Usage: node src/login-api.mjs <phone>
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { dbEnabled, savePhoneApiToken } from "./db.mjs";
import { requestOtp, verifyOtp } from "./api/auth.mjs";

const phone = process.argv[2];
if (!phone) {
  console.error("Usage: node src/login-api.mjs <phone-number>");
  process.exit(1);
}
if (!dbEnabled) {
  console.error("Supabase not configured - set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const rl = readline.createInterface({ input: stdin, output: stdout });
try {
  console.log(`Requesting OTP for ${phone} (delivered via WhatsApp)...`);
  await requestOtp(phone);
  const code = (await rl.question("Enter the OTP code: ")).trim();
  const { token, mode, member } = await verifyOtp(phone, code);
  await savePhoneApiToken(phone, token);
  console.log(`✓ Logged in as ${member?.name ?? "?"} (${member?.member_code ?? "?"}), mode=${mode}.`);
  console.log(`  Token stored for ${phone}. You can now run: npm run scrape:api`);
} catch (err) {
  console.error(`Login failed: ${err.message}`);
  process.exit(1);
} finally {
  rl.close();
}
