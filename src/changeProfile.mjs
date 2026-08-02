import { BASE_URL } from "./browser.mjs";

/**
 * Switches the active member profile within an already-authenticated session.
 * No-op if the target account is already active.
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

  const activeCard = page.locator(".list-card.active").filter({ hasText: memberId });
  if (await activeCard.count() > 0) {
    return;
  }

  const setDefaultBtn = page.locator(`a.setasprofilebtn[id="${memberId}"]`);
  await setDefaultBtn.waitFor({ state: "visible", timeout: 10000 });
  await setDefaultBtn.click();
  await page.waitForTimeout(1000);
}
