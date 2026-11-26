// Demo mode, no API key: walk the whole co-planning flow through the real UI.
//
//   docker compose -p sf-e2e -f docker-compose.yml -f e2e/compose.e2e.yml -f e2e/compose.demo.yml up -d --build
//   pnpm e2e:demo                     # E2E_CHANNEL=chrome to use the local Chrome
//   docker compose -p sf-e2e -f docker-compose.yml -f e2e/compose.e2e.yml -f e2e/compose.demo.yml down -v --rmi local
// Optional first argument: a directory for step screenshots.
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:58080';
const SHOTS = process.argv[2];
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};
const shot = async (page, name) => SHOTS && page.screenshot({ path: `${SHOTS}/demo-${name}.png` });

const browser = await chromium.launch(process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL } : {});
const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const aiCalls = [];
page.on('response', (r) => {
  const u = new URL(r.url());
  if (u.pathname.startsWith('/api/v1/ai/')) aiCalls.push(`${r.request().method()} ${u.pathname} ${r.status()}`);
});
// Pre-generation prompts ("补几项关键条件？", "确认重新生成？"): take the path that proceeds.
const PROCEED = /先给初稿|确认重新生成|确认生成|确认替换|继续生成|确认/;
const confirmIfAsked = async () => {
  await page.waitForTimeout(800);
  for (const role of ['alertdialog', 'dialog']) {
    const dlg = page.getByRole(role).last();
    if (await dlg.isVisible().catch(() => false)) {
      const btn = dlg.getByRole('button', { name: PROCEED }).first();
      if (await btn.isVisible().catch(() => false)) {
        await btn.click();
        return;
      }
    }
  }
};
const bodyHas = (text, timeout = 20000) =>
  page.waitForFunction((t) => document.body.innerText.includes(t), text, { timeout }).then(() => true, () => false);

// 1. Start from the co-planning entry page
await page.goto(`${BASE}/plan`);
await page.getByPlaceholder(/描述你的活动想法/).fill('下个月想给团队办一场轻松的团建，大概 20 人');
await page.getByRole('button', { name: /开始共同策划/ }).click();
await page.waitForURL(/\/workbench\//, { timeout: 30000 });
await page.getByPlaceholder('活动名称').waitFor({ timeout: 20000 });
check('demo badge shown', await bodyHas('演示模式'));
check('chat reply with direction cards', await bodyHas('城市漫步寻宝'));
await shot(page, '1-chat');

// 2. Regenerate directions through the structured endpoint (chat already proposed some)
await page.getByRole('button', { name: '更新方向' }).click();
await confirmIfAsked();
check('directions regenerated (structured)', await page
  .waitForResponse((r) => r.url().endsWith('/api/v1/ai/plan/directions') && r.status() === 200, { timeout: 30000 })
  .then(() => true, () => false));
await page.waitForTimeout(1000);

// 3. Pick a direction and generate the full scheme
await page.getByText('草地野餐交流会', { exact: true }).last().click();
await page.getByRole('button', { name: '生成完整方案' }).click();
await page.waitForTimeout(800);
await confirmIfAsked();
check('scheme generated (schedule from demo fixture)', await bodyHas('签到与领取名牌', 30000));
await shot(page, '2-scheme');

// 4. Regenerate the theme only: with an existing theme it arrives as a draft to adopt
await page.getByRole('button', { name: '重新生成' }).first().click();
await confirmIfAsked();
const adopt = page.getByRole('button', { name: '采纳并更新到成果' }).last();
check('theme draft offered', await adopt.waitFor({ timeout: 30000 }).then(() => true, () => false));
await adopt.click();
check('theme adopted', await bodyHas('跨部门混搭分桌', 15000));

// 5. Copies
await page.getByRole('button', { name: /生成文案/ }).first().click();
await page.waitForTimeout(800);
await confirmIfAsked();
check('copies generated', await bodyHas('期待与你在草地上相见', 30000) || await bodyHas('欢迎来到「草地合伙人」'));
await shot(page, '3-copies');

// 6. Adjustment card through chat, then confirm it
const box = page.getByPlaceholder(/说说你的想法/);
await box.fill('只把配色改成薄荷绿与米白，其他都不动');
await box.press('Enter');
check('adjustment card shown', await bodyHas('确认调整', 30000));
await page.getByRole('button', { name: '确认调整' }).last().click();
check('adjustment applied (visual theme updated)', await bodyHas('薄荷绿与米白', 20000));
await shot(page, '4-adjust');

// 7. Scene generation with a sample venue (demo returns the prepared "after" image)
await page.getByRole('button', { name: '场景布置' }).first().click();
await page.getByRole('button', { name: '选用 户外草坪 的场地图' }).click();
await confirmIfAsked();
await page.getByRole('button', { name: '生成布置效果图' }).first().click();
await confirmIfAsked();
const sceneDone = await page
  .waitForResponse(
    async (r) =>
      r.url().endsWith('/api/v1/ai/scene/query') && (await r.json().catch(() => ({}))).task_status === 'succeed',
    { timeout: 60000 },
  )
  .then(() => true, () => false);
check('scene generated from sample venue', sceneDone);
await page.waitForTimeout(3000);
const afterShown = await page.$$eval('img', (imgs) => imgs.some((i) => /\/media\/(generated|venue)\//.test(i.src) && i.naturalWidth > 0));
check('generated layout image displayed', afterShown);
await shot(page, '7-scene');

const modes = ['directions', 'theme', 'scheme', 'copies'].filter((m) => aiCalls.some((c) => c.includes(`/plan/${m} 200`)));
check('all four structured modes exercised', modes.length === 4, modes.join(','));
console.log('AI calls:', JSON.stringify([...new Set(aiCalls)]));
check('no failed AI calls', aiCalls.every((c) => / 2\d\d$/.test(c)), aiCalls.filter((c) => !/ 2\d\d$/.test(c)).join(', '));
await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
