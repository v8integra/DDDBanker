import type { Page } from '@playwright/test';
import { expect, expectNoAxeViolations, test } from './fixtures';

// Seed demo account (apps/api/prisma/seed.ts).
const DEMO = { email: 'demo@bramblewood.test', password: 'bramblewood-demo-2026' };

const topDialog = (page: Page) => page.locator('dialog[open]').last();

async function checkIn(page: Page) {
  await page.getByRole('button', { name: 'Check in', exact: true }).first().click();
  await topDialog(page).getByRole('button', { name: 'Check in', exact: true }).click();
  await page.getByLabel('Email').fill(DEMO.email);
  await page.getByLabel('Password', { exact: true }).fill(DEMO.password);
  await topDialog(page).getByRole('button', { name: 'Check in', exact: true }).click();
  await expect(topDialog(page)).toContainText('checked in');
  await topDialog(page).getByRole('button', { name: 'Okay' }).click();
  await expect(page.locator('.classic-status')).toHaveText('Checked in as Robin Demo.');
}

test.describe('classic view', () => {
  test('has no axe violations when checked out', async ({ page }) => {
    await page.goto('/classic.html');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Bank of Bramblewood');
    await expectNoAxeViolations(page);
  });

  test('hall stations wait for check-in', async ({ page }) => {
    await page.goto('/classic.html');
    const teller = page.locator('[data-station="teller"]');
    await expect(teller).toHaveAttribute('aria-disabled', 'true');
    // aria-disabled (not disabled) keeps it focusable, so people hear why.
    await teller.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(page.getByRole('status').last()).toHaveText(/check in first/i);
  });

  test('checks in, shows accounts, and runs the teller', async ({ page }) => {
    await page.goto('/classic.html');
    await checkIn(page);

    const table = page.getByRole('table', { name: 'Your open accounts and balances' });
    await expect(table).toContainText('Everyday Checking');
    await expectNoAxeViolations(page);

    const teller = page.locator('[data-station="teller"]');
    await teller.click();
    const dialog = topDialog(page);
    await expect(dialog).toHaveAccessibleName('Rowan');
    await expect(dialog).toHaveAccessibleDescription(/how can I help/i);
    await expect(dialog.getByRole('button', { name: 'My balances' })).toBeFocused();
    await expectNoAxeViolations(page);

    await dialog.getByRole('button', { name: 'My balances' }).click();
    await expect(topDialog(page).getByRole('table')).toContainText('Everyday Checking');
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');

    await topDialog(page)
      .getByRole('button', { name: /That's all/ })
      .click();
    await expect(page.locator('dialog[open]')).toHaveCount(0);
    await expect(page.locator('[data-station="teller"]')).toBeFocused();

    await page.getByRole('button', { name: 'Check out', exact: true }).click();
    await expect(topDialog(page)).toBeVisible();
  });

  test('display settings apply high contrast and colorblind colors', async ({ page }) => {
    await page.goto('/classic.html');
    await page.getByRole('button', { name: 'Display settings' }).click();
    await page.getByLabel('High contrast menus').check();
    await page.getByLabel('Status colors').selectOption('colorblind');
    const root = page.locator('html');
    await expect(root).toHaveAttribute('data-contrast', 'high');
    await expect(root).toHaveAttribute('data-status-colors', 'colorblind');
    await page.keyboard.press('Escape');
    await expectNoAxeViolations(page);
  });
});
