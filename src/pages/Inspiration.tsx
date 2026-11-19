import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  BookOpen,
  Cake,
  GraduationCap,
  HeartHandshake,
  Lightbulb,
  MapPin,
  Search,
  Sparkles,
  Users,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CATEGORIES, CONTENT_TYPES, INSPIRATIONS, PREP_NOTES } from '@/data/inspiration';
import { getMaterialMatches } from '@/data/resources';
import ReturnBar from '@/components/shared/ReturnBar';
import { MaterialCard } from '@/components/workbench/ResourceCards';
import { usePageEntrance } from '@/hooks/usePageEntrance';
import type { InspirationEntry } from '@/types/types';
import { cn } from '@/lib/utils';

const TYPE_COLOR: Record<string, string> = {
  game: 'bg-primary',
  show: 'bg-amber-500',
  decor: 'bg-rose-500',
  props: 'bg-sky-500',
  food: 'bg-emerald-500',
  copy: 'bg-violet-500',
};

const TYPE_BADGE: Record<string, string> = {
  game: 'bg-indigo-50 text-indigo-700 border-indigo-200/70',
  show: 'bg-amber-50 text-amber-800 border-amber-200/80',
  decor: 'bg-rose-50 text-rose-700 border-rose-200/70',
  props: 'bg-sky-50 text-sky-700 border-sky-200/70',
  food: 'bg-emerald-50 text-emerald-700 border-emerald-200/70',
  copy: 'bg-violet-50 text-violet-700 border-violet-200/70',
};

const TYPE_STRIPE: Record<string, string> = {
  game: 'from-indigo-500/80 to-violet-500/70',
  show: 'from-amber-400/90 to-orange-400/80',
  decor: 'from-rose-400/90 to-pink-400/80',
  props: 'from-sky-400/90 to-cyan-400/80',
  food: 'from-emerald-400/90 to-teal-400/80',
  copy: 'from-violet-500/85 to-fuchsia-400/75',
};

const TYPE_NAME: Record<string, string> = {
  game: '游戏与互动',
  show: '节目与仪式',
  decor: '主题与布置',
  props: '物料与道具',
  food: '餐饮与氛围',
  copy: '文案与小创意',
};

const SCENE_ICON: Record<string, typeof Users> = {
  personal: Cake,
  org: Users,
  campus: GraduationCap,
  community: HeartHandshake,
  culture: BookOpen,
};

/** 适用场景标签（最多展示 3 个，附「等」） */
function SceneTags({ scenes }: { scenes: InspirationEntry['scenes'] }) {
  const names = scenes
    .slice(0, 3)
    .map((s) => CATEGORIES.find((c) => c.id === s)?.name)
    .filter(Boolean);
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <MapPin className="h-3 w-3" />
      {names.join(' · ')}
      {scenes.length > 3 ? ' 等' : ''}
    </span>
  );
}

