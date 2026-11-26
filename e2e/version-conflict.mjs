// Two browser windows, same guest, same project: verify the optimistic-lock conflict dialog.
//
// Run against an isolated full stack (own container names and ports):
//   docker compose -p sf-e2e -f docker-compose.yml -f e2e/compose.e2e.yml up -d --build
//   pnpm e2e:conflict                    # E2E_CHANNEL=chrome to use the local Chrome
//   docker compose -p sf-e2e -f docker-compose.yml -f e2e/compose.e2e.yml down -v --rmi local
// Optional: pass a directory as the first argument to save a screenshot of the dialog.
import { chromium } from 'playwright';

const BASE = process.env.E2E_BASE || 'http://127.0.0.1:58080';
const SHOTS = process.argv[2];
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  (${detail})` : ''}`);
};

const browser = await chromium.launch(process.env.E2E_CHANNEL ? { channel: process.env.E2E_CHANNEL } : {});
const viewport = { width: 1440, height: 900 };

// --- window A: become a guest, create a project through the API
const ctxA = await browser.newContext({ viewport });
const a = await ctxA.newPage();
await a.goto(`${BASE}/`);
await a.waitForFunction(() => !!localStorage.getItem('sf-access-token'), null, { timeout: 15000 });
const projectId = await a.evaluate(async () => {
  const token = localStorage.getItem('sf-access-token');
  const data = { description: '', requirements: {}, directions: [], schedule: [], budget: { limit: null, items: [] },
    materials: [], tasks: [], copies: {}, scene: {}, chatLog: [] };
  const r = await fetch('/api/v1/project', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ title: '冲突测试', data }),
  });
  return (await r.json()).id;
});
check('project created', !!projectId, projectId);

// --- window B: same browser storage => same guest identity
const ctxB = await browser.newContext({ viewport, storageState: await ctxA.storageState() });
const b = await ctxB.newPage();

const titleInput = (p) => p.getByPlaceholder('活动名称');
const serverProject = async () =>
  a.evaluate(async (id) => {
    const r = await fetch(`/api/v1/project/${id}`, {
      headers: { Authorization: `Bearer ${localStorage.getItem('sf-access-token')}` },
    });
    return r.json();
  }, projectId);
const setTitleAndSave = async (p, value) => {
  await titleInput(p).fill(value);
  await p.waitForTimeout(1500); // 800ms debounce + request
};

for (const p of [a, b]) {
  await p.goto(`${BASE}/workbench/${projectId}`);
  await titleInput(p).waitFor({ timeout: 20000 });
}
check('both windows show the project', (await titleInput(b).inputValue()) === '冲突测试');

// ===== Scenario 1: B is stale and chooses 「加载最新版本」
await setTitleAndSave(a, 'A 窗口改的标题');
check('A saved without conflict', (await serverProject()).title === 'A 窗口改的标题');

await setTitleAndSave(b, 'B 窗口改的标题');
const dialog = b.getByRole('alertdialog');
await dialog.waitFor({ timeout: 5000 }).catch(() => {});
check('B sees the conflict dialog', await dialog.isVisible());
check('server still has A\'s title (B did not overwrite)', (await serverProject()).title === 'A 窗口改的标题');
if (SHOTS) await b.screenshot({ path: `${SHOTS}/conflict-dialog.png` });

await b.keyboard.press('Escape');
await b.waitForTimeout(300);
check('Escape does not dismiss the dialog', await dialog.isVisible());

await dialog.getByRole('button', { name: '加载最新版本' }).click();
await dialog.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
check('dialog closes after 加载最新版本', !(await dialog.isVisible()));
check('B now shows A\'s title', (await titleInput(b).inputValue()) === 'A 窗口改的标题');
const backup = await b.evaluate((id) => {
  const key = Object.keys(localStorage).find((k) => k.startsWith('sf-draft-conflict:') && k.endsWith(id));
  return key ? JSON.parse(localStorage.getItem(key)).title : null;
}, projectId);
check('B\'s own edit is kept in the conflict backup', backup === 'B 窗口改的标题', `backup=${backup}`);

// B keeps editing normally after recovering
await setTitleAndSave(b, 'B 加载后继续编辑');
check('B saves normally after loading latest', (await serverProject()).title === 'B 加载后继续编辑');

// ===== Scenario 2: A is now stale and chooses 「用我的版本覆盖」
await setTitleAndSave(a, 'A 坚持自己的标题');
const dialogA = a.getByRole('alertdialog');
await dialogA.waitFor({ timeout: 5000 }).catch(() => {});
check('A sees the conflict dialog', await dialogA.isVisible());
await dialogA.getByRole('button', { name: '用我的版本覆盖' }).click();
await dialogA.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
await a.waitForTimeout(800);
const final = await serverProject();
check('server now has A\'s title after overwrite', final.title === 'A 坚持自己的标题', `title=${final.title}`);
check('version advanced through every save', final.version >= 5, `version=${final.version}`);

await browser.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
