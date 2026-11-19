import {
  ArrowLeft,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Download,
  FileDown,
  Loader2,
  MapPin,
  MessageSquareText,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import PrintLayout from '@/components/preview/PrintLayout';
import CompareCanvas from '@/components/scene/CompareCanvas';
import { Button } from '@/components/ui/button';
import { MaterialCard, VenueSection } from '@/components/workbench/ResourceCards';
import { useAuth } from '@/contexts/AuthContext';
import { getMaterialMatches } from '@/data/resources';
import { getProject } from '@/services/api';
import { isUnknownReqValue, buildPendings, REQ_VAL_FIELDS } from '@/services/deliverables';
import { knownTotal, remainingOf, subtotalLabel, unitPriceLabel, unpricedItems } from '@/services/budgetMath';
import type { ProjectRow, ReqSource } from '@/types/types';

/** 需求字段的来源标签：严格区分已确认 / AI 建议 / 未定，不把建议当成决定 */
const SOURCE_LABEL: Record<ReqSource, string> = { confirmed: '已确认', ai: 'AI 建议', undecided: '未定' };
const SOURCE_CLASS: Record<ReqSource, string> = {
  confirmed: 'bg-primary/10 text-primary',
  ai: 'bg-chart-5/15 text-chart-5',
  undecided: 'bg-muted text-muted-foreground',
};

export default function Preview() {
  const { id } = useParams<{ id: string }>();
  /* embed 模式：在工作区预览弹窗内嵌时隐藏返回工作区入口（外层弹窗已提供关闭/独立页） */
  const [sp] = useSearchParams();
  const embed = sp.get('embed') === '1';
  const { ready, userId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [project, setProject] = useState<ProjectRow | null>(null);
  /* PDF 导出：打印视图就绪后调起系统打印（另存为 PDF），结束后自动收回 */
  const [printOpen, setPrintOpen] = useState(false);

  useEffect(() => {
    if (!ready || !userId || !id) return;
    let cancelled = false;
    (async () => {
      try {
        const row = await getProject(id);
        if (!cancelled) setProject(row);
      } catch (e) {
        console.error(e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, userId, id]);

  useEffect(() => {
    if (!printOpen) return;
    /* 留出图片与排版加载时间，再调起打印对话框；
     * 行为明确反馈：调起前告知用户下一步（在系统打印对话框选「另存为 PDF」），点击一次无反应时可据此判断是浏览器拦截了打印窗口 */
    toast.info('即将打开打印窗口：请在系统打印对话框中选择「另存为 PDF」保存文件；若窗口未弹出，请检查浏览器是否拦截了弹出窗口');
    const t = setTimeout(() => {
      try {
        window.print();
      } catch (e) {
        console.error(e);
        toast.error('打印窗口调起失败，请检查浏览器弹出窗口设置后重试');
      }
    }, 400);
    const after = () => setPrintOpen(false);
    window.addEventListener('afterprint', after);
    return () => {
      clearTimeout(t);
      window.removeEventListener('afterprint', after);
    };
  }, [printOpen]);

  if (loading || !ready) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <span className="text-sm">正在载入成果…</span>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-sm text-muted-foreground">活动不存在或已被删除</p>
        <Button asChild variant="outline">
          <Link to="/projects">返回我的活动</Link>
        </Button>
      </div>
    );
  }

  const d = project.data;
  const req = d.requirements ?? {};
  const items = d.budget?.items ?? [];
  /* 统一计算源（budgetMath）：未知=待询价不计合计，0=免费是有效金额；与工作区/AI 上下文一致 */
  const total = knownTotal(items);
  const remaining = remainingOf(d.budget?.limit, items);
  const unpriced = unpricedItems(items);
  const materialsReady = (d.materials ?? []).filter((m) => m.ready).length;
  const tasksDone = (d.tasks ?? []).filter((t) => t.done).length;
  const selectedDir = (d.directions ?? []).find((x) => x.id === d.selectedDirectionId);
  const pendings = buildPendings(d);

  /** 下载已生成的效果图原图（不触发任何重新生成） */
  const downloadEffect = async (url: string) => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `场地布置效果图-${new Date().toISOString().slice(0, 10)}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
      toast.success('已开始下载布置效果图');
    } catch {
      toast.error('下载失败，可右键图片另存');
    }
  };

  return (
    <div className="flex min-h-screen w-full flex-col bg-muted/30">
      {/* 顶栏：返回原活动原位置（restore 恢复页签与滚动）+ PDF 导出 */}
      <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-3 px-4">
          {!embed && (
            <Button asChild variant="ghost" size="icon" aria-label="返回编辑">
              <Link to={`/workbench/${id}?restore=1`}>
                <ArrowLeft className="h-4.5 w-4.5" />
              </Link>
            </Button>
          )}
          <span className="min-w-0 flex-1 truncate text-sm font-semibold">{project.title}</span>
          <Button size="sm" onClick={() => setPrintOpen(true)}>
            <FileDown className="h-4 w-4" />
            <span className="hidden sm:inline">导出活动安排 PDF</span>
            <span className="sm:hidden">PDF</span>
          </Button>
          {!embed && (
            <Button asChild size="sm" variant="outline">
              <Link to={`/workbench/${id}?restore=1`}>
                <Sparkles className="h-4 w-4" />
                返回编辑
              </Link>
            </Button>
          )}
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 py-6 md:py-10">
        {/* 主题 hero */}
        {d.theme ? (
          <section className="overflow-hidden rounded-3xl border bg-gradient-to-br from-primary/15 via-card to-card p-6 shadow-sm md:p-10">
            <p className="mb-2 text-xs font-medium tracking-widest text-muted-foreground">活动主题</p>
            <h1 className="gradient-text mb-3 text-3xl font-bold tracking-tight text-balance md:text-4xl">
              {d.theme.name}
            </h1>
            {d.theme.slogan && <p className="mb-5 text-pretty text-base text-muted-foreground">「{d.theme.slogan}」</p>}
            <div className="flex flex-wrap gap-2">
              {(d.theme.highlights ?? []).map((h) => (
                <span key={h} className="rounded-full bg-primary/10 px-3 py-1 text-sm text-primary">
                  {h}
                </span>
              ))}
            </div>
          </section>
        ) : (
          <section className="flex flex-col items-center gap-4 rounded-3xl border bg-card py-16 text-center shadow-sm">
            <Sparkles className="h-8 w-8 text-primary" />
            <p className="text-sm text-muted-foreground">还没有生成方案，可先预览已有内容</p>
            <Button asChild>
              <Link to={`/workbench/${id}?tab=plan&restore=1`}>去工作台生成方案</Link>
            </Button>
          </section>
        )}

        {/* 活动要求 + 已选方向：严格区分已确认 / AI 建议 / 未定 */}
        <section className="rounded-2xl border bg-card p-5 shadow-sm md:p-6">
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold">
            <CheckCircle2 className="h-4.5 w-4.5 text-primary" />
            活动要求与已选方向
          </h2>
          <div className="grid gap-6 md:grid-cols-2">
            <div className="flex flex-col gap-2.5">
              {req.goal && (
                <p className="text-sm leading-relaxed">
                  <span className="mr-2 text-xs font-medium text-muted-foreground">目标</span>
                  {req.goal}
                </p>
              )}
              {req.type && (
                <p className="text-sm leading-relaxed">
                  <span className="mr-2 text-xs font-medium text-muted-foreground">类型</span>
                  {req.type}
                </p>
              )}
              {REQ_VAL_FIELDS.map((f) => {
                const v = req[f.key];
                const has = !!v && v.value != null && String(v.value).trim() !== '';
                return (
                  <p key={f.key} className="flex items-center gap-2 text-sm leading-relaxed">
                    <span className="min-w-16 text-xs font-medium text-muted-foreground">{f.label}</span>
                    {has ? <span className="min-w-0 flex-1">{String(v?.value)}</span> : <span className="min-w-0 flex-1 text-muted-foreground">未定（可留空）</span>}
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        isUnknownReqValue(v) ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400' : SOURCE_CLASS[v?.source ?? 'undecided']
                      }`}
                    >
                      {isUnknownReqValue(v) ? '待确认' : SOURCE_LABEL[v?.source ?? 'undecided']}
                    </span>
                  </p>
                );
              })}
              {req.otherNeeds && (
                <p className="mt-1 rounded-xl bg-muted/50 p-3 text-sm leading-relaxed">
                  <span className="mr-2 text-xs font-medium text-muted-foreground">其他要求</span>
                  {req.otherNeeds}
                </p>
              )}
            </div>
            <div className="h-fit flex flex-col gap-3 rounded-xl border bg-muted/30 p-4">
              <p className="text-xs font-medium text-muted-foreground">已选方向</p>
              {selectedDir ? (
                <>
                  <p className="text-base font-semibold">{selectedDir.name}</p>
                  <p className="text-sm text-muted-foreground">{selectedDir.style}</p>
                  {(selectedDir.difficulty || selectedDir.budgetLevel) && (
                    <div className="flex flex-wrap gap-1.5">
                      {selectedDir.difficulty && (
                        <span className="rounded-full border border-border bg-background px-2 py-0.5 text-[10px] text-muted-foreground">
                          准备 {selectedDir.difficulty}
                        </span>
                      )}
                      {selectedDir.budgetLevel && (
                        <span className="rounded-full border border-primary/25 bg-primary/5 px-2 py-0.5 text-[10px] text-primary/80">
                          预算 {selectedDir.budgetLevel}
                        </span>
                      )}
                    </div>
                  )}
                  <p className="text-xs leading-relaxed text-muted-foreground">{selectedDir.note}</p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">还没选定方向{(d.directions ?? []).length > 0 ? '（候选方向待选）' : ''}</p>
              )}
            </div>
          </div>
        </section>

        {/* 流程 + 文案 */}
        {d.schedule && d.schedule.length > 0 && (
          <div className="grid gap-6 md:grid-cols-2">
            <section className="rounded-2xl border bg-card p-5 shadow-sm md:p-6">
              <h2 className="mb-4 flex items-center gap-2 text-base font-semibold">
                <Clock3 className="h-4.5 w-4.5 text-primary" />
                活动流程
              </h2>
              <ol className="flex flex-col gap-2.5">
                {d.schedule.map((s, i) => (
                  <li key={s.id} className="flex items-baseline gap-3">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium">
                        {s.time && <span className="mr-2 text-primary">{s.time}</span>}
                        {s.name}
                        {s.duration && <span className="ml-2 text-xs text-muted-foreground">{s.duration}</span>}
                      </p>
                      {s.note && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{s.note}</p>}
                    </div>
                  </li>
                ))}
              </ol>
            </section>

            <section className="flex flex-col gap-4 rounded-2xl border bg-card p-5 shadow-sm md:p-6">
              <h2 className="flex items-center gap-2 text-base font-semibold">
                <MessageSquareText className="h-4.5 w-4.5 text-primary" />
                活动文案
              </h2>
              {d.copies?.invite && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">邀请函</p>
                  <p className="whitespace-pre-line rounded-xl bg-muted/50 p-3 text-sm leading-relaxed">{d.copies.invite}</p>
                </div>
              )}
              {d.copies?.hosting && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">主持词</p>
                  <p className="whitespace-pre-line rounded-xl bg-muted/50 p-3 text-sm leading-relaxed">{d.copies.hosting}</p>
                </div>
              )}
              {(d.copies?.onsite ?? []).length > 0 && (
                <div>
                  <p className="mb-1.5 text-xs font-medium text-muted-foreground">现场指引</p>
                  <ul className="flex flex-col gap-1">
                    {d.copies!.onsite!.map((line, i) => (
                      <li key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                        <span className="h-1 w-1 rounded-full bg-primary" />
                        {line}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {!d.copies?.invite && !d.copies?.hosting && (
                <p className="text-sm text-muted-foreground">还没有文案，可在工作台生成。</p>
              )}
            </section>
          </div>
        )}

        {/* 物料与准备任务 */}
        {((d.materials ?? []).length > 0 || (d.tasks ?? []).length > 0) && (
          <section className="rounded-2xl border bg-card p-5 shadow-sm md:p-6">
            <h2 className="mb-4 flex items-center gap-2 text-base font-semibold">
              <CheckCircle2 className="h-4.5 w-4.5 text-primary" />
              物料与准备任务
            </h2>
            <div className="grid gap-6 md:grid-cols-2">
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium text-muted-foreground">物料清单（{materialsReady}/{d.materials?.length ?? 0} 就绪）</p>
                {(d.materials ?? []).map((m) => (
                  <p key={m.id} className="flex items-center gap-2 text-sm">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${m.ready ? 'bg-primary' : 'bg-muted-foreground/40'}`} />
                    <span className="min-w-0 flex-1 truncate">{m.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{m.qty}</span>
                    <span className={`shrink-0 text-[10px] ${m.ready ? 'text-primary' : 'text-muted-foreground'}`}>{m.ready ? '已就绪' : '未就绪'}</span>
                  </p>
                ))}
              </div>
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium text-muted-foreground">准备任务（{tasksDone}/{d.tasks?.length ?? 0} 完成）</p>
                {(d.tasks ?? []).map((t) => (
                  <p key={t.id} className="flex items-center gap-2 text-sm">
                    <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${t.done ? 'bg-primary' : 'bg-muted-foreground/40'}`} />
                    <span className="min-w-0 flex-1 truncate">{t.name}</span>
                    <span className={`shrink-0 text-[10px] ${t.done ? 'text-primary' : 'text-muted-foreground'}`}>{t.done ? '已完成' : '进行中'}</span>
                  </p>
                ))}
              </div>
            </div>
          </section>
        )}

        {/* 场景布置：应用内拖拽对比 + stale 标注 + 完整图片下载 */}
        {d.scene?.beforeUrl && d.scene?.afterUrl && (
          <section className="rounded-2xl border bg-card p-5 shadow-sm md:p-6">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <h2 className="text-base font-semibold">场景布置效果</h2>
              {d.scene.isExample && (
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">示例效果</span>
              )}
              {d.scene.stale && (
                <span className="rounded-full bg-chart-5/15 px-2 py-0.5 text-xs font-medium text-chart-5">对应调整前的要求</span>
              )}
              <Button variant="outline" size="sm" className="ml-auto h-8" onClick={() => downloadEffect(d.scene?.afterUrl as string)}>
                <Download className="h-3.5 w-3.5" />
                下载效果图
              </Button>
            </div>
            <CompareCanvas beforeUrl={d.scene.beforeUrl} afterUrl={d.scene.afterUrl} className="aspect-[3/2] w-full rounded-xl" />
            <p className="mt-3 text-center text-xs text-muted-foreground">拖动分割线，对比布置前后</p>
          </section>
        )}

        {/* 费用明细：数量×单价实际计算 + 未计价事项 */}
        <section className="rounded-2xl border bg-card p-5 shadow-sm md:p-6">
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold">
            <Wallet className="h-4.5 w-4.5 text-primary" />
            费用与预算
          </h2>
          {items.length > 0 ? (
            <>
              {/* 移动端：双行卡片清单，防止长项目名把小计列挤出视口 */}
              <div className="flex flex-col divide-y divide-border md:hidden">
                {items.map((it) => (
                  <div key={it.id} className="py-2.5 first:pt-0 last:pb-0">
                    <div className="flex items-start justify-between gap-3">
                      <span className="min-w-0 flex-1 text-sm font-medium leading-snug">{it.name}</span>
                      <span className="shrink-0 text-sm font-semibold tabular-nums">
                        {it.priceUnknown ? <span className="text-chart-5">待询价</span> : subtotalLabel(it)}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-muted-foreground tabular-nums">
                      数量 {Number(it.qty) || 0} × 单价{' '}
                      {it.priceUnknown ? '待询价' : unitPriceLabel(it)}
                    </p>
                  </div>
                ))}
              </div>
              {/* 桌面端：完整明细表 */}
              <div className="hidden w-full max-w-full overflow-x-auto bg-card md:block">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs text-muted-foreground">
                      <th className="py-2 pr-4 font-medium">项目</th>
                      <th className="whitespace-nowrap py-2 pr-4 font-medium">数量</th>
                      <th className="whitespace-nowrap py-2 pr-4 font-medium">单价</th>
                      <th className="whitespace-nowrap py-2 text-right font-medium">小计</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((it) => (
                      <tr key={it.id} className="border-b last:border-0">
                        <td className="py-2 pr-4">{it.name}</td>
                        <td className="whitespace-nowrap py-2 pr-4 tabular-nums">{Number(it.qty) || 0}</td>
                        <td className="whitespace-nowrap py-2 pr-4 tabular-nums">
                          {it.priceUnknown ? <span className="text-chart-5">待询价</span> : unitPriceLabel(it)}
                        </td>
                        <td className="whitespace-nowrap py-2 text-right tabular-nums">
                          {it.priceUnknown ? <span className="text-chart-5">待询价</span> : subtotalLabel(it)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">暂无费用条目。</p>
          )}
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Stat label={`费用合计${unpriced.length > 0 ? `（另 ${unpriced.length} 项待询价未计入）` : ''}`} value={`¥${total.toLocaleString()}`} />
            <Stat
              label={remaining != null && remaining < 0 ? '超出预算' : '预算剩余'}
              value={remaining != null ? `¥${Math.abs(remaining).toLocaleString()}` : '未设上限'}
              accent={remaining != null && remaining < 0}
            />
            <Stat label="物料就绪" value={`${materialsReady}/${d.materials?.length ?? 0}`} />
            <Stat label="任务完成" value={`${tasksDone}/${d.tasks?.length ?? 0}`} />
          </div>
          {unpriced.length > 0 && (
            <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
              未计价事项（价格待询，未计入合计）：{unpriced.map((x) => x.name).join('、')}
            </p>
          )}
        </section>

        {/* 待完善事项：直达工作区对应位置，不自动请求 AI */}
        <section className="rounded-2xl border bg-card p-5 shadow-sm md:p-6">
          <h2 className="mb-4 flex items-center gap-2 text-base font-semibold">
            <Clock3 className="h-4.5 w-4.5 text-primary" />
            待完善事项
          </h2>
          {pendings.length > 0 ? (
            <ul className="flex flex-col gap-2">
              {pendings.map((p, i) => (
                <li key={i}>
                  {embed ? (
                    /* 弹窗内嵌模式：不导航 iframe（避免加载第二套工作区），通知宿主关闭预览并定位目标 */
                    <button
                      type="button"
                      onClick={() =>
                        window.parent?.postMessage({ type: 'sf-locate', projectId: id, tab: p.tab, ...(p.field ? { field: p.field } : {}) }, window.location.origin)
                      }
                      className="flex w-full items-center gap-2 rounded-xl border bg-muted/30 px-3 py-2 text-left text-sm transition-colors hover:border-primary/40 hover:bg-primary/5"
                    >
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      <span className="min-w-0 flex-1 leading-relaxed">{p.text}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">去处理 →</span>
                    </button>
                  ) : (
                    <Link
                      to={`/workbench/${id}?tab=${p.tab}&restore=1`}
                      className="flex items-center gap-2 rounded-xl border bg-muted/30 px-3 py-2 text-sm transition-colors hover:border-primary/40 hover:bg-primary/5"
                    >
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                      <span className="min-w-0 flex-1 leading-relaxed">{p.text}</span>
                      <span className="shrink-0 text-xs text-muted-foreground">去处理 →</span>
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              各项内容已就绪。
            </p>
          )}
        </section>

        {/* 相关物料与场地（默认展示，查看不修改清单与预算） */}
        <details open className="group rounded-2xl border bg-card p-5 shadow-sm md:p-6">
          <summary className="cursor-pointer list-none">
            <span className="flex items-center justify-between gap-3">
              <span className="flex min-w-0 items-center gap-2 text-base font-semibold">
                <MapPin className="h-4 w-4 shrink-0 text-primary" />
                相关物料与场地（可选参考）
              </span>
              <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">相关购买渠道与场地入口 · 不会修改你的清单与预算</span>
          </summary>
          <div className="mt-4 flex flex-col gap-3">
            {getMaterialMatches((d.materials ?? []).map((m) => `${m.name} ${m.category}`))
              .slice(0, 4)
              .map((r) => (
                <MaterialCard key={r.id} r={r} compact />
              ))}
            <VenueSection />
          </div>
        </details>
      </div>

      {/* PDF 导出打印视图（平时隐藏，打印时唯一可见） */}
      {printOpen && <PrintLayout title={project.title} data={d} pendings={pendings} />}
    </div>
  );
}

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl bg-muted/50 p-3.5 text-center">
      <p className="mb-1 text-xs text-muted-foreground">{label}</p>
      <p className={`text-lg font-bold tabular-nums ${accent ? 'text-destructive' : ''}`}>{value}</p>
    </div>
  );
}
