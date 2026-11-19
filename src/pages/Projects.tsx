import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CloudOff, Loader2, Pencil, Plus, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { deleteProject, listProjects, updateProject } from '@/services/api';
import { CASES } from '@/data/cases';
import { useAuth } from '@/contexts/AuthContext';
import { usePageEntrance } from '@/hooks/usePageEntrance';
import type { ProjectListItem } from '@/types/types';
import { cn } from '@/lib/utils';

/** 文字封面模板：按项目 id 稳定选择（同一项目始终同一模板，不随机跳变） */
const COVER_TEMPLATES = [
  { bg: 'bg-gradient-to-br from-primary/15 to-primary/5', accent: 'text-primary' },
  { bg: 'bg-muted', accent: 'text-foreground' },
  { bg: 'bg-gradient-to-br from-primary/10 via-card to-primary/20', accent: 'text-primary' },
] as const;

const templateOf = (id: string) => {
  let sum = 0;
  for (let i = 0; i < id.length; i++) sum += id.charCodeAt(i);
  return COVER_TEMPLATES[sum % COVER_TEMPLATES.length];
};

/** 项目进度阶段（卡片 Badge；仅基于已保存数据判断，不猜测） */
function progressOf(p: ProjectListItem): string {
  const d = p.data;
  if (d?.scene?.afterUrl) return '已有布置效果';
  if (d?.theme || (d?.schedule?.length ?? 0) > 0) return '已有方案';
  if ((d?.chatLog?.length ?? 0) > 0) return '讨论中';
  return '刚开始';
}

/** 封面可展示标签（≤3：活动类型 / 主题 / 场地布置） */
function tagsOf(p: ProjectListItem): string[] {
  const d = p.data;
  const out: string[] = [];
  if (d?.requirements?.type) out.push(String(d.requirements.type));
  const theme = d?.requirements?.visualTheme?.value;
  if (theme) out.push(String(theme));
  if (d?.intent === 'venue') out.push('场地布置');
  return out.slice(0, 3);
}

/** 案例封面回退：副本项目按 caseId（新）或案例名/数据特征匹配（旧数据）取案例库封面，仅渲染回退不覆盖用户封面 */
function caseCoverFallback(p: ProjectListItem): string | undefined {
  const d = p.data;
  if (d?.caseCoverUrl) return undefined; // 已有直接字段，无需回退
  const byId = d?.caseId ? CASES.find((c) => c.id === d.caseId) : undefined;
  if (byId?.coverUrl) return byId.coverUrl;
  /* 旧副本按标题主/副名与案例名互相包含匹配（如「验收测试｜年会副本」） */
  const names = p.title.split(/[｜|]/).map((s) => s.trim()).filter(Boolean);
  for (const n of names) {
    const byName = CASES.find((c) => n.includes(c.name) || c.name.includes(n));
    if (byName?.coverUrl) return byName.coverUrl;
  }
  /* 旧副本兜底：与完整案例的活动目标一致时回退该案例封面（用户深度编辑过则不强配，走文字封面） */
  const goal = d?.requirements?.goal;
  if (goal) {
    const byGoal = CASES.find((c) => c.full && c.demo.requirements?.goal === goal);
    if (byGoal?.coverUrl) return byGoal.coverUrl;
  }
  return undefined;
}