export default function Inspiration() {
  const pageRef = useRef<HTMLDivElement>(null);
  usePageEntrance(pageRef);
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState('');
  const [type, setType] = useState('all');
  const [detailId, setDetailId] = useState<string | null>(null);

  const cat = params.get('cat') ?? 'all';
  /* AI 引用跳转：?focus=id 直开对应详情（从对话「参考灵感」标签进入，看完关闭回列表原位置） */
  const focusParam = params.get('focus');
  useEffect(() => {
    if (focusParam && INSPIRATIONS.some((e) => e.id === focusParam)) {
      setDetailId(focusParam);
      setParams((prev) => {
        prev.delete('focus');
        return prev;
      }, { replace: true });
    }
  }, [focusParam, setParams]);

  const filtered = useMemo(() => {
    let list = INSPIRATIONS;
    if (cat !== 'all') list = list.filter((i) => i.scenes.includes(cat as InspirationEntry['scenes'][number]));
    if (type !== 'all') list = list.filter((i) => i.contentType === type);
    if (query.trim()) {
      const q = query.trim().toLowerCase();
      list = list.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.howTo.toLowerCase().includes(q) ||
          i.tags.some((t) => t.toLowerCase().includes(q)) ||
          i.needs.toLowerCase().includes(q)
      );
    }
    /* 全部类型视图：采用均匀穿插交织算法，让含图卡片与纯文字卡片在整个列表中均匀分布，告别首尾堆叠与中间真空 */
    let result: InspirationEntry[] = list;
    if (type === 'all') {
      const core = list.filter((e) => !e.ext);
      const withCover = core.filter((e) => Boolean(e.coverUrl));
      const textOnly = core.filter((e) => !e.coverUrl);

      // 按不同内容类型轮转，避免纯文字条目同类扎堆
      const rotation = ['decor', 'game', 'show', 'props', 'food', 'copy'];
      const buckets = new Map<string, InspirationEntry[]>();
      for (const e of textOnly) {
        const arr = buckets.get(e.contentType) ?? [];
        arr.push(e);
        buckets.set(e.contentType, arr);
      }
      const sortedTextOnly: InspirationEntry[] = [];
      for (let guard = 0; guard < 100; guard += 1) {
        let added = false;
        for (const t of rotation) {
          const e = buckets.get(t)?.shift();
          if (e) {
            sortedTextOnly.push(e);
            added = true;
          }
        }
        if (!added) break;
      }

      // 穿插交织：首位先放 1 张精选封面图，然后每 2~3 个纯文字卡片穿插 1 张带图卡片，直至列表结束
      const interleaved: InspirationEntry[] = [];
      const coverQueue = [...withCover];
      const textQueue = [...sortedTextOnly];

      if (coverQueue.length > 0) {
        interleaved.push(coverQueue.shift()!);
      }

      const interval = coverQueue.length > 0 ? Math.max(2, Math.floor(textQueue.length / coverQueue.length)) : 3;

      while (textQueue.length > 0 || coverQueue.length > 0) {
        for (let i = 0; i < interval && textQueue.length > 0; i += 1) {
          interleaved.push(textQueue.shift()!);
        }
        if (coverQueue.length > 0) {
          interleaved.push(coverQueue.shift()!);
        }
      }
      result = interleaved;
    }
    /* 前三个场景标签首项错位：「多巴胺配色布置」同属于个人/企业/校园，原本三个标签下都排首位，
       连续切换像筛选没生效；按约定把它分别固定在 第1/3/5 位（仅移动该条，其余相对顺序不变） */
    const firstStagger: Record<string, number> = { personal: 0, org: 2, campus: 4 };
    const staggerAt = firstStagger[cat];
    if (staggerAt !== undefined) {
      const sharedHead = result.find((e) => e.id === 'dopamine-decor');
      if (sharedHead) {
        const rest = result.filter((e) => e.id !== 'dopamine-decor');
        result = [...rest.slice(0, staggerAt), sharedHead, ...rest.slice(staggerAt)];
      }
    }
    /* 拓展内容沉底 */
    return [...result].sort((a, b) => (a.ext ? 1 : 0) - (b.ext ? 1 : 0));
  }, [cat, type, query]);

  const detail = detailId ? INSPIRATIONS.find((i) => i.id === detailId) : null;
  /** 详情道具参考渠道（可选查看，正文独立免费可读） */
  const detailMatches = useMemo(
    () => (detail ? getMaterialMatches([detail.needs, ...detail.tags]).slice(0, 3) : []),
    [detail]
  );
  const prepNotes = useMemo(
    () => (cat === 'all' ? PREP_NOTES : PREP_NOTES.filter((n) => n.scenes.includes(cat as never))),
    [cat]
  );

  return (
    <div ref={pageRef} className="sf-page-body mx-auto w-full max-w-6xl px-4 py-8 md:px-6 md:py-12">
      <ReturnBar />
      <div className="sf-deco" aria-hidden="true">
        <span className="sf-blob sf-paper-purple" style={{ top: '-8%', left: '-16%', width: '30vw', height: '30vw', minWidth: 240, minHeight: 240 }} />
        <span className="sf-blob sf-paper-cream" style={{ top: '4%', right: '-14%', width: '26vw', height: '26vw', minWidth: 210, minHeight: 210 }} />
      </div>

      {/* 现代波普页头 */}
      <div className="sf-reveal-hero mb-7 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="sf-pill-amber inline-flex items-center gap-1.5 rounded-full px-3 py-0.5 text-xs font-bold">
              <Lightbulb className="h-3.5 w-3.5" />
              活动灵感墙
            </span>
            <span className="rounded-full border border-border/80 bg-card/90 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
              免登录直接拿走用 · 当前 {filtered.length} 条
            </span>
          </div>
          <h1 className="font-display text-3xl font-black tracking-tight text-foreground md:text-4xl">
            找灵感<span className="text-primary">。</span>
          </h1>
          <p className="text-sm text-muted-foreground md:text-base">
            先挑出好玩的局部玩法与布置点子，一键带进 AI 策划；整套全案请看
            <Link to="/cases" className="ml-1 font-semibold text-primary hover:underline">
              案例探索 →
            </Link>
          </p>
        </div>
        <Button asChild className="sf-pill-cobalt h-10 shrink-0 rounded-full border-0 px-5 text-sm font-semibold hover:opacity-95">
          <Link to="/plan">
            <Sparkles className="h-4 w-4" />
            直接让 AI 帮我凑点子
          </Link>
        </Button>
      </div>

      {/* 统一现代悬浮筛选工具条：场景 + 搜索 + 类型收拢进清爽卡片 */}
      <div className="sf-card mb-6 flex flex-col gap-3 rounded-2xl p-3.5 md:p-4">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 shrink-0 text-xs font-semibold text-muted-foreground">场景</span>
          {CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              onClick={() => setParams(c.id === 'all' ? {} : { cat: c.id })}
              className={cn(
                'rounded-full border px-3 py-1 text-xs font-medium transition-all',
                cat === c.id
                  ? 'sf-pill-cobalt border-0 font-semibold'
                  : 'border-border/80 bg-background/80 text-muted-foreground hover:border-primary/40 hover:text-foreground'
              )}
            >
              {c.name}
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3 border-t border-border/60 pt-3 md:flex-row md:items-center">
          <div className="relative md:w-64 md:shrink-0">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="搜索点子、玩法、道具…"
              className="h-9 rounded-full bg-background/80 pl-9 text-sm"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setType('all')}
              className={cn(
                'shrink-0 rounded-full border px-3 py-1 text-xs font-medium transition-all',
                type === 'all'
                  ? 'sf-pill-cobalt border-0 font-semibold'
                  : 'border-border/80 bg-background/80 text-muted-foreground hover:border-primary/40 hover:text-foreground'
              )}
            >
              全部类型
            </button>
            {CONTENT_TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setType(t.id)}
                className={cn(
                  'flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all',
                  type === t.id
                    ? 'sf-pill-cobalt border-0 font-semibold'
                    : 'border-border/80 bg-background/80 text-muted-foreground hover:border-primary/40 hover:text-foreground'
                )}
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', type === t.id ? 'bg-white' : TYPE_COLOR[t.id])} />
                {t.name}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* 点子列表：视觉优先三列瀑布流（有图卡大图置顶 + 纯文字卡顶部色条分级） */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
          <Search className="h-8 w-8" />
          <p className="text-sm">没有匹配的点子，换个类型或关键词试试</p>
        </div>
      ) : (
        <div className="columns-1 gap-4 md:columns-3">
          {filtered.map((entry) => {
            const hasCover = entry.contentType === 'decor' && Boolean(entry.coverUrl);
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setDetailId(entry.id)}
                className="sf-reveal-item sf-card sf-card-hover group mb-4 flex w-full flex-col overflow-hidden break-inside-avoid rounded-2xl text-left"
              >
                {/* 有图卡：大图置顶视觉主导；无图卡：顶部轻彩梯度色条区分品类 */}
                {hasCover ? (
                  <div className="relative aspect-[16/10] w-full overflow-hidden bg-muted">
                    <img
                      src={entry.coverUrl}
                      alt={`${entry.title}参考效果`}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                    />
                    <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-full bg-background/90 px-2.5 py-0.5 text-[11px] font-semibold text-foreground shadow-sm backdrop-blur-sm">
                      <span className={cn('h-1.5 w-1.5 rounded-full', TYPE_COLOR[entry.contentType])} />
                      {TYPE_NAME[entry.contentType]}
                    </span>
                  </div>
                ) : (
                  <div className={cn('h-1.5 w-full bg-gradient-to-r', TYPE_STRIPE[entry.contentType] ?? 'from-primary/70 to-primary/40')} />
                )}

                <div className="flex flex-col gap-2.5 p-4 md:p-5">
                  <div className="flex items-start justify-between gap-2.5">
                    <h3 className="font-display text-base font-bold tracking-tight text-foreground md:text-[17px]">
                      {entry.title}
                      {entry.ext && <span className="ml-1.5 text-xs font-normal text-muted-foreground">拓展</span>}
                    </h3>
                    {!hasCover && (
                      <span className={cn('shrink-0 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold', TYPE_BADGE[entry.contentType])}>
                        {TYPE_NAME[entry.contentType]}
                      </span>
                    )}
                  </div>
                  {/* 怎么玩：浏览即理解核心 */}
                  <p className="text-sm leading-relaxed text-foreground/85">{entry.howTo}</p>
                  {/* 适用条件 + 关键准备 */}
                  <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border/60 pt-2.5 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <Sparkles className="h-3 w-3 text-primary/70" />
                      {entry.format}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <span aria-hidden>·</span>
                      {entry.needs}
                    </span>
                    <SceneTags scenes={entry.scenes} />
                  </div>
                  <div className="flex items-center justify-between pt-1 text-xs font-medium text-primary">
                    <span className="text-muted-foreground transition-colors group-hover:text-primary">查看详情</span>
                    <Link
                      to={`/plan?desc=${encodeURIComponent(`${entry.title}：${entry.howTo}`)}`}
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 rounded-full bg-[#F4F5FF] px-3 py-1 font-semibold text-primary transition-all hover:bg-primary hover:text-primary-foreground"
                    >
                      用到策划中
                      <ArrowRight className="h-3 w-3" />
                    </Link>
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}

      {/* 筹备参考文章（次级内容） */}
      {prepNotes.length > 0 && (
        <section className="mt-10 border-t pt-8">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold text-muted-foreground">
            <BookOpen className="h-4 w-4" />
            筹备参考（辅助阅读）
          </h2>
          <div className="grid items-start gap-3 md:grid-cols-2">
            {prepNotes.map((n) => (
              <details key={n.id} className="group rounded-2xl border bg-card p-4 shadow-sm">
                <summary className="cursor-pointer list-none">
                  <span className="flex items-center justify-between gap-3">
                    <span className="text-sm font-semibold">{n.title}</span>
                    <span className="shrink-0 text-xs text-muted-foreground transition-transform group-open:rotate-180">
                      展开
                    </span>
                  </span>
                  <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{n.summary}</span>
                </summary>
                <div className="mt-3 flex flex-col gap-2.5 border-t pt-3">
                  {n.sections.map((s) => (
                    <p key={s.heading} className="text-sm leading-relaxed text-foreground/90">
                      <span className="font-semibold text-foreground">{s.heading}：</span>
                      {s.body}
                    </p>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </section>
      )}

      {/* 底部入口 */}
      <div className="mt-12 rounded-2xl border bg-gradient-to-br from-primary/10 via-card to-card p-6 text-center shadow-sm md:p-8">
        <Sparkles className="mx-auto mb-3 h-6 w-6 text-primary" />
        <h2 className="mb-2 text-lg font-bold">想把点子变成完整方案？</h2>
        <p className="mb-5 text-sm text-muted-foreground">告诉 AI 你的想法，一起把零散灵感串成整场活动</p>
        <Button asChild>
          <Link to="/plan">
            携手与AI共同策划
            <ArrowRight className="h-4 w-4" />
          </Link>
        </Button>
      </div>

      {/* 点子详情（Dialog：列表页不卸载，筛选与滚动位置天然保留） */}
      <Dialog open={!!detail} onOpenChange={(open) => !open && setDetailId(null)}>
        <DialogContent className="max-h-[90dvh] max-w-[calc(100%-2rem)] overflow-y-auto md:max-w-2xl">
          {detail && (
            <>
              <DialogHeader>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn('h-2 w-2 rounded-full', TYPE_COLOR[detail.contentType])} />
                  <span className="text-xs text-muted-foreground">{TYPE_NAME[detail.contentType]}</span>
                  {detail.ext && (
                    <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">拓展内容</span>
                  )}
                </div>
                <DialogTitle className="text-left text-xl md:text-2xl">{detail.title}</DialogTitle>
                <DialogDescription className="text-left">{detail.howTo}</DialogDescription>
              </DialogHeader>

              <div className="flex flex-col gap-5">
                {/* 布置类：参考图 */}
                {detail.contentType === 'decor' && detail.coverUrl && (
                  <div className="overflow-hidden rounded-xl border">
                    <img src={detail.coverUrl} alt={`${detail.title}参考效果`} className="aspect-video w-full object-cover" />
                    <p className="bg-muted/50 px-3 py-2 text-center text-xs text-muted-foreground">
                      参考效果示意 · 非实际供应商商品
                    </p>
                  </div>
                )}

                {/* 快览：格式/需求/场景 */}
                <dl className="grid gap-2.5 rounded-xl bg-muted/50 p-4 text-sm">
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0 text-xs font-medium text-muted-foreground">组织形式</dt>
                    <dd className="min-w-0 flex-1">{detail.format}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0 text-xs font-medium text-muted-foreground">空间道具</dt>
                    <dd className="min-w-0 flex-1">{detail.needs}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="w-16 shrink-0 text-xs font-medium text-muted-foreground">适用场景</dt>
                    <dd className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                      {detail.scenes.map((s) => {
                        const Icon = SCENE_ICON[s] ?? Users;
                        const name = CATEGORIES.find((c) => c.id === s)?.name;
                        return (
                          <span
                            key={s}
                            className="inline-flex items-center gap-1 rounded-full bg-background px-2 py-0.5 text-xs"
                          >
                            <Icon className="h-3 w-3 text-primary" />
                            {name}
                          </span>
                        );
                      })}
                    </dd>
                  </div>
                </dl>

                {/* 详情小节（按类型定制的内容） */}
                {detail.sections.map((s) => (
                  <section key={s.heading}>
                    <h3 className="mb-1.5 text-sm font-semibold text-foreground">{s.heading}</h3>
                    <p className="text-pretty text-sm leading-relaxed text-foreground/90">{s.body}</p>
                  </section>
                ))}

                {/* 数量估算表格 */}
                {detail.table && (
                  <div className="w-full max-w-full overflow-x-auto rounded-xl border">
                    <table className="min-w-max text-sm">
                      <thead>
                        <tr className="border-b bg-muted/50">
                          {detail.table.columns.map((c) => (
                            <th key={c} className="whitespace-nowrap px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
                              {c}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {detail.table.rows.map((row, i) => (
                          <tr key={i} className="border-b last:border-b-0">
                            {row.map((cell, j) => (
                              <td
                                key={j}
                                className={cn(
                                  'px-3 py-2 align-top leading-relaxed',
                                  j === 0 ? 'whitespace-nowrap font-medium' : 'text-foreground/90'
                                )}
                              >
                                {cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* 这些物料哪里找（可选，不影响正文阅读） */}
                {detailMatches.length > 0 && (
                  <details open className="rounded-xl border bg-muted/40 p-3">
                    <summary className="cursor-pointer select-none text-sm font-semibold">
                      这些物料哪里找 · 平台搜索入口
                    </summary>
                    <div className="mt-2.5 flex flex-col gap-2">
                      {detailMatches.map((r) => (
                        <MaterialCard key={r.id} r={r} compact />
                      ))}
                    </div>
                  </details>
                )}

                <p className="text-center text-xs text-muted-foreground">
                  参考内容 · 可直接用于你自己的活动，不自动加入方案
                </p>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
