// Gold rate -> GET /rates (public). Returns the per-gram gold rate (number),
// matching the old scrapeGoldRate() contract fed to insertGoldRate().
import { apiGet } from "../api/client.mjs";

export async function fetchGoldRate(token) {
  // { gold, silver, diamond, effective_at }
  const rates = await apiGet(token, "/rates");
  return rates.gold; // per-gram, number
}