/** 卡片封面：用户图片优先（coverUrl → 效果图 → 原图 → 案例封面），无图渲染真实活动名称的文字封面 */
function Cover({ p, failedIds, onFail }: { p: ProjectListItem; failedIds: Set<string>; onFail: (id: string) => void }) {
  const src = p.coverUrl ?? p.data?.scene?.afterUrl ?? p.data?.scene?.beforeUrl ?? caseCoverFallback(p);
  if (src && !failedIds.has(p.id)) {
    return (
      <img
        src={src}
        alt={p.title}
        loading="lazy"
        className="h-full w-full object-cover"
        onError={() => onFail(p.id)}
      />
    );
  }
  const t = templateOf(p.id);
  const tags = tagsOf(p);
  return (
    <div className={cn('relative flex h-full w-full flex-col items-start justify-center gap-2 p-4 md:p-5', t.bg)}>
      <Sparkles className="absolute right-3 top-3 h-5 w-5 text-primary/20" aria-hidden />
      <p className={cn('text-xl font-bold leading-snug line-clamp-3 break-words md:text-2xl', t.accent)} title={p.title}>
        {p.title}
      </p>
      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span
              key={tag}
              className="rounded-full bg-background/70 px-2 py-0.5 text-[11px] text-muted-foreground backdrop-blur"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Projects() {
  const pageRef = useRef<HTMLDivElement>(null);
  usePageEntrance(pageRef);
  const navigate = useNavigate();
  const { ready, userId } = useAuth();
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [items, setItems] = useState<ProjectListItem[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
  /** 图片加载失败的项目 id（回退文字封面） */
  const [failedIds, setFailedIds] = useState<Set<string>>(new Set());
  /* 会话切换竞态防护：请求发出时的 userId 快照；返回时归属已变（退出/重登）则丢弃结果，
   * 防止旧会话的空列表覆盖新会话数据 */
  const userIdRef = useRef<string | null>(userId);
  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  const markFailed = useCallback((id: string) => {
    setFailedIds((prev) => new Set(prev).add(id));
  }, []);

  const load = useCallback(async () => {
    const forUser = userIdRef.current;
    setLoadError(false);
    setLoading(true);
    try {
      const list = await listProjects();
      if (userIdRef.current !== forUser) return; /* 会话已切换：丢弃过期响应 */
      setItems(list);
    } catch (e) {
      if (userIdRef.current !== forUser) return;
      console.error(e);
      setLoadError(true);
    } finally {
      if (userIdRef.current === forUser) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!ready || !userId) return;
    void load();
  }, [ready, userId, load]);

  /* ---------- 标题重命名（卡片行内编辑，回车/失焦保存，Esc 取消） ---------- */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const saveTitle = async (id: string) => {
    const t = editTitle.trim();
    setEditingId(null);
    if (!t) return;
    const item = items.find((x) => x.id === id);
    if (!item || t === item.title) return;
    try {
      await updateProject(id, { title: t });
      setItems((prev) => prev.map((x) => (x.id === id ? { ...x, title: t } : x)));
      toast.success('标题已更新');
    } catch (e) {
      console.error(e);
      toast.error('保存失败，请重试');
    }
  };

  const remove = async (id: string) => {
    setDeleting(id);
    try {
      await deleteProject(id);
      setItems((prev) => prev.filter((x) => x.id !== id));
      toast.success('活动已删除');
    } catch (e) {
      console.error(e);
      toast.error('删除失败，请重试');
    } finally {
      setDeleting(null);
    }
  };

  if (loading || !ready) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <span className="text-sm">正在载入活动…</span>
      </div>
    );
  }

  return (
    <div ref={pageRef} className="sf-page-body mx-auto w-full max-w-6xl px-4 py-10 md:px-6 md:py-14">
      <div className="sf-deco" aria-hidden="true">
        <span className="sf-blob sf-paper-purple" style={{ top: '-10%', left: '-18%', width: '30vw', height: '30vw', minWidth: 240, minHeight: 240 }} />
        <span className="sf-blob sf-paper-cream" style={{ top: '4%', right: '-16%', width: '26vw', height: '26vw', minWidth: 200, minHeight: 200 }} />
      </div>
      <div className="sf-reveal-hero mb-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-display text-3xl font-black tracking-tight md:text-4xl">
            我的活动<span className="text-primary">。</span>
          </h1>
          <p className="mt-2 text-sm text-muted-foreground md:text-base">访客与账号的活动都在这里，自动保存</p>
        </div>
        <Button asChild className="sf-pill-cobalt rounded-full border-0 px-5 font-semibold hover:opacity-95">
          <Link to="/plan">
            <Plus className="h-4 w-4" />
            新建活动
          </Link>
        </Button>
      </div>

      {loadError ? (
        /* 加载失败终态：给出重试入口，不静默空列表 */
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed py-20 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <CloudOff className="h-6 w-6" />
          </span>
          <div>
            <p className="font-medium">活动列表加载失败</p>
            <p className="mt-1 text-sm text-muted-foreground">网络或服务暂时不可用，你的数据没有丢失</p>
          </div>
          <Button variant="outline" onClick={() => void load()}>
            <RotateCcw className="h-4 w-4" />
            重试
          </Button>
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-dashed py-20 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <Sparkles className="h-6 w-6" />
          </span>
          <div>
            <p className="font-medium">还没有活动</p>
            <p className="mt-1 text-sm text-muted-foreground">从一个想法开始，AI 陪你完成整场策划</p>
          </div>
          <Button asChild>
            <Link to="/plan">开始策划</Link>
          </Button>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {items.map((p) => {
            const r = p.data?.requirements;
            const headcount = r?.headcount?.value ? String(r.headcount.value) : null;
            const budget = r?.budget?.value ? String(r.budget.value) : null;
            return (
              <div
                key={p.id}
                className="sf-card sf-card-hover group relative cursor-pointer overflow-hidden rounded-2xl"
                onClick={() => navigate(`/workbench/${p.id}`)}
              >
                {/* 封面：用户真实图片优先，无图时文字封面 */}
                <div className="relative aspect-[3/2] overflow-hidden">
                  <Cover p={p} failedIds={failedIds} onFail={markFailed} />
                </div>
                <div className="p-4">
                  <div className="mb-1.5 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                    {editingId === p.id ? (
                      <Input
                        autoFocus
                        value={editTitle}
                        onChange={(e) => setEditTitle(e.target.value)}
                        onBlur={() => void saveTitle(p.id)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void saveTitle(p.id);
                          if (e.key === 'Escape') setEditingId(null);
                        }}
                        className="h-7 px-2 text-sm font-semibold"
                        aria-label="活动名称"
                      />
                    ) : (
                      <>
                        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold" title={p.title}>
                          {p.title}
                        </h3>
                        <button
                          type="button"
                          aria-label="重命名活动"
                          onClick={() => {
                            setEditingId(p.id);
                            setEditTitle(p.title);
                          }}
                          className="shrink-0 rounded-md p-1 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus-visible:opacity-100 group-hover:opacity-100"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                  <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                      {progressOf(p)}
                    </span>
                    {r?.type && <span className="text-[11px] text-muted-foreground">{r.type}</span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                    <span>
                      更新于{' '}
                      {new Date(p.updateTime).toLocaleString('zh-CN', {
                        month: 'numeric',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </span>
                    {headcount && <span>人数 {headcount}</span>}
                    {budget && <span>预算 {budget}</span>}
                  </div>
                </div>
                {/* 删除 */}
                <div className="absolute right-3 top-3" onClick={(e) => e.stopPropagation()}>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 bg-black/40 text-white backdrop-blur hover:bg-black/60 hover:text-white"
                        disabled={deleting === p.id}
                        aria-label={`删除 ${p.title}`}
                      >
                        {deleting === p.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
                      <AlertDialogHeader>
                        <AlertDialogTitle>删除这个活动？</AlertDialogTitle>
                        <AlertDialogDescription>
                          「{p.title}」及其全部方案、布置与预算数据将被删除，此操作不可撤销。
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>取消</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={() => remove(p.id)}
                        >
                          确认删除
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
