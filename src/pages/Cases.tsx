import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  BadgeCheck,
  Clock3,
  Copy,
  Layers,
  Loader2,
  Sparkles,
  Users,
  Wallet,
  Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import CompareCanvas from '@/components/scene/CompareCanvas';
import { CASE_CATEGORIES, CASES } from '@/data/cases';
import { createProject } from '@/services/api';
import { knownTotal, subtotalLabel, unitPriceLabel } from '@/services/budgetMath';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import ReturnBar from '@/components/shared/ReturnBar';
import type { CaseTemplate, ProjectData } from '@/types/types';

/* 卡片预算口径：有上限的仅显示上限（示例费用合计见预览详情），未定的如实显示；注记本身即「以内」口径的照原文 */
const budgetValue = (c: CaseTemplate): string => {
  const limit = c.demo.budget?.limit;
  if (limit == null) return '未定';
  return c.budgetNote.includes('以内') ? c.budgetNote : `上限 ¥${limit.toLocaleString()}`;
};

/* 时长注记紧凑化：括号补充说明改为空格分隔，保证名称与值同行时窄格不溢出 */
const compactNote = (note: string) =>
  note.replace(/[（(]/g, ' ').replace(/[）)]/g, '').replace(/\s{2,}/g, ' ').trim();

export default function Cases() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { ready: authReady, userId } = useAuth();
  const [activeCat, setActiveCat] = useState('all');
  const [previewCase, setPreviewCase] = useState<CaseTemplate | null>(null);
  const [using, setUsing] = useState(false);

  /* ?demo=annual 自动打开对应完整案例预览 */
  useEffect(() => {
    const demo = params.get('demo');
    if (!demo) return;
    const found = CASES.find((c) => c.id === `case-${demo}`);
    if (found?.full) setPreviewCase(found);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const fullCases = useMemo(
    () => CASES.filter((c) => c.full && (activeCat === 'all' || c.category === activeCat)),
    [activeCat]
  );
  const templateCases = useMemo(
    () => CASES.filter((c) => !c.full && (activeCat === 'all' || c.category === activeCat)),
    [activeCat]
  );

  const budgetTotal = (demo: ProjectData) => knownTotal(demo.budget?.items ?? []);

  const applyCase = async (c: CaseTemplate) => {
    if (!authReady || !userId) {
      toast.error('会话准备中，请稍候再试');
      return;
    }
    setUsing(true);
    try {
      const data: ProjectData = structuredClone(c.demo);
      /* 套用案例：项目数据携带案例封面与案例 ID（旧副本无此字段时按名称匹配回退） */
      data.caseCoverUrl = c.coverUrl;
      data.caseId = c.id;
      const id = await createProject(c.name, data);
      toast.success('已创建活动项目，进入工作台');
      navigate(`/workbench/${id}`);
    } catch (e) {
      console.error(e);
      toast.error('创建失败，请重试');
      setUsing(false);
    }
  };

  return (
    /* 「轻盈创意纸面」内页样板（v108）：外层纸面底 + 页头两侧弧形层次，卡片内部保持干净 */
    <div className="sf-page-body mx-auto w-full max-w-6xl px-4 py-10 md:px-6 md:py-14">
      <div className="sf-deco" aria-hidden="true">
        <span className="sf-blob sf-paper-purple-soft" style={{ top: '-6%', left: '-18%', width: '30vw', height: '30vw', minWidth: 260, minHeight: 260 }} />
        <span className="sf-blob sf-paper-cream" style={{ top: '4%', right: '-16%', width: '26vw', height: '26vw', minWidth: 220, minHeight: 220 }} />
      </div>
      <ReturnBar />
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight md:text-3xl">案例探索</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          整场活动的完整成果：主题、流程、预算、文案与布置效果，看中即可复制成你的项目
        </p>
      </div>

      {/* 分类筛选 */}
      <div className="mb-8 flex flex-wrap gap-2">
        {CASE_CATEGORIES.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setActiveCat(c.id)}
            className={cn(
              'rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors',
              activeCat === c.id
                ? 'border-primary bg-primary text-primary-foreground'
                : 'bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground'
            )}
          >
            {c.name}
          </button>
        ))}
      </div>

      {/* 完整 Demo：主要展示 */}
      {fullCases.length > 0 && (
        <section className="mb-12">
          <div className="mb-4 flex items-center gap-2">
            <BadgeCheck className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-bold">完整示例案例</h2>
            <span className="text-xs text-muted-foreground">含方案、布置与预算的整套成果</span>
          </div>
          {/* 筛选后仅剩一两项时收窄为紧凑布局，衔接下方轻量模板区，避免三列大留白 */}
          <div
            className={cn(
              'grid gap-5',
              fullCases.length === 1 ? 'md:max-w-2xl' : fullCases.length === 2 ? 'md:grid-cols-2' : 'md:grid-cols-3'
            )}
          >
            {fullCases.map((c) => (
              <div
                key={c.id}
                className="flex h-full flex-col overflow-hidden rounded-2xl border bg-card shadow-sm transition-all hover:-translate-y-1 hover:shadow-lg"
              >
                <button
                  type="button"
                  onClick={() => setPreviewCase(c)}
                  className="relative aspect-video w-full overflow-hidden text-left"
                >
                  <img src={c.coverUrl} alt={c.name} loading="lazy" className="h-full w-full object-cover" />
                  <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground shadow-sm">
                    <BadgeCheck className="h-3 w-3" />
                    完整案例
                  </span>
                  <span className="absolute bottom-3 right-3 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm">
                    {c.activityType}
                  </span>
                </button>
                <div className="flex flex-1 flex-col p-5">
                  <h3 className="mb-2 text-base font-semibold text-balance">{c.name}</h3>
                  {/* 套用判断元数据：紧凑两列两行，名称与值同行，超长值自然换行不溢出 */}
                  <div className="mb-4 grid grid-cols-2 gap-x-3 gap-y-2 rounded-xl bg-muted/50 p-3 text-xs">
                    {(
                      [
                        { icon: Users, label: '人数', value: c.headcountNote },
                        { icon: Wallet, label: '预算', value: budgetValue(c) },
                        { icon: Clock3, label: '时长', value: compactNote(c.durationNote) },
                        { icon: Layers, label: '流程', value: `${c.demo.schedule?.length ?? 0} 个环节` },
                      ] as const
                    ).map(({ icon: Icon, label, value }) => (
                      <div key={label} className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                        <span className="inline-flex shrink-0 items-center gap-1 text-muted-foreground">
                          <Icon className="h-3.5 w-3.5" />
                          {label}
                        </span>
                        <span className="max-w-full break-words font-medium text-foreground/90">{value}</span>
                      </div>
                    ))}
                  </div>
                  {/* 亮点短标签：紧凑 wrap 自然换行，减少竖排高度占用 */}
                  <div className="mb-4 flex flex-wrap gap-1.5">
                    {c.highlights.map((h) => (
                      <span key={h} className="inline-flex items-center gap-1 rounded-full bg-primary/5 px-2.5 py-1 text-xs text-foreground/80">
                        <Sparkles className="h-3 w-3 shrink-0 text-primary" />
                        {h}
                      </span>
                    ))}
                  </div>
                  <div className="mt-auto flex gap-2">
                    <Button variant="outline" size="sm" className="flex-1" onClick={() => setPreviewCase(c)}>
                      预览整套方案
                    </Button>
                    <Button size="sm" className="flex-1" disabled={using} onClick={() => applyCase(c)}>
                      {using ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
                      使用此案例
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
      {/* 模板案例：次级紧凑列表 */}
      {templateCases.length > 0 && (
        <section>
          <div className="mb-4 flex items-center gap-2">
            <Layers className="h-5 w-5 text-muted-foreground" />
            <h2 className="text-lg font-bold">更多活动模板</h2>
            <span className="text-xs text-muted-foreground">轻量模板，复制后由 AI 帮你展开成完整方案</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {templateCases.map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-4 rounded-xl border bg-card p-4 shadow-sm transition-colors hover:border-primary/40"
              >
                <img
                  src={c.coverUrl}
                  alt={c.name}
                  loading="lazy"
                  className="h-16 w-24 shrink-0 rounded-lg object-cover"
                />
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex items-center gap-2">
                    <h3 className="truncate text-sm font-semibold">{c.name}</h3>
                    <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                      {c.activityType}
                    </span>
                  </div>
                  <div className="flex flex-col gap-0.5 text-xs leading-snug text-muted-foreground">
                    <span className="break-words">{c.headcountNote}</span>
                    <span className="break-words">{c.durationNote}</span>
                    <span className="break-words">{c.budgetNote}</span>
                  </div>
                </div>
                <Button variant="outline" size="sm" className="shrink-0" disabled={using} onClick={() => applyCase(c)}>
                  {using ? <Loader2 className="h-4 w-4 animate-spin" /> : <Copy className="h-4 w-4" />}
                  使用
                </Button>
              </div>
            ))}
          </div>
        </section>
      )}

      {fullCases.length === 0 && templateCases.length === 0 && (
        <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
          <Layers className="h-8 w-8" />
          <p className="text-sm">这个分类下暂无案例，换个分类看看</p>
        </div>
      )}

      {/* 完整案例预览 */}
      <Dialog open={!!previewCase} onOpenChange={(open) => !open && setPreviewCase(null)}>
        <DialogContent className="max-h-[90dvh] max-w-[calc(100%-2rem)] overflow-y-auto md:max-w-3xl">
          {previewCase && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  {previewCase.name}
                  <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">示例案例</span>
                </DialogTitle>
                <DialogDescription>
                  以下为完整方案示例（主题、流程、预算、文案与布置效果），使用后可在工作台自由编辑
                </DialogDescription>
              </DialogHeader>

              <div className="flex flex-col gap-6">
                {/* 主题 */}
                {previewCase.demo.theme && (
                  <div className="rounded-xl border bg-muted/40 p-4">
                    <p className="mb-1 text-xs font-medium text-muted-foreground">主题</p>
                    <p className="gradient-text text-lg font-bold">{previewCase.demo.theme.name}</p>
                    {previewCase.demo.theme.slogan && (
                      <p className="mt-1 text-sm text-muted-foreground">「{previewCase.demo.theme.slogan}」</p>
                    )}
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {previewCase.demo.theme.highlights?.map((h) => (
                        <span key={h} className="rounded-full bg-primary/10 px-2.5 py-0.5 text-xs text-primary">
                          {h}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* 流程 */}
                {previewCase.demo.schedule && previewCase.demo.schedule.length > 0 && (
                  <div>
                    <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                      <Clock3 className="h-4 w-4 text-primary" />
                      活动流程 · {previewCase.demo.schedule.length} 个环节
                    </h3>
                    <ol className="flex flex-col gap-2">
                      {previewCase.demo.schedule.map((s) => (
                        <li key={s.id} className="flex items-baseline gap-3 rounded-lg border bg-card px-3 py-2">
                          <span className="w-14 shrink-0 text-xs font-semibold text-primary">{s.time}</span>
                          <span className="min-w-0 flex-1 text-sm font-medium">{s.name}</span>
                          <span className="shrink-0 text-xs text-muted-foreground">{s.duration}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}

                {/* 预算 */}
                {previewCase.demo.budget && previewCase.demo.budget.items.length > 0 && (
                  <div className="rounded-xl border p-4">
                    <div className="mb-2 flex items-center justify-between">
                      <h3 className="flex items-center gap-2 text-sm font-semibold">
                        <Wallet className="h-4 w-4 text-primary" />
                        预算参考
                      </h3>
                      <span className="text-sm font-bold">
                        合计 ¥{budgetTotal(previewCase.demo).toLocaleString()}
                        {previewCase.demo.budget.limit != null && (
                          <span className="ml-1 text-xs font-normal text-muted-foreground">
                            / 上限 ¥{previewCase.demo.budget.limit.toLocaleString()}
                          </span>
                        )}
                      </span>
                    </div>
                    {/* 费用构成：名称 + 数量×单价 + 小计；条目多时在框内滚动 */}
                    <ul className="max-h-56 overflow-y-auto">
                      {previewCase.demo.budget.items.map((it) => (
                        <li
                          key={it.id}
                          className="flex items-baseline justify-between gap-3 border-b border-border/50 py-1.5 text-xs last:border-b-0"
                        >
                          <span className="min-w-0 flex-1 truncate text-foreground">{it.name}</span>
                          <span className="shrink-0 text-muted-foreground">
                            {it.qty} × {unitPriceLabel(it)}
                          </span>
                          <span className="shrink-0 font-medium tabular-nums text-foreground">{subtotalLabel(it)}</span>
                        </li>
                      ))}
                    </ul>
                    {previewCase.demo.budget.limit != null && (
                      <p className="mt-2 flex justify-between border-t pt-2 text-xs">
                        <span className="text-muted-foreground">预算上限</span>
                        <span
                          className={
                            knownTotal(previewCase.demo.budget.items) > previewCase.demo.budget.limit
                              ? 'font-medium text-destructive'
                              : 'font-medium text-foreground'
                          }
                        >
                          ¥{previewCase.demo.budget.limit.toLocaleString()}
                          {knownTotal(previewCase.demo.budget.items) > previewCase.demo.budget.limit
                            ? ` · 已超出 ¥${(knownTotal(previewCase.demo.budget.items) - previewCase.demo.budget.limit).toLocaleString()}`
                            : ` · 余 ¥{(previewCase.demo.budget.limit - knownTotal(previewCase.demo.budget.items)).toLocaleString()}`}
                        </span>
                      </p>
                    )}
                  </div>
                )}

                {/* 文案节选 */}
                {previewCase.demo.copies?.invite && (
                  <div>
                    <h3 className="mb-3 text-sm font-semibold">邀请函节选</h3>
                    <div className="whitespace-pre-line rounded-xl border bg-muted/40 p-4 text-sm leading-relaxed text-muted-foreground break-words max-h-96 overflow-y-auto">
                      {previewCase.demo.copies.invite}
                    </div>
                  </div>
                )}

                {/* 场景前后对比 */}
                {previewCase.demo.scene?.beforeUrl && previewCase.demo.scene.afterUrl && (
                  <div>
                    <h3 className="mb-3 text-sm font-semibold">场景布置效果</h3>
                    <CompareCanvas
                      beforeUrl={previewCase.demo.scene.beforeUrl}
                      afterUrl={previewCase.demo.scene.afterUrl}
                      className="aspect-[3/2] w-full rounded-xl"
                    />
                    <p className="mt-2 text-center text-xs text-muted-foreground">
                      示例效果：拖动分割线对比布置前后
                    </p>
                  </div>
                )}

                <Button size="lg" className="w-full" disabled={using} onClick={() => applyCase(previewCase)}>
                  {using ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                  使用此案例，开始编辑
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
