import { AlertTriangle, Plus, ShoppingBag, Trash2, Wallet } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { fromQuery } from '@/services/returnContext';

/** 预算数字输入（数量/单价/上限共用）：四态校验——空值按未知语义、有效 0 与合法数字即时写入、
 * 负数等非法输入就地提示「不能小于0」且不写入已保存数据，失焦/离开恢复上次有效值（不静默转未知） */
function NumInput({
  value, raw, onValue, onEmpty, onBlur, className,
}: {
  value: number | null;
  raw: string | null;
  onValue: (n: number) => void;
  onEmpty: () => void;
  onBlur?: () => void;
  className?: string;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const display = draft ?? (value == null || raw === null ? '' : String(raw));
  return (
    <span className="inline-flex items-center gap-1.5">
      <Input
        type="number"
        min={0}
        aria-invalid={err}
        value={display}
        onChange={(e) => {
          const raw2 = e.target.value;
          const c = classifyNumInput(raw2);
          setDraft(raw2);
          if (c.state === 'empty') {
            setErr(false);
            onEmpty();
          } else if (c.state === 'invalid') {
            setErr(true);
            /* 非法不写入：保留提示，数据保持上次有效值 */
          } else {
            setErr(false);
            onValue(c.value as number);
          }
        }}
        onBlur={() => {
          /* 离开编辑：非法或草稿收尾 → 回到上次有效值 */
          if (err || draft !== null) {
            setDraft(null);
            setErr(false);
          }
          onBlur?.();
        }}
        className={className}
      />
      {err && <span className="shrink-0 text-[11px] text-destructive">不能小于0</span>}
    </span>
  );
}
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import CollapsibleSection from '@/components/workbench/CollapsibleSection';
import { MaterialCard } from '@/components/workbench/ResourceCards';
import type { MaterialResource } from '@/data/resources';
import { getMaterialMatches } from '@/data/resources';
import { genId } from '@/services/api';
import { classifyNumInput, parseNonNegativeNum } from '@/services/facts';
import { knownTotal, remainingOf, subtotalLabel, unpricedItems } from '@/services/budgetMath';
import type { BudgetItem, MaterialItem, ProjectData, TaskItem } from '@/types/types';

interface BudgetModuleProps {
  data: ProjectData;
  patch: (partial: Partial<ProjectData>) => void;
  /** 失焦/增删等确认时刻立即落库版本：避免防抖窗口内刷新丢失最后编辑 */
  patchNow: (partial: Partial<ProjectData>) => void;

  /** 全部收起 */
  allCollapsed?: boolean;
  /** 新内容红点提示 */
  fresh?: boolean;
}

export default function BudgetModule({ data, patch, patchNow, allCollapsed, fresh }: BudgetModuleProps) {
  const budget = data.budget ?? { limit: null, items: [] };
  /* 卡片展开/收起：随项目持久化（data.ui.collapsed）；allCollapsed 为全局收起 */
  const uiC = data.ui?.collapsed ?? {};
  const secOpen = (k: string) => !(allCollapsed || uiC[k]);
  const toggleSec = (k: string, next: boolean) =>
    patchNow({ ui: { ...data.ui, collapsed: { ...uiC, [k]: !next } } });
  const requirements = data.requirements ?? {};
  const materials = data.materials ?? [];
  const tasks = data.tasks ?? [];
  const schedule = data.schedule ?? [];
  /** 物料购买渠道弹窗（查看不修改清单与预算） */
  const [resFor, setResFor] = useState<MaterialResource[] | null>(null);
  const [confirmState, setConfirmState] = useState<{
    open: boolean;
    title: string;
    description: string;
    confirmText?: string;
    destructive?: boolean;
    onConfirm: () => void;
  }>({
    open: false,
    title: '',
    description: '',
    onConfirm: () => {},
  });
  /** 按当前清单自动匹配的采购参考（程序化匹配，不依赖 AI） */
  const materialMatches = useMemo(
    () => (materials.length > 0 ? getMaterialMatches(materials.map((m) => `${m.name} ${m.category}`)) : []),
    [materials]
  );

  /* ---------- 程序化计算（统一走 budgetMath：全站唯一来源；未知=待询价不计合计，0=免费是有效金额） ---------- */
  const total = useMemo(() => knownTotal(budget.items), [budget.items]);
  const unpriced = useMemo(() => unpricedItems(budget.items), [budget.items]);
  const remaining = useMemo(() => remainingOf(budget.limit, budget.items), [budget.limit, budget.items]);
  const overBudget = remaining != null && remaining < 0;
  const materialsReady = materials.filter((m) => m.ready).length;
  const tasksDone = tasks.filter((t) => t.done).length;

  /* ---------- 失焦即落库：Tab/点出输入框的瞬间把当前已显示的值立即持久化（onChange 仍走防抖合并击键） ---------- */
  const flushBudget = () => patchNow({ budget, requirements: syncBudgetReq(budget.limit ?? null) });
  const flushLists = () => patchNow({ materials, tasks });

  /* ---------- 预算上限 ↔ 需求摘要统一来源 ----------
   * 上限属活动条件：编辑上限同步需求摘要预算值；清空表示待定（未知预算允许继续）。 */
  const syncBudgetReq = (limit: number | null) => ({
    ...requirements,
    budget:
      limit == null
        ? { value: null, source: 'undecided' as const }
        : { value: `${limit.toLocaleString('zh-CN')} 元`, source: 'confirmed' as const },
  });

  /* ---------- 预算（增删行属确认操作，立即落库；文字输入失焦落库） ---------- */
  const setItems = (items: BudgetItem[]) => patchNow({ budget: { ...budget, items } });
  const updateItem = (id: string, p: Partial<BudgetItem>) =>
    patch({ budget: { ...budget, items: budget.items.map((it) => (it.id === id ? { ...it, ...p } : it)) } });
  const addItem = () =>
    setItems([...budget.items, { id: genId(), name: '', qty: 1, unitPrice: 0, priceUnknown: true }]);

  /* ---------- 物料（增删勾选立即落库；文字输入失焦落库） ---------- */
  const setMaterials = (list: MaterialItem[]) => patchNow({ materials: list });
  const addMaterial = () =>
    setMaterials([...materials, { id: genId(), category: '', name: '', qty: '', ready: false }]);

  /* ---------- 任务 ---------- */
  const setTasks = (list: TaskItem[]) => patchNow({ tasks: list });
  const addTask = () =>
    setTasks([...tasks, { id: genId(), name: '', owner: '', deadline: '', done: false }]);
  const updateTask = (id: string, p: Partial<TaskItem>) =>
    setTasks(tasks.map((t) => (t.id === id ? { ...t, ...p } : t)));

  return (
    <div className="flex flex-col gap-6">
      {/* ============ 预算 ============ */}
      <CollapsibleSection
        sectionKey="budget"
        title="预算明细"
        summary={`已知合计 ¥${total.toLocaleString()} · ${budget.items.length} 项${unpriced.length > 0 ? `（另 ${unpriced.length} 项待询价未计入）` : ''}`}
        open={secOpen('budget')}
        onToggle={(v) => toggleSec('budget', v)}
        fresh={fresh}
        className=""
        bodyClassName="p-4 pt-0 md:p-5 md:pt-0"
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">预算上限</span>
            <NumInput
              value={budget.limit ?? null}
              raw={budget.limit == null ? null : String(budget.limit)}
              onValue={(n) => patch({ budget: { ...budget, limit: n }, requirements: syncBudgetReq(n) })}
              onEmpty={() => {
                /* 空=上限待定（未知预算允许继续），非静默转未知负数 */
                patch({ budget: { ...budget, limit: null }, requirements: syncBudgetReq(null) });
              }}
              onBlur={flushBudget}
              className="h-9 w-32 text-right"
            />
            <span className="text-xs text-muted-foreground">元</span>
          </div>
          {remaining != null && (
            <p
              className={`flex items-center gap-1.5 text-xs font-semibold ${
                overBudget ? 'text-destructive' : 'text-green-600'
              }`}
            >
              {overBudget && <AlertTriangle className="h-3.5 w-3.5" />}
              {overBudget
                ? `超出预算 ¥${Math.abs(remaining).toLocaleString()}，请调整`
                : `预算内：剩余 ¥${remaining.toLocaleString()}`}
            </p>
          )}
        </div>

        {budget.items.length === 0 ? (
          <EmptyRow text="还没有预算项。点击下方按钮添加第一项费用。" onAdd={addItem} addLabel="添加费用项" />
        ) : (
          <>
            {/* 宽成果视图：完整表格（费用项/数量/单价/小计/删除），横向滚动兜底 */}
            <div className="hidden w-full max-w-full overflow-x-auto rounded-xl border bg-background @3xl:block">
              <table className="w-full min-w-max text-sm">
                <thead>
                  <tr className="border-b bg-muted/50 text-left text-xs text-muted-foreground">
                    <th className="px-3 py-2.5 font-medium">费用项</th>
                    <th className="px-3 py-2.5 font-medium">数量</th>
                    <th className="px-3 py-2.5 font-medium">单价（元）</th>
                    <th className="px-3 py-2.5 text-right font-medium">小计</th>
                    <th className="w-12 px-3 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {budget.items.map((it) => (
                    <tr key={it.id} className="border-b last:border-0">
                      <td className="px-3 py-2">
                        <Input
                          value={it.name}
                          onChange={(e) => updateItem(it.id, { name: e.target.value })}
                          onBlur={flushBudget}
                          placeholder="如：场地租赁"
                          className="h-9 min-w-36 border-0 bg-transparent shadow-none focus-visible:ring-1"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <NumInput
                          value={it.qty}
                          raw={String(it.qty)}
                          onValue={(n) => updateItem(it.id, { qty: n })}
                          onEmpty={() => updateItem(it.id, { qty: 0 })}
                          onBlur={flushBudget}
                          className="h-9 w-20 border-0 bg-transparent text-right shadow-none focus-visible:ring-1"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <NumInput
                          value={it.priceUnknown ? null : it.unitPrice}
                          raw={it.priceUnknown ? null : String(it.unitPrice)}
                          onValue={(n) => updateItem(it.id, { unitPrice: n, priceUnknown: false })}
                          onEmpty={() => {
                            /* 用户主动清空=待询价（未知语义）；负数非法不会走到这里（就地拦截） */
                            updateItem(it.id, { priceUnknown: true, unitPrice: 0 });
                          }}
                          onBlur={flushBudget}
                          className="h-9 w-28 border-0 bg-transparent text-right shadow-none focus-visible:ring-1"
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">
                        {it.priceUnknown ? <span className='text-muted-foreground'>待询价</span> : subtotalLabel(it)}
                      </td>
                      <td className="px-3 py-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => {
                            setConfirmState({
                              open: true,
                              title: '确认删除费用项？',
                              description: `确定要删除费用项「${it.name || '未命名'}」吗？删除后不可恢复。`,
                              confirmText: '确认删除',
                              destructive: true,
                              onConfirm: () => setItems(budget.items.filter((x) => x.id !== it.id)),
                            });
                          }}
                          aria-label="删除费用项"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* 窄成果视图：名称整行可读不截断，小计/详情/删除收在次行 */}
            <div className="flex flex-col gap-2 @3xl:hidden">
              {budget.items.map((it) => (
                <div key={it.id} className="rounded-xl border bg-background p-3">
                  <Input
                    value={it.name}
                    title={it.name}
                    onChange={(e) => updateItem(it.id, { name: e.target.value })}
                    onBlur={flushBudget}
                    placeholder="如：场地租赁"
                    className="h-8 w-full border-0 bg-transparent px-1 text-sm font-medium shadow-none focus-visible:ring-1"
                  />
                  <div className="mt-1 flex items-center justify-between gap-2 pl-1">
                    <span className="text-sm font-semibold tabular-nums text-primary">
                      {it.priceUnknown ? <span className='text-muted-foreground'>待询价</span> : subtotalLabel(it)}
                    </span>
                    <div className="flex items-center gap-1.5">
                    <details className="shrink-0">
                      <summary className="cursor-pointer list-none rounded-full border px-2.5 py-1 text-[11px] text-muted-foreground hover:text-foreground">
                        详情
                      </summary>
                      <div className="mt-2 flex items-center gap-2 pl-1">
                        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          数量
                          <NumInput
                            value={it.qty}
                            raw={String(it.qty)}
                            onValue={(n) => updateItem(it.id, { qty: n })}
                            onEmpty={() => updateItem(it.id, { qty: 0 })}
                            onBlur={flushBudget}
                            className="h-8 w-16 border-0 bg-muted/50 text-right text-xs shadow-none focus-visible:ring-1"
                          />
                        </label>
                        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                          单价
                          <NumInput
                            value={it.priceUnknown ? null : it.unitPrice}
                            raw={it.priceUnknown ? null : String(it.unitPrice)}
                            onValue={(n) => updateItem(it.id, { unitPrice: n, priceUnknown: false })}
                            onEmpty={() => updateItem(it.id, { priceUnknown: true, unitPrice: 0 })}
                            onBlur={flushBudget}
                            className="h-8 w-20 border-0 bg-muted/50 text-right text-xs shadow-none focus-visible:ring-1"
                          />
                        </label>
                      </div>
                    </details>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                      onClick={() => {
                        setConfirmState({
                          open: true,
                          title: '确认删除费用项？',
                          description: `确定要删除费用项「${it.name || '未命名'}」吗？删除后不可恢复。`,
                          confirmText: '确认删除',
                          destructive: true,
                          onConfirm: () => setItems(budget.items.filter((x) => x.id !== it.id)),
                        });
                      }}
                      aria-label="删除费用项"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {budget.items.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
            <Button variant="outline" size="sm" onClick={addItem}>
              <Plus className="h-4 w-4" />
              添加费用项
            </Button>
            {remaining != null && (
              <p
                className={`flex items-center gap-1.5 text-sm font-semibold ${
                  overBudget ? 'text-destructive' : 'text-green-600'
                }`}
              >
                {overBudget && <AlertTriangle className="h-4 w-4" />}
                {overBudget
                  ? `超出预算 ¥${Math.abs(remaining).toLocaleString()}，请调整`
                  : `预算内：剩余 ¥${remaining.toLocaleString()}`}
              </p>
            )}
          </div>
        )}
      </CollapsibleSection>

      {/* ============ 物料清单 ============ */}
      <CollapsibleSection
        sectionKey="materials"
        title="物料清单"
        summary={materials.length > 0 ? `${materialsReady}/${materials.length} 已就绪` : '暂无物料'}
        open={secOpen('materials')}
        onToggle={(v) => toggleSec('materials', v)}
        fresh={fresh}
        className=""
        bodyClassName="p-4 pt-0 md:p-5 md:pt-0"
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          
          <Button variant="outline" size="sm" onClick={addMaterial}>
            <Plus className="h-4 w-4" />
            添加物料
          </Button>
        </div>
        {materials.length === 0 ? (
          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            还没有物料。生成完整方案时会自动填入参考清单，也可手动添加。
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {materials.map((m) => (
              <div key={m.id} className="flex flex-wrap items-center gap-2 rounded-xl border bg-background p-2 md:flex-nowrap">
                <Checkbox
                  checked={m.ready}
                  onCheckedChange={(v) =>
                    setMaterials(materials.map((x) => (x.id === m.id ? { ...x, ready: v === true } : x)))
                  }
                  aria-label={`勾选 ${m.name}`}
                />
                <Input
                  value={m.category}
                  onChange={(e) => setMaterials(materials.map((x) => (x.id === m.id ? { ...x, category: e.target.value } : x)))}
                  onBlur={flushLists}
                  placeholder="分类"
                  className="h-9 w-24 shrink-0 text-xs"
                />
                <Input
                  value={m.name}
                  onChange={(e) => setMaterials(materials.map((x) => (x.id === m.id ? { ...x, name: e.target.value } : x)))}
                  onBlur={flushLists}
                  placeholder="物料名称"
                  className="h-9 min-w-28 flex-1 border-0 bg-transparent shadow-none focus-visible:ring-1"
                />
                <Input
                  value={m.qty}
                  onChange={(e) => setMaterials(materials.map((x) => (x.id === m.id ? { ...x, qty: e.target.value } : x)))}
                  onBlur={flushLists}
                  placeholder="数量"
                  className="h-9 w-24 shrink-0 text-xs"
                />
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-primary"
                  onClick={() => setResFor(getMaterialMatches([m.name, m.category]))}
                  aria-label={`查看 ${m.name || '物料'} 购买渠道`}
                >
                  <ShoppingBag className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                  onClick={() => {
                    setConfirmState({
                      open: true,
                      title: '确认删除物料项？',
                      description: `确定要删除物料「${m.name || '未命名'}」吗？`,
                      confirmText: '确认删除',
                      destructive: true,
                      onConfirm: () => setMaterials(materials.filter((x) => x.id !== m.id)),
                    });
                  }}
                  aria-label="删除物料"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>

      {/* ============ 物料采购与场地参考 ============ */}
      <CollapsibleSection
        sectionKey="refs"
        title="物料采购与场地参考"
        summary={'前往合作伙伴页挑选'}
        open={secOpen('refs')}
        onToggle={(v) => toggleSec('refs', v)}
        fresh={fresh}
        className=""
        bodyClassName="p-4 pt-0 md:p-5 md:pt-0"
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          
          <Button asChild variant="outline" size="sm">
            <Link to={`/resources?tab=materials&${fromQuery(data.id ?? '', 'budget')}`}>更多物料与场地</Link>
          </Button>
        </div>
        {materialMatches.length > 0 ? (
          <div className="flex flex-col gap-2.5">
            {materialMatches.slice(0, 3).map((r) => (
              <MaterialCard key={r.id} r={r} compact />
            ))}
            {materialMatches.length > 3 && (
              <Button
                variant="ghost"
                size="sm"
                className="self-start text-primary"
                onClick={() => setResFor(materialMatches)}
              >
                查看全部 {materialMatches.length} 项匹配
              </Button>
            )}
          </div>
        ) : (
          <p className="rounded-xl border border-dashed p-4 text-sm leading-relaxed text-muted-foreground">
            添加物料后，这里会按清单自动给出采购参考与替代方式；也可直接浏览
            <Link to={`/resources?tab=materials&${fromQuery(data.id ?? '', 'budget')}`} className="mx-1 text-primary underline-offset-2 hover:underline">
              物料与场地参考
            </Link>
            。
          </p>
        )}
      </CollapsibleSection>

      {/* 物料购买渠道（不影响清单与预算） */}
      <Dialog open={resFor !== null} onOpenChange={(o) => !o && setResFor(null)}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-left">查看购买渠道</DialogTitle>
            <DialogDescription className="text-left">
              相关购买渠道 · 查看不会修改你的清单与预算
            </DialogDescription>
          </DialogHeader>
          <div className="flex max-h-[60dvh] flex-col gap-2.5 overflow-y-auto">
            {resFor && resFor.length > 0 ? (
              resFor.map((r) => <MaterialCard key={r.id} r={r} />)
            ) : (
              <div className="flex flex-col gap-3 rounded-xl border bg-background p-4">
                <p className="text-sm leading-relaxed text-muted-foreground">
                  暂无该物料的匹配参考。可去平台直接搜索，记得按活动日期预留配送或自提时间。
                </p>
                <div className="flex flex-wrap gap-2">
                  <a
                    href="https://search.jd.com/"
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border border-primary/40 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                  >
                    去京东搜索
                  </a>
                  <a
                    href="https://s.taobao.com/"
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border border-primary/40 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
                  >
                    去淘宝搜索
                  </a>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ============ 任务清单 ============ */}
      <CollapsibleSection
        sectionKey="tasks"
        title="任务清单"
        summary={tasks.length > 0 ? `已完成 ${tasksDone}/${tasks.length}` : '暂无任务'}
        open={secOpen('tasks')}
        onToggle={(v) => toggleSec('tasks', v)}
        fresh={fresh}
        className=""
        bodyClassName="p-4 pt-0 md:p-5 md:pt-0"
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          
          <Button variant="outline" size="sm" onClick={addTask}>
            <Plus className="h-4 w-4" />
            添加任务
          </Button>
        </div>
        {tasks.length === 0 ? (
          <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
            还没有任务。生成完整方案时会自动填入筹备任务，也可手动添加。
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {tasks.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center gap-2 rounded-xl border bg-background p-2 md:flex-nowrap">
                <Checkbox
                  checked={t.done}
                  onCheckedChange={(v) => updateTask(t.id, { done: v === true })}
                  aria-label={`勾选 ${t.name}`}
                />
                <Input
                  value={t.name}
                  onChange={(e) => updateTask(t.id, { name: e.target.value })}
                  onBlur={flushLists}
                  placeholder="任务事项"
                  className="h-9 min-w-32 flex-1 border-0 bg-transparent shadow-none focus-visible:ring-1"
                />
                <Input
                  value={t.owner}
                  onChange={(e) => updateTask(t.id, { owner: e.target.value })}
                  onBlur={flushLists}
                  placeholder="负责人"
                  className="h-9 w-28 shrink-0 text-xs"
                />
                <Input
                  value={t.deadline}
                  onChange={(e) => updateTask(t.id, { deadline: e.target.value })}
                  onBlur={flushLists}
                  placeholder="期限"
                  className="h-9 w-28 shrink-0 text-xs"
                />
                <Select
                  value={t.linkedSession ?? 'none'}
                  onValueChange={(v) => updateTask(t.id, { linkedSession: v === 'none' ? undefined : v })}
                >
                  <SelectTrigger className="h-9 w-32 shrink-0 text-xs">
                    <SelectValue placeholder="关联环节" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">不关联</SelectItem>
                    {schedule.map((s) => (
                      <SelectItem key={s.id} value={s.id}>
                        {s.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-destructive hover:text-destructive"
                  onClick={() => {
                    setConfirmState({
                      open: true,
                      title: '确认删除任务？',
                      description: `确定要删除任务「${t.name || '未命名'}」吗？`,
                      confirmText: '确认删除',
                      destructive: true,
                      onConfirm: () => setTasks(tasks.filter((x) => x.id !== t.id)),
                    });
                  }}
                  aria-label="删除任务"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CollapsibleSection>

      {/* 真实 UI 警示确认弹窗（替代原生 window.confirm） */}
      <ConfirmDialog
        open={confirmState.open}
        onOpenChange={(open) => setConfirmState((s) => ({ ...s, open }))}
        title={confirmState.title}
        description={confirmState.description}
        confirmText={confirmState.confirmText}
        destructive={confirmState.destructive}
        onConfirm={confirmState.onConfirm}
      />
    </div>
  );
}

function EmptyRow({ text, onAdd, addLabel }: { text: string; onAdd: () => void; addLabel: string }) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-10 text-center">
      <p className="text-sm text-muted-foreground">{text}</p>
      <Button variant="outline" size="sm" onClick={onAdd}>
        <Plus className="h-4 w-4" />
        {addLabel}
      </Button>
    </div>
  );
}
