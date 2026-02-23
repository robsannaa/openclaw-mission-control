import { expect, test } from "@playwright/test";

const SIDEBAR_LINKS: Array<{ href: string; urlPattern: RegExp }> = [
  { href: "/dashboard", urlPattern: /\/dashboard(?:\?|$)/ },
  { href: "/chat", urlPattern: /\/chat(?:\?|$)/ },
  { href: "/channels", urlPattern: /\/channels(?:\?|$)/ },
  { href: "/agents", urlPattern: /\/agents(?:\?|$)/ },
  { href: "/agents?tab=subagents", urlPattern: /\/agents\?tab=subagents(?:&|$)/ },
  { href: "/tasks", urlPattern: /\/tasks(?:\?|$)/ },
  { href: "/sessions", urlPattern: /\/sessions(?:\?|$)/ },
  { href: "/cron", urlPattern: /\/cron(?:\?|$)/ },
  { href: "/heartbeat", urlPattern: /\/heartbeat(?:\?|$)/ },
  { href: "/memory", urlPattern: /\/memory(?:\?|$)/ },
  { href: "/docs", urlPattern: /\/docs(?:\?|$)/ },
  { href: "/vectors", urlPattern: /\/vectors(?:\?|$)/ },
  { href: "/skills", urlPattern: /\/skills(?:\?|$)/ },
  { href: "/skills?tab=clawhub", urlPattern: /\/skills\?tab=clawhub(?:&|$)/ },
  { href: "/models", urlPattern: /\/models(?:\?|$)/ },
  { href: "/accounts", urlPattern: /\/accounts(?:\?|$)/ },
  { href: "/audio", urlPattern: /\/audio(?:\?|$)/ },
  { href: "/browser", urlPattern: /\/browser(?:\?|$)/ },
  { href: "/search", urlPattern: /\/search(?:\?|$)/ },
  { href: "/tailscale", urlPattern: /\/tailscale(?:\?|$)/ },
  { href: "/permissions", urlPattern: /\/permissions(?:\?|$)/ },
  { href: "/usage", urlPattern: /\/usage(?:\?|$)/ },
  { href: "/terminal", urlPattern: /\/terminal(?:\?|$)/ },
  { href: "/logs", urlPattern: /\/logs(?:\?|$)/ },
  { href: "/config", urlPattern: /\/config(?:\?|$)/ },
];

const KEY_APIS = [
  "/api/live",
  "/api/system",
  "/api/channels?scope=status",
  "/api/agents",
  "/api/models?scope=status",
  "/api/audio",
  "/api/vector?scope=status",
  "/api/permissions",
  "/api/skills",
  "/api/heartbeat",
  "/api/cron?action=targets",
];

test.describe("Mission Control smoke", () => {
  test("sidebar routes open without load-failure banners", async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto("/dashboard");

    const sidebar = page.locator("nav").first();
    await expect(sidebar).toBeVisible();

    for (const entry of SIDEBAR_LINKS) {
      const link = sidebar.locator(`a[href="${entry.href}"]`).first();
      await expect(link, `Missing sidebar link: ${entry.href}`).toBeVisible();
      await page.goto(entry.href, { waitUntil: "domcontentloaded" });
      await expect(page, `Unexpected URL after opening ${entry.href}`).toHaveURL(entry.urlPattern);
      await expect(page.locator("main")).not.toContainText(/failed to load/i, { timeout: 3000 });
    }
  });

  test("key APIs respond without server errors", async ({ request }) => {
    for (const endpoint of KEY_APIS) {
      const response = await request.get(endpoint, { failOnStatusCode: false });
      expect(
        response.status(),
        `${endpoint} returned status ${response.status()}`
      ).toBeLessThan(500);
      const payload = await response.json();
      expect(payload, `${endpoint} returned empty JSON payload`).toBeTruthy();
    }
  });
});
