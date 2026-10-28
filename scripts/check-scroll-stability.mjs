// Optional real-layout check: use an existing Playwright installation; no new app dependency.
/* global window, document, scrollY */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createServer } from 'vite';

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE ?? 'playwright');
await mkdir('work/scroll', { recursive: true });
const server = await createServer({ envDir: resolve('work/scroll'), server: { host: '127.0.0.1', port: 0, strictPort: false } });
await server.listen();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined, headless: true, args: ['--no-sandbox'] });
const report = { browser: browser.version(), viewport: { width: Number(process.env.SCROLL_VIEWPORT_WIDTH ?? 820), height: Number(process.env.SCROLL_VIEWPORT_HEIGHT ?? 1180) }, cases: [] };
const failures = [];
try {
  for (const mode of ['local', 'shared']) {
    const page = await browser.newPage({ viewport: report.viewport, hasTouch: true });
    await page.clock.install();
    // No remote requests, including accidental future fixture changes.
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    page.setDefaultTimeout(15000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`${server.resolvedUrls.local[0]}scripts/fixtures/scroll.html`);
    await page.getByRole('button', { name: 'Manage roster', exact: true }).waitFor();
    if (mode === 'shared') {
      await page.getByRole('radio', { name: 'Restaurant roster', exact: true }).check();
      const participants = page.getByRole('group', { name: 'Participating employees', exact: true });
      await participants.waitFor();
      const toggles = participants.getByRole('button', { expanded: false });
      assert.ok(await toggles.count() > 0, 'Roles start collapsed');
      assert.equal(await participants.getByRole('checkbox').count(), 0);
      while (await toggles.count()) await toggles.first().click();
      await participants.getByRole('checkbox').last().waitFor();
      await participants.getByRole('checkbox').last().scrollIntoViewIfNeeded();
      const beforeSelection = await page.evaluate(() => ({ y: scrollY, events: window.scrollFixture.events.filter(event => event.type.startsWith('request:')).length }));
      await participants.getByRole('checkbox').last().tap();
      const afterSelection = await page.evaluate(() => ({ y: scrollY, events: window.scrollFixture.events.filter(event => event.type.startsWith('request:')).length }));
      assert.deepEqual(afterSelection, beforeSelection, 'An ordinary selection tap must not scroll or refresh access');
      await page.getByLabel('Temporary share weight · Synthetic Employee 50', { exact: true }).fill('75.25');
      await page.getByLabel('Temporary participant name', { exact: true }).fill('Synthetic Guest');
      await page.getByLabel('Job title / role label', { exact: true }).fill('Synthetic helper');
      await page.getByLabel('Initial share weight', { exact: true }).fill('25');
      await page.getByRole('button', { name: 'Add temporary participant', exact: true }).click();
      await page.getByLabel('Temporary participant name', { exact: true }).fill('Synthetic draft');
    }
    const cash = page.getByRole('textbox', { name: 'Cash Tips ($)', exact: true });
    const credit = page.getByRole('textbox', { name: 'Credit Tips ($)', exact: true });
    const rounding = page.getByRole('checkbox', { name: 'Round down to whole dollar', exact: true });
    await cash.fill('100.01');
    await credit.fill('25.50');
    await rounding.check();
    await rounding.scrollIntoViewIfNeeded();
    const ordinaryBefore = await page.evaluate(() => ({ y: scrollY, requests: window.scrollFixture.events.filter(event => event.type.startsWith('request:')).length }));
    await rounding.tap(); await rounding.tap();
    const ordinaryAfter = await page.evaluate(() => ({ y: scrollY, requests: window.scrollFixture.events.filter(event => event.type.startsWith('request:')).length }));
    assert.deepEqual(ordinaryAfter, ordinaryBefore, 'Ordinary rounding taps must not scroll or refresh access');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${mode}: no horizontal overflow`);
    if (mode === 'shared') {
      for (const toggle of await page.locator('button[aria-expanded]').all()) {
        assert.ok((await toggle.boundingBox()).height >= 48, 'Role header must be a comfortable touch target');
      }
    }
    // Drop input focus: no keyboard or focus-scroll explanation is required.
    await page.evaluate(() => document.activeElement.blur());
    await rounding.scrollIntoViewIfNeeded();
    await page.evaluate(() => {
      window.scrollProbe = {
        cash: document.querySelector('#shared-cash-tips') ?? document.querySelector('#cash-tips'),
        row: document.querySelector('[aria-label="Shared employee Synthetic Employee 50"]'),
        timeOrigin: performance.timeOrigin,
      };
    });
    const sample = async () => page.evaluate(() => {
      const summary = document.querySelector('[aria-labelledby="shared-roster-title"]');
      const participantList = [...document.querySelectorAll('fieldset')].find(el => el.querySelector('legend')?.textContent === 'Participating employees');
      return {
        requests: window.scrollFixture.events.filter(event => event.type.startsWith('request:')).length,
        scrollY, documentHeight: document.documentElement.scrollHeight,
        summaryHeight: summary.getBoundingClientRect().height,
        summaryVisible: [...summary.querySelectorAll('button')].some(button => button.textContent === 'Manage roster'),
        participantHeight: participantList?.getBoundingClientRect().height ?? 0,
        participantVisible: participantList ? window.getComputedStyle(participantList).visibility === 'visible' : null,
        cashConnected: window.scrollProbe.cash.isConnected,
        rowConnected: window.scrollProbe.row?.isConnected ?? null,
        sameDocument: performance.timeOrigin === window.scrollProbe.timeOrigin,
        focused: document.activeElement.tagName,
      };
    });
    for (const trigger of ['focus', 'visibility', 'online', 'minute', 'burst', 'auth']) {
      if (trigger === 'auth' && mode === 'local') continue;
      await (mode === 'local' ? page.getByRole('group', { name: 'Employee Synthetic Employee 50', exact: true }) : rounding).scrollIntoViewIfNeeded();
      const before = await sample();
      await page.evaluate(trigger => {
        window.scrollFixture.hold();
        if (trigger === 'focus') window.dispatchEvent(new Event('focus'));
        if (trigger === 'visibility') document.dispatchEvent(new Event('visibilitychange'));
        if (trigger === 'online') window.dispatchEvent(new Event('online'));
        if (trigger === 'burst') {
          window.dispatchEvent(new Event('focus'));
          document.dispatchEvent(new Event('visibilitychange'));
          window.scrollFixture.auth();
        }
        if (trigger === 'auth') window.scrollFixture.auth();
      }, trigger);
      if (trigger === 'minute') await page.clock.runFor(60_000);
      await page.waitForTimeout(150);
      const during = await sample();
      await page.evaluate(() => window.scrollFixture.release());
      await page.getByRole('heading', { name: 'Calculation preview · Not saved', exact: true }).waitFor();
      await page.getByText('Checking restaurant access…', { exact: true }).waitFor({ state: 'hidden' });
      await page.waitForTimeout(150);
      const after = await sample();
      report.cases.push({ mode, trigger, before, during, after });
      try {
        assert.ok(during.requests > before.requests, `${mode}/${trigger}: verification must run`);
        assert.ok(Math.abs(before.scrollY - during.scrollY) <= 1, `${mode}/${trigger}: pending scroll changed`);
        assert.ok(Math.abs(before.scrollY - after.scrollY) <= 1, `${mode}/${trigger}: completed scroll changed`);
        assert.equal(during.summaryHeight, before.summaryHeight);
        if (mode === 'local') assert.equal(during.summaryVisible, true);
        assert.equal(during.documentHeight, before.documentHeight);
        assert.equal(during.participantHeight, before.participantHeight);
        if (mode === 'shared') assert.equal(during.participantVisible, true);
        assert.equal(during.cashConnected, true);
        assert.equal(after.sameDocument, true);
        if (mode === 'shared') assert.equal(during.rowConnected, true);
      } catch (error) { failures.push(error.message); }
    }
    assert.equal(await cash.inputValue(), '100.01');
    assert.equal(await credit.inputValue(), '25.50');
    assert.equal(await rounding.isChecked(), true);
    if (mode === 'shared') {
      assert.equal(await page.getByLabel('Temporary share weight · Synthetic Employee 50', { exact: true }).inputValue(), '75.25');
      assert.equal(await page.getByLabel('Temporary participant name', { exact: true }).inputValue(), 'Synthetic draft');
      assert.equal(await page.getByRole('group', { name: 'Temporary participant Synthetic Guest', exact: true }).count(), 1);
    }
    await page.evaluate(() => { window.scrollFixture.revoke(); window.dispatchEvent(new Event('focus')); });
    await page.getByText('No restaurant access assigned', { exact: true }).waitFor();
    assert.equal(await page.getByRole('group', { name: 'Participating employees', exact: true }).count(), 0);
    assert.equal(await page.getByRole('group', { name: 'Temporary participant Synthetic Guest', exact: true }).count(), 0);
    assert.equal(await page.locator('[aria-labelledby="shared-roster-title"] li').count(), 0);
    assert.deepEqual(errors, []);
    report[`${mode}Events`] = await page.evaluate(() => window.scrollFixture.events);
    await page.close();
  }
} finally {
  await browser.close();
  await server.close();
  report.failures = failures;
  await writeFile('work/scroll/result.json', JSON.stringify(report, null, 2));
}
console.log(JSON.stringify({ browser: report.browser, cases: report.cases, failures }, null, 2));
assert.deepEqual(failures, [], 'Scroll/layout regression; see work/scroll/result.json');
