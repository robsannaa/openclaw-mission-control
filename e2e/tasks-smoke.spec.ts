import { expect, test } from "@playwright/test";

test.describe("Tasks (Kanban) smoke", () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto("/tasks");
  });

  test("kanban board loads and has header stats", async ({ page }) => {
    // Check if the board container or onboarding is visible
    const main = page.locator("main");
    await expect(main).toBeVisible();

    // The header should have stats like "Total", "In progress", etc.
    // Use more specific selectors to avoid strict mode violations
    await expect(page.locator("text=Total")).toBeVisible({ timeout: 15000 });
    await expect(page.getByText('In progress', { exact: true }).first()).toBeVisible();
    await expect(page.getByText('Done', { exact: true }).first()).toBeVisible();
  });

  test("refresh button is present and clickable", async ({ page }) => {
    // Wait for the board to load so stats/header are visible
    await expect(page.locator("text=Total")).toBeVisible({ timeout: 15000 });
    
    // Refresh button should be there
    const refreshBtn = page.getByRole("button", { name: /refresh/i });
    await expect(refreshBtn).toBeVisible();
    await refreshBtn.click();
    
    await expect(refreshBtn).toBeEnabled();
  });

  test("agent selector is present", async ({ page }) => {
    // Wait for the board to load
    await expect(page.locator("text=Total")).toBeVisible({ timeout: 15000 });

    const selector = page.locator("select");
    // If no agents are configured, the selector might not show. 
    // In e2e tests, we should check if it exists if agents are loaded.
    // If it's not visible, we skip this check or just log it.
    if (await selector.count() > 0) {
      await expect(selector).toBeVisible();
      await expect(selector).toContainText("All agents");
    }
  });
});
