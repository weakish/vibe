import { expect, test } from "@playwright/test";

const slash = 'path[d="M4 4 L20 20"]';

test.describe("bell toggle", () => {
  test("starts off; click and Space flip aria-pressed and slash", async ({
    page,
  }) => {
    await page.goto("/");
    const bell = page.locator("button.bell");
    await expect(bell).toBeVisible();
    await expect(bell).toHaveAttribute("aria-pressed", "false");
    await expect(bell.locator("kbd.bell-shortcut")).toHaveText("Space");
    await expect(bell.locator(slash)).toHaveCount(1);

    await bell.click();
    await expect(bell).toHaveAttribute("aria-pressed", "true");
    await expect(bell.locator(slash)).toHaveCount(0);

    await page.keyboard.press("Space");
    await expect(bell).toHaveAttribute("aria-pressed", "false");
    await expect(bell.locator(slash)).toHaveCount(1);
  });

  test("Space on the page toggles; clicking the time does not", async ({
    page,
  }) => {
    await page.goto("/");
    const bell = page.locator("button.bell");
    await expect(bell).toHaveAttribute("aria-pressed", "false");

    await page.locator(".app > div").click();
    await expect(bell).toHaveAttribute("aria-pressed", "false");

    await page.locator("body").click({ position: { x: 8, y: 8 } });
    await page.keyboard.press("Space");
    await expect(bell).toHaveAttribute("aria-pressed", "true");
    await expect(bell.locator(slash)).toHaveCount(0);
  });
});
