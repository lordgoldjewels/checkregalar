import { BASE_URL } from "./browser.mjs";

/**
 * Reads the active member ID from the changeprofile page. Must be called
 * while on that page. Only reads the card's own ID line (.post-catagory) -
 * the card's full text also contains its upline's ID ("Upline : NAME
 * (LJW...)"), so a whole-card text match would mistake a downline's active
 * card for its upline. The sidebar "#<member-id>" is no use either: it stays
 * stuck on whichever account was active when the session started.
 */
export async function getActiveMemberId(page) {
  return (await page.locator(".list-card.active .post-catagory").innerText()).trim();
}

/** Throws unless memberId is the profile the site currently serves data for. */
export async function assertActiveAccount(page, memberId) {
  await page.goto(`${BASE_URL}/app/member/changeprofile`);
  const active = await getActiveMemberId(page);
  if (active !== memberId) {
    throw new Error(`active profile is ${active}, expected ${memberId}`);
  }
}

/**
 * Switches the active member profile within an already-authenticated session.
 * No-op if the target account is already active. Throws if the switch
 * doesn't take effect, so callers never scrape the wrong account's data.
 */
export async function switchToAccount(page, memberId) {
  // Navigate the same way a real user would: Home -> Account tab -> Change,
  // rather than jumping straight to the changeprofile URL.
  await page.goto(`${BASE_URL}/app/home`);
  await page.locator('a:has-text("Account")').last().click();
  await page.waitForLoadState("load");

  // ".list-card.active" only exists on the changeprofile page itself, not
  // on the dashboard we land on after clicking "Account" - so we must
  // navigate to changeprofile (via "Change") before checking active status.
  const changeLink = page.locator('a:has-text("Change")');
  if (await changeLink.count() > 0) {
    await changeLink.click();
    await page.waitForLoadState("load");
  }

  if ((await getActiveMemberId(page)) === memberId) {
    return;
  }

  const setDefaultBtn = page.locator(`a.setasprofilebtn[id="${memberId}"]`);
  await setDefaultBtn.waitFor({ state: "visible", timeout: 10000 });
  // The button's handler POSTs changemainprofile, then location.reload()s
  // on success - wait for both rather than a fixed sleep.
  await Promise.all([
    page.waitForResponse(
      (r) => r.url().includes("/auth/changemainprofile") && r.request().method() === "POST",
      { timeout: 30000 }
    ),
    page.waitForNavigation({ timeout: 30000 }),
    setDefaultBtn.click(),
  ]);

  const active = await getActiveMemberId(page);
  if (active !== memberId) {
    throw new Error(`profile switch failed: active is ${active}, expected ${memberId}`);
  }
}
