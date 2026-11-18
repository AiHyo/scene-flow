import {
  ArrowLeft,
  Check,
  ChevronsDownUp,
  ChevronsUpDown,
  Clock3,
  CloudOff,
  ExternalLink,
  Loader2,
  Maximize2,
  MessageSquareHeart,
  Minimize2,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import AiAssistant from '@/components/workbench/AiAssistant';
import BudgetModule from '@/components/workbench/BudgetModule';
import PlanModule from '@/components/workbench/PlanModule';
import SceneModule from '@/components/workbench/SceneModule';
import { useAuth } from '@/contexts/AuthContext';
import { cn } from '@/lib/utils';
import { clearDraft, getDraft, getProject, listProjects, saveDraft, updateProject } from '@/services/api';
import { applySchedulePatch, checkOrig, locateKey, normName, normTime } from '@/services/adjustPatch';
import { extractScope, type ScopeModule } from '@/services/facts';
import { ensureIds, normalizeListIds } from '@/services/normalize';
import { clearReturnContext, getReturnContext, saveReturnContext } from '@/services/returnContext';
import { submitSceneGeneration } from '@/services/sceneGen';
import { normalizeTags, repairSceneData } from '@/services/sceneTags';
import type { AdjustCard, ChatMessage, Direction, ProjectData, ReqSource, SceneState } from '@/types/types';

type SaveState = 'saved' | 'saving' | 'error' | 'idle' | 'pending';

export default function Workbench() {
  const { id } = useParams<{ id: string }>();
  const { ready: authReady, userId, profile } = useAuth();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [title, setTitle] = useState('');
  const [data, setData] = useState<ProjectData | null>(null);
  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState<string>('');
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPanel, setAiPanel] = useState(true);
  /* 成果栏宽度：分栏视图下可拖拽调整；「宽屏编辑」进入固定宽度编辑视图（panelW 不参与、不覆盖）
   * 分栏宽度按浏览器持久化（localStorage），刷新/离开返回继续沿用；返回分栏时恢复该比例；窗口变化时在可用范围内收敛 */
  const clampPanelW = useCallback((w: number) => {
    /* 左侧对话区保底 520px，成果栏 360–780px */
    const maxW = Math.max(400, Math.min(780, window.innerWidth - 520));
    return Math.max(360, Math.min(maxW, w));
  }, []);
  const [panelW, setPanelW] = useState(() => {
    let w = 400;
    try {
      const raw = Number(localStorage.getItem('sf-workbench-panel-w'));
      if (Number.isFinite(raw) && raw >= 360 && raw <= 780) w = raw;
    } catch {
      /* 隐私模式等场景回退默认宽度 */
    }
    return clampPanelW(w);
  });
  const [panelExpanded, setPanelExpanded] = useState(false);
  /* 宽屏编辑宽度 = 分栏拖拽线可拖到的最左侧位置（左侧对话区保底 520px，成果栏上限 780px），随窗口实时收敛 */
  const [winW, setWinW] = useState(() => window.innerWidth);
  const expandedW = Math.max(400, Math.min(780, winW - 520));
  const panelDragRef = useRef<{ startX: number; startW: number } | null>(null);
  /* 成果栏滚动容器：查看入口切页签后回到顶部 */
  const panelScrollRef = useRef<HTMLElement | null>(null);
  /* 窗口尺寸变化：把已保存宽度收敛到当前可用范围（不恢复默认） */
  useEffect(() => {
    const onResize = () => {
      setPanelW((w) => clampPanelW(w));
      setWinW(window.innerWidth);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [clampPanelW]);
  const onPanelResizeStart = (e: React.PointerEvent<HTMLDivElement>) => {
    panelDragRef.current = { startX: e.clientX, startW: panelW };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPanelResizeMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const d = panelDragRef.current;
    if (!d) return;
    /* 拖动过程中即时收敛（左侧对话区保底 520px），两侧内容平滑跟随 */
    setPanelW(clampPanelW(d.startW - (e.clientX - d.startX)));
  };
  const onPanelResizeEnd = () => {
    panelDragRef.current = null;
    /* 松手持久化：刷新/返回后继续沿用当前宽度 */
    try {
      localStorage.setItem('sf-workbench-panel-w', String(panelW));
    } catch {
      /* 持久化失败不影响当次使用 */
    }
  };
  /* 对话入口 → 打开需求摘要（活动方案页签+滚动）与场景生成（切页签+滚到布置要求） */
  const [reqSignal, setReqSignal] = useState(0);
  /* 预览「未知条件→去处理」：直接打开全部字段编辑并定位未确定项 */
  const [reqEditSignal, setReqEditSignal] = useState(0);
  const [sceneSignal, setSceneSignal] = useState(0);
  /** 对话内「生成完整方案」信号：触发 PlanModule 复用按钮同一生成流程（含补问/替换确认/会话概览） */
  /* 触发来源随任务入口传递：对话分发复用用户原消息（不追加第二条用户请求），
   * 按钮触发才由模块合成一条对应用户请求 */
  const [schemeSignal, setSchemeSignal] = useState<{ seq: number; viaChat: boolean } | null>(null);
  /* 对话明确「只改主题」：与主题按钮同一草稿确认链路（新主题先入会话待确认，确认才替换） */
  const [themeSignal, setThemeSignal] = useState<{ seq: number; viaChat: boolean; text?: string } | null>(null);
  /* 对话明确请求单独生成文案：复用文案按钮同一流程（任务锁/草稿确认/概述共用） */
  const [copiesSignal, setCopiesSignal] = useState<{ seq: number; viaChat: boolean } | null>(null);
  /* 桌面/移动判定：成果模块与 AI 面板只挂载一份实例。
   * 此前桌面 aside（hidden md:block）与移动容器（md:hidden）同时嵌入 modulesPanel/AiAssistant，
   * CSS 隐藏不卸载 → 组件双实例 → effect 双触发（「先选候选方向」回复两次、任务重复执行的根因） */
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(min-width: 768px)').matches
  );
  useEffect(() => {
    const mq = window.matchMedia('(min-width: 768px)');
    const fn = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, []);
  /* 成果栏页签（受控：对话区按钮可直接切页签，桌面/移动两处 Tabs 同步） */
  const [modTab, setModTab] = useState<string | null>(null);
  /* 有新成果更新的模块页签（收起卡片的红点提示；切到该页签即清除） */
  const [freshTabs, setFreshTabs] = useState<Array<'plan' | 'scene' | 'budget'>>([]);
  /* 全部收起：随项目持久化（data.ui.allCollapsed），进入时恢复 */
  const [allCollapsed, setAllCollapsed] = useState(false);
  useEffect(() => {
    setAllCollapsed(!!data?.ui?.allCollapsed);
  }, [data?.ui?.allCollapsed]);
  const allCollapsedRef = useRef(allCollapsed);
  allCollapsedRef.current = allCollapsed;
  const toggleAllCollapsed = useCallback(() => {
    setAllCollapsed((prev) => !prev);
  }, []);
  const handleModTab = useCallback((v: string) => {
    setModTab(v);
    setFreshTabs((prev) => prev.filter((m) => m !== v));
  }, []);
  /* ===== 跨页返回上下文：离开工作区时保存（供合作伙伴/灵感库等页面「返回当前活动」） =====
   * 恢复入口：/workbench/:id?tab=xx&restore=1（返回条/导航生成），恢复页签+滚动位置+输入草稿（草稿在 AiAssistant 内自管） */
  const [searchParams] = useSearchParams();
  /* 上下文页签：用户实际所在页签（未点过时按意图推断默认值，与 Tabs value 同源，不落 plan 假默认） */
  const effTab = modTab ?? (data?.intent === 'venue' ? 'scene' : 'plan');
  const ctxRef = useRef({ id: id ?? '', title: '', tab: null as string | null });
  ctxRef.current = { id: id ?? '', title, tab: effTab };
  useEffect(() => {
    if (id) {
      try {
        sessionStorage.setItem('sf-last-workbench', id);
      } catch {
        /* ignore */
      }
    }
    const restore = searchParams.get('restore') === '1';
    const urlTab = searchParams.get('tab');
    if (urlTab === 'plan' || urlTab === 'scene' || urlTab === 'budget') {
      /* 预览/待完善事项直达指定成果页签（优先于历史上下文） */
      setModTab(urlTab);
    } else {
      const ctx = getReturnContext();
      if (restore && ctx && ctx.projectId === id) {
        if (ctx.tab) setModTab(ctx.tab);
      }
    }
    return () => {
      if (ctxRef.current.id) {
        saveReturnContext({
          projectId: ctxRef.current.id,
          projectTitle: ctxRef.current.title,
          tab: ctxRef.current.tab,
          scrollY: window.scrollY,
        });
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  /* restore=1 且数据加载完成后：恢复离开时的滚动位置（一次） */
  const restoreScrollRef = useRef(searchParams.get('restore') === '1');
  useEffect(() => {
    if (loading || !restoreScrollRef.current || !id) return;
    restoreScrollRef.current = false;
    const ctx = getReturnContext();
    const y = ctx?.projectId === id ? (ctx.scrollY ?? 0) : 0;
    requestAnimationFrame(() => window.scrollTo({ top: y }));
    clearReturnContext();
  }, [loading, id]);
  /* ===== 全局单任务排它锁 =====
   * 同一活动同一时间只允许一个 AI 生成任务（首轮/普通对话/方向/方案/文案/生图统一管理）。
   * aiTask 为文本生成任务（组件内状态）；sceneBusy 由持久化 genTask 派生（切页/刷新仍在）。
   * 任务进行中：全部生成入口与消息发送禁用、显示当前任务，允许阅读切页与编辑草稿。 */
  const [aiTask, setAiTask] = useState<{ label: string } | null>(null);
  const sceneBusy = data?.scene?.genTask?.status === 'querying';
  const taskLocked = !!aiTask || sceneBusy;
  const taskLabel = aiTask?.label ?? '布置效果图生成中…';
  const beginTask = useCallback((label: string) => setAiTask({ label }), []);
  const endTask = useCallback(() => setAiTask(null), []);
  /* 生图任务提交中（防快速连点重复提交生图任务） */
  const sceneSubmittingRef = useRef(false);

  /* 顶部「最近活动」切换列表 */
  const [recentProjects, setRecentProjects] = useState<Array<{ id: string; title: string }>>([]);
  useEffect(() => {
    if (!authReady || !userId) return;
    /* 与项目主数据加载并行：不阻塞首屏渲染（原本串行等待，拖慢进入速度） */
    void listProjects(5)
      .then((rows) => setRecentProjects(rows.map((r) => ({ id: r.id, title: r.title }))))
      .catch(() => undefined);
  }, [authReady, userId, id]);

  /* 成果预览：默认当前工作区宽弹窗（iframe 同源加载预览页 embed 模式；关闭后本页状态零丢失） */
  const [previewOpen, setPreviewOpen] = useState(false);

  /* 新建进入标记（一次性消费）：仅创建后首次进入允许首条消息自动回应 */
  const [freshEnter] = useState(() => {
    try {
      if (sessionStorage.getItem('sf-fresh-workbench') === id) {
        sessionStorage.removeItem('sf-fresh-workbench');
        return true;
      }
    } catch {
      /* sessionStorage 不可用时按刷新处理，不自动响应 */
    }
    return false;
  });

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirtyRef = useRef(false);

  /* ---------- 加载 ---------- */
  useEffect(() => {
    if (!authReady || !userId || !id) return;
    let cancelled = false;
    (async () => {
      /* 新建直通：创建页刚写入的项目数据经 sessionStorage 一次性带回（读取即删），
       * 免二次网络往返，进入工作区立即渲染；读取失败/不匹配时走正常加载 */
      try {
        const raw = sessionStorage.getItem('sf-fresh-data');
        if (raw) {
          sessionStorage.removeItem('sf-fresh-data');
          const fd = JSON.parse(raw) as { id: string; title: string; data: ProjectData };
          if (fd.id === id && fd.data) {
            setTitle(fd.title);
            setData(repairSceneData({ ...normalizeListIds(fd.data), id }));
            setSaveState('saved');
            setSavedAt('刚创建');
            setLoading(false);
            /* 幂等保险：后台静默对账一次（不阻塞渲染，仅校数据一致） */
            void getProject(id)
              .then((row) => {
                if (!row) return;
                const serverTs = new Date(row.updateTime).getTime();
                /* 本地无草稿且服务端版本新于直通写入（期间他端编辑）才覆盖 */
                const draft = userId ? getDraft(userId, id) : null;
                if (!draft && Date.now() > serverTs + 2000) {
                  setTitle(row.title);
                  setData(repairSceneData({ ...normalizeListIds(row.data), id }));
                }
              })
              .catch(() => undefined);
            return;
          }
        }
      } catch {
        /* 直通数据异常 → 正常网络加载 */
      }
      try {
        const row = await getProject(id);
        if (cancelled) return;
        if (!row) {
          setNotFound(true);
        } else {
          /* 本地草稿恢复：仅当草稿比服务端版本新时使用（不无条件覆盖），恢复后标记待同步并自动重发保存 */
          const draft = userId ? getDraft(userId, id) : null;
          const serverTs = new Date(row.updateTime).getTime();
          if (draft && draft.ts > serverTs) {
            setTitle(draft.title);
            /* 加载边界补列表稳定唯一 id（旧数据缺失/重复 id 的编辑串改修复；保留有效旧 id 与字段顺序） */
            setData(repairSceneData({ ...normalizeListIds(draft.data), id }));
            setSaveState('pending');
            setSavedAt('待同步');
            void persist(draft.title, normalizeListIds(draft.data));
          } else {
            if (draft && userId) clearDraft(userId, id);
            setTitle(row.title);
            setData(repairSceneData({ ...normalizeListIds(row.data), id }));
            setSaveState('saved');
            setSavedAt('刚载入');
          }
        }
      } catch (e) {
        console.error(e);
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authReady, userId, id]);

  /* ---------- 编辑 + debounce 自动保存（串行队列：并发 PATCH 可能旧响应覆盖新数据，必须顺序落库） ---------- */
  const persistQueueRef = useRef<{ t: string; d: ProjectData } | null>(null);
  const persistingRef = useRef(false);
  /* 最新快照 ref：冲刷/离开必须取最新 data，禁止用渲染闭包旧快照（曾因此越线直写覆盖刚保存的 AI 回复） */
  const dataRef = useRef<ProjectData | null>(null);
  const titleRef = useRef('');
  useEffect(() => {
    dataRef.current = data;
    titleRef.current = title;
  }, [data, title]);
  const persist = useCallback(
    async (t: string, d: ProjectData): Promise<boolean> => {
      if (!id || !userId) return false;
      /* 请求未确认成功前先落本地草稿（按用户/项目隔离）：刷新后可恢复，防网络中断丢最后编辑 */
      saveDraft(userId, id, t, d);
      persistQueueRef.current = { t, d };
      if (persistingRef.current) {
        /* 有请求在飞：等待队列处理到本份并完成再返回（确认类写入需要真实结果；失败队列会保留待写项 → false） */
        const deadline = Date.now() + 15000;
        await new Promise<void>((resolve) => {
          const check = () => {
            if (!persistingRef.current || Date.now() > deadline) resolve();
            else setTimeout(check, 80);
          };
          setTimeout(check, 80);
        });
        return !persistQueueRef.current;
      }
      persistingRef.current = true;
      let ok = true;
      try {
        while (persistQueueRef.current) {
          const job = persistQueueRef.current;
          persistQueueRef.current = null;
          setSaveState('saving');
          try {
            await updateProject(id, { title: job.t, data: job.d });
            setSaveState('saved');
            setSavedAt(new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }));
            dirtyRef.current = false;
            clearDraft(userId, id);
          } catch (e) {
            /* 失败即停队列：保留草稿与待写状态，用户可重试（persist 再入队即可） */
            console.error(e);
            setSaveState('error');
            ok = false;
            break;
          }
        }
      } finally {
        persistingRef.current = false;
      }
      return ok;
    },
    [id, userId]
  );

  const scheduleSave = useCallback(
    (t: string, d: ProjectData) => {
      dirtyRef.current = true;
      /* 每次编辑立即写本地草稿：防抖窗口内刷新/关闭时草稿仍在，刷新后可恢复 */
      if (userId && id) saveDraft(userId, id, t, d);
      /* 任何编辑立即显示「保存中」：不等待防抖到期才反馈，避免长时间打字时顶栏停留在旧状态 */
      setSaveState((s) => (s === 'error' ? s : 'saving'));
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => persist(t, d), 800);
    },
    [persist, userId, id]
  );

  const patch = useCallback(
    (partial: Partial<ProjectData>) => {
      setData((prev) => {
        if (!prev) return prev;
        const next = { ...prev, ...partial };
        scheduleSave(title, next);
        return next;
      });
    },
    [title, scheduleSave]
  );

  /** 关键变更（消息追加/更新、场景滑块位置）立即落库，不走 800ms 防抖：
   *  防抖窗口内刷新时 beforeunload 的异步保存会被浏览器取消，导致消息与滑块位置丢失 */
  const patchNow = useCallback(
    (partial: Partial<ProjectData>) => {
      setData((prev) => {
        if (!prev) return prev;
        const next = { ...prev, ...partial };
        if (saveTimer.current) clearTimeout(saveTimer.current);
        void persist(title, next);
        return next;
      });
    },
    [title, persist]
  );

  /* 全部收起状态持久化（跳过初始恢复渲染） */
  const allCollapsedInit = useRef(allCollapsed);
  useEffect(() => {
    if (allCollapsedInit.current === allCollapsed) return;
    allCollapsedInit.current = allCollapsed;
    setData((prev) => {
      if (!prev) return prev;
      const next = { ...prev, ui: { ...prev.ui, allCollapsed } };
      void persist(title, next);
      return next;
    });
  }, [allCollapsed, persist, title]);

  const onTitleChange = (v: string) => {
    setTitle(v);
    if (data) scheduleSave(v, data);
  };

  /* ---------- 离开前保存 ----------
   *  冲刷必须走唯一串行队列 persist（先写草稿再顺序落库），严禁绕过队列直写 updateProject：
   *  旧实现 deps 含 data，每次消息追加/建议回写触发重订阅时 cleanup 都会跑 flush——
   *  它一边 clearTimeout 杀掉待发的全量保存，一边用上一渲染的旧闭包 data（不含刚完成的 AI 回复）
   *  越线直写，与队列全量 PATCH 竞速，后落地者覆盖（9d3cb00e / 13586b91 首轮回复丢失根因）。
   *  现 deps 固定（仅 id/userId/persist），cleanup 只在真正离开页面时执行，且一律取 ref 最新快照入队。 */
  useEffect(() => {
    const flush = () => {
      if (!dirtyRef.current || !id || !userId || !dataRef.current) return;
      void persist(titleRef.current, dataRef.current);
    };
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      flush();
    };
  }, [id, userId, persist]);

  /* 函数式更新：连续追加消息时基于最新 state，避免闭包快照相互覆盖；消息属关键数据立即落库 */
  const appendChat = useCallback(
    /* patchFor：给既有消息原地打补丁（如响应完成后给写入成果的消息挂标签），不新增消息 */
    (msg: ChatMessage, patchFor?: { id: string; patch: Partial<ChatMessage> }) => {
      setData((prev) => {
        if (!prev) return prev;
        const list = prev.chatLog ?? [];
        if (patchFor) {
          const idx = list.findIndex((m) => m.id === patchFor.id);
          if (idx < 0) return prev;
          const nextList = [...list];
          nextList[idx] = { ...nextList[idx], ...patchFor.patch };
          const next = { ...prev, chatLog: nextList };
          if (saveTimer.current) clearTimeout(saveTimer.current);
          void persist(title, next);
          return next;
        }
        const next = { ...prev, chatLog: [...list, msg] };
        if (saveTimer.current) clearTimeout(saveTimer.current);
        void persist(title, next);
        return next;
      });
    },
    [title, persist]
  );

  /** 基于 prev 的 chatLog 定点更新（会话生成入口专用）：并发链路里闭包 data.chatLog 是旧快照，
   * 直接 patch 会抹掉刚 append 的用户原文；函数式读取 prev 保证一条真实用户请求不丢失、不重复 */
  const patchChat = useCallback(
    (fn: (log: ChatMessage[]) => ChatMessage[]): void => {
      setData((prev) => {
        if (!prev) return prev;
        const nextLog = fn(prev.chatLog ?? []);
        if (nextLog === (prev.chatLog ?? [])) return prev;
        const next = { ...prev, chatLog: nextLog };
        if (saveTimer.current) clearTimeout(saveTimer.current);
        void persist(title, next);
        return next;
      });
    },
    [title, persist]
  );

  /* 首次进入空会话：插入固定欢迎消息（不调模型；插入后 chatLog 非空，刷新/重开不重复） */
  const welcomedRef = useRef(false);
  useEffect(() => {
    if (!data || welcomedRef.current) return;
    welcomedRef.current = true;
    if ((data.chatLog ?? []).length === 0) {
      /* AI 角色「小灵」：固定欢迎消息嵌入角色自报家门与核心能力自我介绍 */
      const nick = profile?.nickname?.trim();
      const hi = nick ? `${nick}，你好呀` : '你好呀';
      appendChat({
        id: `a-welcome-${Date.now()}`,
        role: 'assistant',
        content: `${hi}！我是小灵，可以陪你一起想活动方向、把想法整理成完整方案、排流程管预算、写邀请函文案，也能根据场地照片生成布置效果图～想办什么活动，或者哪里还拿不定主意？细节没想好也没关系，先说说你的想法，我给你一点灵感看看。`,
        ts: Date.now(),
      });
    }
  }, [data, appendChat, profile?.nickname]);

  /* 就地更新一条消息（图像识别结果回写 chatLog 并持久化），同样立即落库 */
  const updateChat = useCallback(
    (id: string, patch: Partial<ChatMessage>) => {
      setData((prev) => {
        if (!prev) return prev;
        const next = {
          ...prev,
          chatLog: (prev.chatLog ?? []).map((m) => (m.id === id ? { ...m, ...patch } : m)),
        };
        if (saveTimer.current) clearTimeout(saveTimer.current);
        void persist(title, next);
        return next;
      });
    },
    [title, persist]
  );

  /* 用户明确条件 → 写入需求摘要（程序确定性提取；区分硬上限与参考估价；已确认的既有决定不静默覆盖，改走调整确认） */
  const syncConditions = useCallback(
    (facts: {
      fields: string[];
      headcount: string | null;
      budgetLimit: number | null;
      budgetKind?: 'hard' | 'reference' | null;
      otherNeeds: string | null;
      region?: string | null;
      date?: string | null;
      duration?: string | null;
    }): string[] => {
      if (!data) return [];
      const r = data.requirements ?? {};
      const nextReq = { ...r };
      const written: string[] = [];
      const put = (key: 'headcount' | 'region' | 'date' | 'budget', value: string, source: ReqSource) => {
        const cur = nextReq[key];
        /* 已确认的不同值不静默覆盖（防聊天复述盖掉手填成果）；相同值不重复写 */
        if (cur && cur.value === value && cur.source !== 'undecided') return;
        if (cur && cur.source === 'confirmed' && cur.value !== value) return;
        nextReq[key] = { value, source };
        written.push(key);
      };
      if (facts.headcount) put('headcount', facts.headcount, 'confirmed');
      /* 城市/时间：用户原文保留（「下周」等相对时间保持原意，不静默确定具体日期） */
      if (facts.region) put('region', facts.region, 'confirmed');
      if (facts.date) put('date', facts.date, 'confirmed');
      let hardLimit: number | null = null;
      /* 0 是有效硬上限（免费）：用 != null 判定，不用真假（0 会被吞） */
      if (facts.budgetLimit != null) {
        if (facts.budgetKind === 'reference') {
          /* 参考估价：只记入摘要建议，不设硬上限、不动费用上限 */
          put('budget', `参考约 ${facts.budgetLimit.toLocaleString('zh-CN')} 元`, 'ai');
        } else {
          put('budget', `${facts.budgetLimit.toLocaleString('zh-CN')} 元以内`, 'confirmed');
          hardLimit = facts.budgetLimit; /* 明确上限才同步费用上限 */
        }
      }
      /* 明确时长并入其他需求携带（后续方案生成与时长校验的同一数据源）；已含同值不重复 */
      const durToMerge = facts.duration && !(nextReq.otherNeeds ?? '').includes(facts.duration) ? facts.duration : null;
      const needsInput = [facts.otherNeeds, durToMerge].filter((x): x is string => !!x && x.trim() !== '').join('；') || null;
      /* 其他需求：与用户已手填内容合并去重，不覆盖用户自己的表述 */
      if (needsInput) {
        const factsOther = { otherNeeds: needsInput };
        const existing = (nextReq.otherNeeds ?? '').trim();
        if (!existing) {
          nextReq.otherNeeds = needsInput;
          if (!written.includes('otherNeeds')) written.push('otherNeeds');
        } else if (!existing.includes(needsInput)) {
          nextReq.otherNeeds = `${existing}；${needsInput}`;
          if (!written.includes('otherNeeds')) written.push('otherNeeds');
        }
      }
      if (written.length === 0) return []; /* 无实际变更不写库、不伪造同步反馈 */
      /* 关键修复：函数式合并写入，绝不整表回写——此前此处用闭包旧快照 setData(next) 整表覆盖，
       * 会把 send() 刚追加的用户消息从状态与已保存库中一并抹掉（AI 回复在后续增量追加所以幸存，
       * 表现为「AI 正常回复、摘要已写入、用户消息消失且刷新不恢复」）；requirements/budget 合并进最新 prev，
       * chatLog 等其余字段原样保留 */
      patchNow({
        requirements: nextReq,
        /* 硬上限=0（免费）也同步；null=无上限不同步。防「0元以内」残留旧上限 */
      ...(hardLimit != null ? { budget: { ...(data.budget ?? { items: [] }), limit: hardLimit } } : {}),
      });
      return written;
    },
    [data, patchNow]
  );

  /* 对话明确请求单独生成文案：复用文案按钮同一流程（任务锁/待确认草稿/内容概述共用），不动方案其余部分 */
  const handleCopiesFromChat = useCallback(
    (_text: string): boolean => {
      /* 重新发起同任务：旧失败消息的重试入口标记失效（防止成功后再点旧入口重复执行） */
      /* 标记旧失败重试入口失效：基于 prev 的函数式更新——并发时闭包快照不含刚 append 的用户原文，
       * 直接覆盖会把本次用户消息抹掉（忙碌期间/完成后/刷新后都看不到原文） */
      patchChat((log) =>
        log.some((m) => m.retryAction && !m.retryAction.resolved && m.retryAction.kind === 'copies')
          ? log.map((m) => (m.retryAction && !m.retryAction.resolved && m.retryAction.kind === 'copies' ? { ...m, retryAction: { ...m.retryAction, resolved: true } } : m))
          : log
      );
      if (aiTask) {
        toast.info('当前有 AI 任务进行中，请稍候再生成文案～');
        return true;
      }
      setModTab('plan');
      setAiPanel(true);
      setCopiesSignal((v) => ({ seq: (v?.seq ?? 0) + 1, viaChat: true }));
      return true;
    },
    [aiTask, patchChat]
  );

  /* 同步标签「查看」→ 切到活动方案页签（桌面先展开成果栏）并滚动到需求摘要 */
  const openRequirements = useCallback(() => {
    setModTab('plan');
    setAiPanel(true);
    setTimeout(() => document.getElementById('req-summary-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 120);
  }, []);
  /* 对话「生成布置效果」→ 切到场景页签并滚到布置要求（用户确认才生图） */
  const openSceneFromChat = useCallback(() => {
    /* 事件处理守卫：与按钮外观/aria 同一忙碌状态（防键盘或辅助技术绕过 disabled） */
    if (taskLocked) {
      toast.info(`${taskLabel ?? 'AI 任务'}进行中，请稍后再生成布置效果`);
      return;
    }
    setModTab('scene');
    setAiPanel(true);
    setSceneSignal((v) => v + 1);
  }, [taskLocked, taskLabel]);

  /** 场景布置上传弹窗确认后：将照片与诉求发送给 AI 伙伴并跳转开启对话 */
  const uploadSceneOnly = useCallback(
    (imageUrl: string, note?: string) => {
      if (!data) return;
      /* 仅更新当前活动场地原图/布置说明：不发送 AI 消息、不展开面板、不创建活动；
       * 旧效果图保留（对应旧原图，由 lastReq.beforeUrl 标记关联，展示层提示），不冒充新原图的对比结果 */
      patchNow({
        scene: {
          ...data.scene,
          beforeUrl: imageUrl,
          isExample: false,
          notes: note?.trim() || data.scene?.notes,
        },
      });
      toast.success('场地照片已更新；旧效果图已保留（对应原场地），需要时可重新生成布置效果图');
    },
    [data, patchNow]
  );

  /** AI 策划伙伴在对话中直接唤起场地布置生图（与「生成布置效果图」按钮同源共用同一流程） */
  const triggerSceneFromAi = useCallback(
    async (opts?: { density?: 'simple' | 'medium' | 'rich'; tags?: string[]; extra?: string; style?: string }) => {
      if (!data) return { ok: false, message: '项目未就绪' };
      /* 全局任务锁：文本生成进行中不允许同时生图（同一活动同一时间只允许一个 AI 任务） */
      if (aiTask) return { ok: false, busy: true, message: '当前有 AI 任务进行中，请稍候再生成布置图…' };
      if (!data.scene?.beforeUrl) {
        return { ok: false, needsBefore: true, message: '缺少场地原图' };
      }
      if (data.scene.genTask?.status === 'querying') {
        return { ok: false, busy: true, message: '布置效果图正在生成中，请稍候片刻…' };
      }
      /* 提交中防重入：快速连点只提交一次 */
      if (sceneSubmittingRef.current) {
        return { ok: false, busy: true, message: '正在提交生成任务，请稍候…' };
      }
      sceneSubmittingRef.current = true;
      try {
        const { taskId, prompt } = await submitSceneGeneration(data, opts);
        /* 任务与要求快照绑定当时原图：晚到结果据此判定是否作废 */
        const snap: NonNullable<SceneState['genTask']> = {
          taskId,
          status: 'querying',
          prompt,
          beforeUrl: data.scene.beforeUrl,
          style: opts?.style || (data.requirements?.visualTheme?.value as string) || data.scene.style || '现代温馨',
          tags: opts?.tags ?? data.scene.tags,
          density: opts?.density ?? data.scene.density ?? 'medium',
          extra: opts?.extra ?? data.scene.extra,
          submittedAt: Date.now(),
        };
        patchNow({ scene: { ...data.scene, genTask: snap } });
        /* 任务启动确认消息单点写入（对话触发与场景卡按钮共用同一路径）：末条为 assistant，
         * 刷新/切页回来不误报「回复未完成」，也不诱导重复触发生图 */
        appendChat({
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: `收到！我正在依据当前场地原图与已确认的布置要求生成效果图（约需 1–2 分钟）。\n\n我会严格保留场地原有的建筑结构与门窗透视，仅布置可移动软装。生成期间你可以自由阅读或切换页面，任务进度会自动恢复；完成后我会在对话中直接呈现对比效果。`,
          ts: Date.now(),
        });
        return { ok: true, taskId };
      } catch (e) {
        return { ok: false, message: e instanceof Error ? e.message : '提交生成失败，请重试' };
      } finally {
        sceneSubmittingRef.current = false;
      }
    },
    [data, patchNow, aiTask, appendChat]
  );

  /** 成果更新标签「查看」入口：切到对应成果页签并确保可见；移动端先收起 AI 抽屉，并用 toast 明确反馈成果位置 */
  const openModuleTab = useCallback(
    (module: 'plan' | 'scene' | 'budget', focusKey?: string) => {
      setModTab(module);
      setAiPanel(true);
      setAiOpen(false);
      setFreshTabs((prev) => prev.filter((m) => m !== module));
      /* 展开目标模块的全部卡片（此前仅切页签：卡片全收起时目标内容仍不可见）；
       * 关键：必须同时解除全局收起 allCollapsed（卡片 open = !(allCollapsed || collapsed[k])，
       * 只清明细不清全局时全部卡片仍处于折叠——这就是「定位后目标卡仍折叠」的根因） */
      setAllCollapsed(false);
      const SECTIONS: Record<'plan' | 'scene' | 'budget', string[]> = {
        plan: ['directions', 'theme', 'schedule', 'copies'],
        scene: ['venue', 'reqs', 'effect'],
        budget: ['budget', 'materials', 'refs', 'tasks'],
      };
      const ui = data?.ui;
      const collapsed = { ...(ui?.collapsed ?? {}) };
      let opened = false;
      for (const k of SECTIONS[module]) {
        if (collapsed[k]) {
          collapsed[k] = false;
          opened = true;
        }
      }
      if ((opened || ui?.allCollapsed) && data) patchNow({ ui: { ...ui, collapsed, allCollapsed: false } });
      const names = { plan: '活动方案', scene: '场景布置', budget: '预算与准备' } as const;
      const where = window.innerWidth < 768 ? '下方成果区' : '右侧成果栏';
      toast.success(`已为你打开${where}「${names[module]}」`);
      /* 待页签内容渲染后滚动定位到模块区（不止滚到面板顶部） */
      /* 卡片/字段级定位：优先滚动到目标卡锚点（sf-sec-*），无指定时滚到模块区 */
      requestAnimationFrame(() => {
        const el: HTMLElement | null =
          (focusKey
            ? (document.getElementById(focusKey.startsWith('sf-') ? focusKey : `sf-sec-${focusKey}`) ??
              document.getElementById(focusKey))
            : null) ?? document.getElementById(`mod-${module}`);
        el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    },
    [data, patchNow]
  );

  /* 预览弹窗（iframe embed）内的「去处理」：校验来源与活动 ID 后关闭预览并回到本工作区定位目标，
   * 不在 iframe 内再加载第二套工作区；独立预览页（非 embed）仍走页面跳转 */
  useEffect(() => {
    const fn = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      const msg = e.data as { type?: string; projectId?: string; tab?: string; field?: string } | null;
      if (!msg || msg.type !== 'sf-locate' || !msg.projectId || msg.projectId !== id) return;
      setPreviewOpen(false);
      if (msg.field === 'requirements') {
        /* 未知条件（人数/地区/日期/预算等）入口：切到活动方案并直接打开「全部字段」编辑弹窗，
         * 焦点定位第一个未确定项（可留空保存、可关闭跳过，不强迫填写） */
        setModTab('plan');
        setAiPanel(true);
        setReqEditSignal((v) => v + 1);
        return;
      }
      if (msg.tab === 'plan' || msg.tab === 'scene' || msg.tab === 'budget') openModuleTab(msg.tab, msg.field);
    };
    window.addEventListener('message', fn);
    return () => window.removeEventListener('message', fn);
  }, [id, openModuleTab, openRequirements]);

  /** 对话中明确请求生成完整方案：与右侧按钮同一能力/条件/任务锁/保存流程；
   * 无候选方向时在会话中说明并引导，有方向则交给方案模块（选择与生成分离，未要求不自动生成） */
  const handleSchemeFromChat = useCallback(
    (_text: string): boolean => {
      if (!data) return false;
      /* 重新发起同任务：旧失败消息的重试入口标记失效（防止成功后再点旧入口重复执行） */
      /* 同上：函数式更新防止抹掉刚 append 的用户原文 */
      patchChat((log) =>
        log.some((m) => m.retryAction && !m.retryAction.resolved && m.retryAction.kind === 'scheme')
          ? log.map((m) => (m.retryAction && !m.retryAction.resolved && m.retryAction.kind === 'scheme' ? { ...m, retryAction: { ...m.retryAction, resolved: true } } : m))
          : log
      );

      if (aiTask) {
        toast.info('当前有 AI 任务进行中，请稍候再生成方案～');
        return true;
      }
      const dirs = data.directions ?? [];
      const selected = dirs.find((d) => d.id === data.selectedDirectionId);
      /* 未选方向：单条明确反馈（方向为空→推荐方式；已有候选→直接去选），同一请求不再产生第二份回复 */
      if (!selected) {
        appendChat({
          id: `a-${Date.now()}`,
          role: 'assistant',
          content:
            dirs.length > 0
              ? `候选方向已经有 ${dirs.length} 个啦，先在「活动方案 → 候选方向」里点选一个，我马上按它整理完整方案（主题、流程、预算、物料、任务、文案都会生成）。`
              : '整理完整方案前需要先定一个大方向～\n\n你可以告诉我活动想要的风格或重点（比如「轻松聊天为主」「想要互动游戏」），我来推荐几个候选方向；选好后再让我按该方向整理完整方案。',
          ts: Date.now(),
        });
        return true;
      }
      /* 已有方案时等待覆盖确认属正常待确认状态（非中断）：先给一条自然的 AI 过程说明，
       * 会话末条保持 assistant，不触发「回复未完成」误报；取消亦有正常结束反馈 */
      const hasScheme = (data.schedule?.length ?? 0) > 0;
      if (hasScheme) {
        appendChat({
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: `收到！按「${selected.name}」重新生成前，先确认整套替换范围——上面弹出了覆盖确认：确认后我开始重写全部内容（主题、流程、预算、物料、任务、文案，含手动修改都会替换）；取消则现有方案原样保留，不算失败也不会重复生成。`,
          ts: Date.now(),
        });
      }
      setSchemeSignal((v) => ({ seq: (v?.seq ?? 0) + 1, viaChat: true }));
      return true;
    },
    [data, aiTask, appendChat, patch]
  );

  /** 对话中明确请求只改主题（主题名/口号/亮点）：走主题模块同一草稿链路——
   * 新主题先作为待确认草稿进入会话，用户确认后才替换主题字段，取消保留旧主题；
   * 其余模块（流程/预算/物料/任务/文案）一律不动；讨论类主题建议不进此分发 */
  const handleThemeFromChat = useCallback(
    (text: string): boolean => {
      if (!data) return false;
      /* 重新发起同任务：旧失败消息的重试入口标记失效（防止成功后再点旧入口重复执行） */
      /* 同上：函数式更新防止抹掉刚 append 的用户原文 */
      patchChat((log) =>
        log.some((m) => m.retryAction && !m.retryAction.resolved && m.retryAction.kind === 'theme')
          ? log.map((m) => (m.retryAction && !m.retryAction.resolved && m.retryAction.kind === 'theme' ? { ...m, retryAction: { ...m.retryAction, resolved: true } } : m))
          : log
      );

      if (aiTask) {
        toast.info('当前有 AI 任务进行中，请稍候再生成主题～');
        return true;
      }
      /* 用户原文随信号传递：主题生成据此采用用户选中的那组内容（名称/口号/亮点），不再另行创作 */
      setThemeSignal((v) => ({ seq: (v?.seq ?? 0) + 1, viaChat: true, text }));
      return true;
    },
    [aiTask, patchChat]
  );

  /** 调整建议卡确认：只写入本次受影响内容（精准合并，不整套重写）；
   * 涉及布置要求变更时旧效果图保留并标记 stale（对应调整前要求），不自动生图；
   * 返回成功状态与更新到的模块，失败项由调用方提示 */
  /* ---- 调整卡写入辅助（组件内纯函数，闭包无状态） ---- */
  /** 旧配色冲突清理：旧色词→新色词逐词一一映射替换（不再全部替换成同一个主词），
   * 再折叠相邻重复（防「浅蓝与浅蓝」），只动颜色词不重写整句 */
  const OLD_COLOR_WORDS = ['海盐蓝', '克莱因蓝', '雾霾蓝', '藏蓝', '宝蓝', '天蓝', '浅蓝', '深蓝', '蓝色系', '蓝调', '薄荷绿', '牛油果绿', '墨绿', '绿色系', '香槟金', '金色系', '珊瑚粉', '粉色系', '紫色系', '酒红', '红色系', '暖橙', '橙色系', '奶油白', '米白', '纯白', '月白', '黑色系', '高级灰'];
  const syncColorWords = (
    src: { theme?: ProjectData['theme']; copies?: ProjectData['copies']; scene?: ProjectData['scene'] },
    newColor: string
  ): { theme: ProjectData['theme']; copies: ProjectData['copies']; scene: ProjectData['scene'] } => {
    const newWords = newColor
      .split(/[与和/、,，\s]+/)
      .map((x) => x.trim())
      .filter((x) => x.length >= 2);
    /* 找出正文中实际出现的旧色词（按词表顺序），与新旧词按出现顺序一一映射 */
    const replaceIn = (text: string): string => {
      if (newWords.length === 0) return text;
      const found = OLD_COLOR_WORDS.filter((w) => text.includes(w) && !newColor.includes(w));
      if (found.length === 0) return text;
      let out = text;
      found.forEach((w, i) => {
        const to = newWords[i % newWords.length];
        out = out.split(w).join(to);
      });
      /* 折叠替换产生的相邻重复（如「浅蓝与浅蓝」→「浅蓝」） */
      for (const w of new Set(newWords)) {
        out = out.replace(new RegExp(`${w}\\s*[与和、]\\s*${w}`, 'g'), w);
      }
      return out;
    };
    let theme = src.theme;
    if (theme?.highlights) {
      const hl = theme.highlights.map((h) => (typeof h === 'string' ? replaceIn(h) : h));
      if (hl.some((h, i) => h !== theme?.highlights?.[i])) theme = { ...theme, highlights: hl };
    }
    /* 场景主题（scene.style）同步替换同款旧色词：配色调整「视觉风格/活动亮点/场景主题」三处一次落地；
     * scene.extra（布置补充说明）不自动扩展——除非用户本次点名范围包含场景模块外的明确要求 */
    let scene = src.scene;
    if (scene && typeof scene.style === 'string' && scene.style) {
      const v = replaceIn(scene.style);
      if (v !== scene.style) scene = { ...scene, style: v };
    }
    let copies = src.copies;
    if (copies) {
      const next: typeof copies = { ...copies };
      let touched = false;
      if (typeof copies.invite === 'string' && copies.invite) {
        const v = replaceIn(copies.invite);
        if (v !== copies.invite) { next.invite = v; touched = true; }
      }
      if (typeof copies.hosting === 'string' && copies.hosting) {
        const v = replaceIn(copies.hosting);
        if (v !== copies.hosting) { next.hosting = v; touched = true; }
      }
      if (Array.isArray(copies.onsite)) {
        const arr = copies.onsite.map((x) => (typeof x === 'string' ? replaceIn(x) : x));
        if (arr.some((x, i) => x !== copies?.onsite?.[i])) { next.onsite = arr; touched = true; }
      }
      if (touched) copies = next;
    }
    return { theme, copies, scene };
  };
  /** 未完成字段清单：本次应处理但没落地的部分（重试只跑这些；已落地的不重复执行） */
  const collectUndone = (
    plan: AdjustCard['plan'],
    failed: string[],
    modules: Array<'plan' | 'scene' | 'budget'>
  ): string[] => {
    const undone: string[] = [];
    const failedSome = (kw: string) => failed.some((f) => f.includes(kw));
    if ((plan.schedulePatch || plan.scheduleAdd || plan.scheduleRemoveNames) && failedSome('环节')) undone.push('schedule');
    if ((plan.budgetRemoveNames || plan.budgetAdd) && failedSome('费用项')) undone.push('budget');
    if ((plan.materialsAdd || plan.materialsRemoveNames) && failedSome('物料')) undone.push('materials');
    /* 无任何模块落地且 plan 有内容：全部未完成 */
    if (modules.length === 0) {
      if (plan.visualTheme) undone.push('visualTheme');
      if (plan.theme) undone.push('theme');
      if (plan.schedulePatch || plan.scheduleAdd || plan.scheduleRemoveNames) undone.push('schedule');
      if (plan.budgetAdd || plan.budgetRemoveNames) undone.push('budget');
      if (plan.materialsAdd || plan.materialsRemoveNames) undone.push('materials');
      if (plan.sceneTags || plan.sceneStyle !== undefined || plan.sceneExtra !== undefined) undone.push('scene');
    }
    return [...new Set(undone)];
  };
  /** 范围校验：用户明确「只改 X，其余不变」时，补丁越界模块整体拒绝（不静默改已确认范围） */
  const SCOPE_LABEL: Record<ScopeModule, string> = {
    schedule: '流程',
    budget: '费用',
    materials: '物料',
    scene: '布置要求',
    theme: '主题',
    visualTheme: '配色',
    conditions: '条件',
    copies: '文案',
    tasks: '任务',
  };

  /** 调整建议卡确认：写入前逐字段校验（格式异常保留原数据并记失败，绝不写入致崩数据）；
   * undoneFields 重试时只处理未完成字段，已应用项不重复执行；
   * 取消布置元素时级联清理相关流程/费用/物料；配色变更同步清理旧配色冲突文案 */
  const applyAdjust = useCallback(
    async (
      card: AdjustCard
    ): Promise<{ ok: boolean; modules: Array<'plan' | 'scene' | 'budget'>; failed?: string[]; undoneFields?: string[] }> => {
      if (!data) return { ok: false, modules: [], failed: ['数据未加载'] };
      /* 幂等：已应用且无未完成项不可重复执行；「应用中」不再持久化（刷新后按实际数据判定），无双击风险由会话内锁守卫 */
      if (card.status === 'applied' && !(card.undoneFields && card.undoneFields.length > 0)) {
        return { ok: false, modules: [], failed: ['该建议已应用，无需重复确认'] };
      }
      const planEarly = card.plan ?? {};
      /* 已应用幂等识别（恢复判定先于旧值冲突守卫）：上次保存被中断后（卡片仍待确认/应用中/失败）
       * 成果其实已写入——目标值已落地且点名同步域内无旧色词残留 → 直接收敛为完成状态，
       * 不重复写入、不把自己的写入结果误判为「等待期间被外部修改」。检查范围=用户本次点名的
       * 配色同步域（活动亮点/场景主题/文案），未点名模块（主题名/补充说明等）不在判定内 */
      const scopeEarly = extractScope(card.sourceText ?? '');
      if (
        typeof planEarly.visualTheme === 'string' &&
        planEarly.visualTheme.trim() &&
        (data.requirements?.visualTheme?.value ?? '') === planEarly.visualTheme.trim()
      ) {
        const noOld = (t?: string | null) => !OLD_COLOR_WORDS.some((w) => (t ?? '').includes(w) && !planEarly.visualTheme!.includes(w));
        const syncTheme = !scopeEarly.restricted || scopeEarly.allowed.includes('theme');
        const syncScene = !scopeEarly.restricted || scopeEarly.allowed.includes('scene');
        const syncCopies = !scopeEarly.restricted || scopeEarly.allowed.includes('copies');
        const allSettled =
          (!syncTheme || (data.theme?.highlights ?? []).every((h) => noOld(typeof h === 'string' ? h : ''))) &&
          (!syncScene || noOld(data.scene?.style)) &&
          (!syncCopies ||
            noOld(data.copies?.invite) ||
            noOld(data.copies?.hosting) ||
            (data.copies?.onsite ?? []).every((t) => noOld(typeof t === 'string' ? t : '')));
        if (allSettled && (card.status === 'pending' || card.status === 'failed' || card.status === 'editing' || card.status === 'applying')) {
          return { ok: true, modules: ['plan'] };
        }
      }
      const plan = card.plan ?? {};
      const retry = new Set(card.undoneFields ?? []);
      const want = (k: string) => retry.size === 0 || retry.has(k);
      const modules: Array<'plan' | 'scene' | 'budget'> = [];
      const failed: string[] = [];

      /* 目标字段白名单校验：用户本次点名的是活动主题成果（名称/口号/亮点），
       * 建议却把内容写进配色字段 → 阻止应用并明确报错——不靠卡片标题正确就放行，也不猜目标重新映射 */
      const srcText = card.sourceText ?? '';
      const wantsThemeFields = /主题名|主题名称|口号|标语|亮点/.test(srcText) && /(主题|应用|替换|采用|选择)/.test(srcText);
      const planOnlyVisual = plan.visualTheme !== undefined && !plan.theme && !plan.schedulePatch && !plan.scheduleAdd && !plan.budgetAdd && !plan.materialsAdd && !plan.sceneTags && plan.sceneStyle === undefined && plan.sceneExtra === undefined;
      if (wantsThemeFields && planOnlyVisual) {
        return {
          ok: false,
          modules: [],
          failed: [
            '本次要修改的是活动主题（名称/口号/亮点），但建议把主题内容写进了配色字段，已阻止应用（成果未变化）。请重新说明：把选中的主题名、口号和亮点应用到活动主题',
          ],
        };
      }

      /* 范围校验：用户明确「只改 X，其余不变」时，越界补丁整体拒绝，不改写已确认范围 */
      const scope = extractScope(card.sourceText ?? '');
      const planHas: Array<[ScopeModule, boolean]> = [
        ['schedule', !!(plan.schedulePatch || plan.scheduleAdd || plan.scheduleRemoveNames)],
        ['budget', !!(plan.budgetAdd || plan.budgetRemoveNames)],
        ['materials', !!(plan.materialsAdd || plan.materialsRemoveNames)],
        ['scene', !!(plan.sceneTags || plan.sceneStyle !== undefined || plan.sceneExtra !== undefined)],
        ['visualTheme', plan.visualTheme !== undefined],
        ['theme', !!plan.theme],
      ];
      if (scope.restricted) {
        const outOfScope = planHas.filter(([m, has]) => has && !scope.allowed.includes(m)).map(([m]) => SCOPE_LABEL[m]);
        if (outOfScope.length > 0) {
          return {
            ok: false,
            modules: [],
            failed: [
              `本次请求只涉及${scope.allowed.map((m) => SCOPE_LABEL[m]).join('、')}，但建议中包含${outOfScope.join('、')}的改动，已拒绝应用。如确实需要一并调整，请重新说明范围`,
            ],
          };
        }
        /* 反向缺失检查：用户点名要改的字段建议里没有变更数据 → 明确记未完成，不无声跳过、不声称完成。
         * visualTheme 配色同步域（活动亮点/场景主题/文案的颜色词随配色统一替换）不算缺失 */
        const SYNC_DOMAIN: ScopeModule[] = ['theme', 'scene', 'copies'];
        const missing = scope.allowed.filter(
          (m) => !planHas.some(([pm, has]) => pm === m && has) && !(plan.visualTheme !== undefined && SYNC_DOMAIN.includes(m))
        );
        if (missing.length > 0) {
          failed.push(`本次请求还涉及${missing.map((m) => SCOPE_LABEL[m]).join('、')}，但建议里没有这些字段的变更数据，已记为未完成`);
        }
      }
      /* 版本检查：等待期间用户手工改过目标 → 拒绝应用，不用旧建议覆盖新编辑 */
      const origFails = checkOrig(card, data);
      if (origFails.length > 0) return { ok: false, modules: [], failed: origFails };

      let req = data.requirements;
      let theme = data.theme;
      let schedule = data.schedule;
      let budget = data.budget;
      let materials = data.materials;
      let copies = data.copies;
      let scene = data.scene;

      /* 主题/视觉主题：只覆盖指定字段 */
      if (want('visualTheme') && typeof plan.visualTheme === 'string' && plan.visualTheme.trim()) {
        req = { ...req, visualTheme: { value: plan.visualTheme.trim(), source: 'confirmed' } };
        modules.push('plan');
        /* 旧配色冲突清理：旧色词→新色词逐词映射替换，只动颜色词不重写整段文案。
         * 同步范围=用户本次点名的模块（视觉风格/活动亮点/场景主题三处对应 theme.highlights 与 scene.style）；
         * 明确要求其他字段不动时不自动扩展到文案或场景补充说明（scene.extra），未限定范围时默认同步文案 */
        const syncTheme = !scope.restricted || scope.allowed.includes('theme');
        const syncScene = !scope.restricted || scope.allowed.includes('scene');
        const syncCopies = !scope.restricted || scope.allowed.includes('copies');
        const cleaned = syncColorWords(
          { ...(syncTheme ? { theme } : {}), ...(syncScene ? { scene } : {}), ...(syncCopies ? { copies } : {}) },
          plan.visualTheme.trim()
        );
        if (cleaned.theme !== theme || cleaned.copies !== copies || cleaned.scene !== scene) {
          theme = cleaned.theme;
          copies = cleaned.copies;
          scene = cleaned.scene;
        }
      }
      if (want('theme') && plan.theme) {
        /* 字段级：只写明确提供的字段；slogan 为 null/空串表示明确清空 */
        theme = {
          ...theme,
          ...(plan.theme.name ? { name: plan.theme.name } : {}),
          ...(plan.theme.slogan !== undefined ? { slogan: plan.theme.slogan ?? '' } : {}),
          ...(plan.theme.highlights ? { highlights: plan.theme.highlights } : {}),
        };
        modules.push('plan');
      }
      /* 流程：字段级补丁（按 id/名称定位，只改明确列出的字段，其余条目与字段原样保留，绝不整套替换） */
      if (want('schedule') && (plan.schedulePatch || plan.scheduleAdd || plan.scheduleRemoveNames)) {
        const raw = schedule ?? [];
        const cur = ensureIds(raw); /* 历史缺 ID 数据补齐一次并稳定保存（不每次生成新 id） */
        let next = cur;
        /* id 补齐单独算持久化数据（稳定落库），但不算「模块成功」——没有实际内容变更不能标已应用 */
        const idBackfilled = raw.some((it, i) => cur[i] !== it);
        let touched = false;
        if (plan.scheduleRemoveNames) {
          for (const name of plan.scheduleRemoveNames) {
            const hitIdx = next.findIndex((it) => normName(it.name) === normName(name));
            if (hitIdx >= 0) {
              next = next.filter((_, i) => i !== hitIdx);
              touched = true;
            } else if (retry.size === 0) {
              failed.push(`未找到「${name}」环节，未删除`);
            } /* 重试中找不到 = 前次已删成功，静默跳过 */
          }
        }
        if (plan.schedulePatch && plan.schedulePatch.length > 0) {
          const r = applySchedulePatch(next, plan.schedulePatch);
          if (r.next !== next) touched = true;
          next = r.next;
          failed.push(...r.failures);
        }
        if (plan.scheduleAdd) {
          for (const s of plan.scheduleAdd) {
            if (next.some((it) => normName(it.name) === normName(s.name))) continue; /* 同名不重复新增 */
            next = [
              ...next,
              {
                id: `adj-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
                name: s.name,
                time: normTime(s.time ?? ''),
                duration: s.duration ?? '',
                note: s.note ?? '',
              },
            ];
            touched = true;
          }
        }
        if (touched || idBackfilled) {
          schedule = next; /* 内容或 id 补齐任一变化都持久化 */
          if (touched) modules.push('plan'); /* 只有真实内容变更才计入已应用模块 */
        }
      }
      /* 预算：按规整名称（去#id后缀/分隔符，与 schedulePatch 同源）增删；删项须实况存在（无则记失败不虚构）；
       * 重试时已删成功的项自然不在清单中 → 不再误报「未找到」永卡未完成；新增同名幂等跳过 */
      const budgetItems = [...(budget?.items ?? [])];
      let budgetTouched = false;
      if (plan.budgetRemoveNames && want('budget')) {
        for (const name of plan.budgetRemoveNames) {
          const lk = locateKey({ name });
          const idx = budgetItems.findIndex((it) => (lk.id ? it.id === lk.id : normName(it.name) === normName(lk.name)));
          if (idx >= 0) {
            budgetItems.splice(idx, 1);
            budgetTouched = true;
          } else if (retry.size === 0) {
            failed.push(`未找到「${lk.name}」费用项`);
          } /* 重试中找不到 = 前次已删成功，静默跳过 */
        }
      }
      if (plan.budgetAdd && want('budget')) {
        for (const it of plan.budgetAdd) {
          if (typeof it.name !== 'string' || !it.name.trim()) continue;
          if (budgetItems.some((x) => normName(x.name) === normName(it.name))) continue; /* 不重复新增 */
          const unknown = it.unitPrice == null || !Number.isFinite(Number(it.unitPrice));
          budgetItems.push({
            id: `adj-${Date.now()}-${it.name}`,
            name: it.name,
            qty: Number(it.qty) || 1,
            unitPrice: unknown ? 0 : Number(it.unitPrice),
            ...(unknown ? { priceUnknown: true } : {}),
          });
          budgetTouched = true;
        }
      }
      if (budgetTouched) {
        budget = { ...budget, items: budgetItems }; /* limit 不动；合计按数量×单价计算 */
        modules.push('budget');
      }
      /* 物料：按规整名称增删（同 budget）；重试时已删项不再误报 */
      const mats = [...(materials ?? [])];
      let matTouched = false;
      if (plan.materialsRemoveNames && want('materials')) {
        for (const name of plan.materialsRemoveNames) {
          const lk = locateKey({ name });
          const idx = mats.findIndex((it) => (lk.id ? it.id === lk.id : normName(it.name) === normName(lk.name)));
          if (idx >= 0) {
            mats.splice(idx, 1);
            matTouched = true;
          } else if (retry.size === 0) {
            failed.push(`未找到「${lk.name}」物料`);
          } /* 重试中找不到 = 前次已删成功，静默跳过 */
        }
      }
      if (plan.materialsAdd && want('materials')) {
        for (const it of plan.materialsAdd) {
          if (typeof it.name !== 'string' || !it.name.trim()) continue;
          if (mats.some((x) => normName(x.name) === normName(it.name))) continue;
          mats.push({ id: `adj-${Date.now()}-${it.name}`, category: it.category || '其他', name: it.name, qty: it.qty ?? '', ready: false });
          matTouched = true;
        }
      }
      if (matTouched) {
        materials = mats;
        modules.push('budget');
      }
      /* 布置要求：tags 归一化写入（字符串也安全拆分，杜绝 tags.filter 崩溃）；
       * 已有效果图标 stale（保留旧图，重新生成由用户触发）；
       * 移除的布置元素级联清理相关流程环节、费用与物料，让「取消舞台」真正落地 */
      if (want('scene') && (plan.sceneTags || plan.sceneStyle !== undefined || plan.sceneExtra !== undefined)) {
        const cur = scene ?? {};
        const curTags = normalizeTags(cur.tags);
        const nextTags = plan.sceneTags ? normalizeTags(plan.sceneTags) : curTags;
        const removed = curTags.filter((t) => !nextTags.includes(t));
        const hadAfter = !!cur.afterUrl;
        scene = {
          ...cur,
          ...(plan.sceneStyle !== undefined ? { style: plan.sceneStyle } : {}),
          ...(plan.sceneExtra !== undefined ? { extra: plan.sceneExtra } : {}),
          ...(plan.sceneTags ? { tags: nextTags } : {}),
          ...(hadAfter ? { stale: true } : {}),
        };
        modules.push('scene');
        if (removed.length > 0) {
          const hit = (txt: string) => removed.some((t) => txt.includes(t));
          schedule = (schedule ?? []).filter((it) => !hit(it.name) && !(it.note && hit(it.note)));
          budget = { ...(budget ?? { limit: null, items: [] }), items: (budget?.items ?? []).filter((it) => !hit(it.name)) };
          materials = (materials ?? []).filter((it) => !hit(it.name));
        }
      }

      const changed =
        theme !== data.theme ||
        copies !== data.copies ||
        req !== data.requirements ||
        schedule !== data.schedule ||
        budget !== data.budget ||
        materials !== data.materials ||
        scene !== data.scene;
      if (!changed) {
        return { ok: false, modules: [], failed: failed.length > 0 ? failed : ['本次建议未包含可写入的变更'] };
      }
      /* 确认类写入必须等持久化真正完成才算成功：失败/被中断时成果保持原样，卡片可重试（幂等不重复写入） */
      const nextData: ProjectData = {
        ...data,
        ...(req !== data.requirements ? { requirements: req } : {}),
        ...(theme !== data.theme ? { theme } : {}),
        ...(schedule !== data.schedule ? { schedule } : {}),
        ...(budget !== data.budget ? { budget } : {}),
        ...(materials !== data.materials ? { materials } : {}),
        ...(copies !== data.copies ? { copies } : {}),
        ...(scene !== data.scene ? { scene } : {}),
      };
      setData(nextData);
      if (saveTimer.current) clearTimeout(saveTimer.current);
      const persisted = await persist(title, nextData);
      if (!persisted) {
        return { ok: false, modules: [], failed: ['保存失败：网络或服务异常，本次变更未写入，成果保持原样，可重试（已写入部分会自动识别不重复执行）'] };
      }
      setFreshTabs((prev) => {
        const add = modules.filter((m) => !prev.includes(m));
        return add.length > 0 ? [...prev, ...add] : prev;
      });
      return {
        ok: failed.length === 0,
        modules,
        failed: failed.length > 0 ? failed : undefined,
        undoneFields: collectUndone(plan, failed, modules),
      };
    },
    [data, persist, title]
  );

  /* 模块内 AI 任务结果以自然消息进入策划对话（真实发生才记录，不额外调用 AI 写寒暄）；
   * actionTag：成功写入成果后附加「已更新到XX」标签与查看入口 */
  const logTaskToChat = useCallback(
    (
      msg: string,
      actionTag?: ChatMessage['actionTag'],
      draft?: { kind: 'theme' | 'copies'; theme?: ProjectData['theme']; copies?: ProjectData['copies'] },
      retry?: { kind: 'theme' | 'copies' | 'scheme' }
    ) => {
      appendChat({
        id: `a-${Date.now()}`,
        role: 'assistant',
        content: msg,
        actionTag,
        ts: Date.now(),
        /* 待确认草稿随消息持久化：刷新/重进保持待确认，确认动作只在草稿卡上发生 */
        ...(draft
          ? {
              draftCard: {
                ...draft,
                /* 快照原值：差异展示固定用草稿创建时的原主题，不随当前成果漂移 */
                ...(draft.kind === 'theme' ? { origTheme: data?.theme } : {}),
                status: 'pending' as const,
              },
            }
          : {}),
        /* 失败消息的手动重试入口随消息持久化：刷新后仍可点击，继续原任务不追加用户请求 */
        ...(retry ? { retryAction: { ...retry } } : {}),
      });
      /* 成果更新且对应页签未处于活跃浏览时，卡片收起态显示红点提示（不强制展开） */
      if (actionTag && actionTag.module !== modTab) {
        setFreshTabs((prev) => (prev.includes(actionTag.module) ? prev : [...prev, actionTag.module]));
      }
    },
    [appendChat, modTab, data]
  );

  /** 主题/文案草稿确认：此刻才真正写入成果（此前只存在于会话草稿卡），成功状态对应实际保存 */
  const applyDraft = useCallback(
    (msgId: string, draft: NonNullable<ChatMessage['draftCard']>) => {
      if (!data) return;
      if (draft.kind === 'theme' && draft.theme) {
        patch({ theme: draft.theme });
        toast.success('已按草稿更新活动主题');
      } else if (draft.kind === 'copies' && draft.copies) {
        patch({ copies: draft.copies });
        toast.success('已按草稿更新活动文案');
      } else {
        return;
      }
      updateChat(msgId, {
        draftCard: { ...draft, status: 'applied' },
        actionTag: { label: draft.kind === 'theme' ? '已更新到活动主题' : '已更新到活动文案', module: 'plan' },
      });
      setFreshTabs((prev) => (prev.includes('plan') ? prev : [...prev, 'plan']));
    },
    [data, patch, updateChat]
  );

  /** 模块按钮触发的生成：先在会话流插入一条自然用户请求（与直接对话同一任务，仅一次模型调用） */
  const logUserRequest = useCallback(
    (msg: string) => {
      appendChat({ id: `u-${Date.now()}`, role: 'user', content: msg, ts: Date.now() });
      /* 移动端模块主区触发时展开 AI 抽屉；桌面端会话常驻左侧，不再弹出第二个聊天窗 */
      if (window.innerWidth < 768) setAiOpen(true);
    },
    [appendChat]
  );

  /* 生图任务失败：在会话中明确反馈并保留旧结果（按 taskId 去重，刷新/切页不重复发送） */
  useEffect(() => {
    const t = data?.scene?.genTask;
    if (!t?.taskId || t.status !== 'failed' || !data) return;
    const failId = `scene-fail-${t.taskId}`;
    if ((data.chatLog ?? []).some((m) => m.id === failId)) return;
    appendChat({
      id: failId,
      role: 'assistant',
      content: `抱歉，这次布置效果图生成没能完成（${t.error ?? '原因待确认'}）。已有的场地照片与成果都已保留，你可以调整布置要求后再试一次，或直接和我聊聊想怎么调整～`,
      ts: Date.now(),
    });
  }, [data?.scene?.genTask?.taskId, data?.scene?.genTask?.status, data?.chatLog, appendChat, data]);


  /** AI 建议的活动主题 → 写回需求摘要（source: 'ai'，待用户采纳确认） */
  const applySuggestedTheme = useCallback(
    (theme: string) => {
      setData((prev) => {
        if (!prev) return prev;
        const next = {
          ...prev,
          requirements: { ...(prev.requirements ?? {}), visualTheme: { value: theme, source: 'ai' as const } },
        };
        scheduleSave(title, next);
        return next;
      });
    },
    [title, scheduleSave]
  );

  /** AI 输出的「建议方向：」行 → 合并进候选方向（按名称去重，不覆盖已选方向） */
  const applySuggestedDirections = useCallback(
    (ds: Direction[]) => {
      setData((prev) => {
        if (!prev) return prev;
        const existing = prev.directions ?? [];
        const existingNames = new Set(existing.map((d) => d.name));
        const merged = [...existing, ...ds.filter((d) => !existingNames.has(d.name))];
        if (merged.length === existing.length) return prev;
        const next = { ...prev, directions: merged };
        scheduleSave(title, next);
        return next;
      });
    },
    [title, scheduleSave]
  );

  /** 用户在对话中发送新场地照片 → 更新 scene.beforeUrl 并作废旧效果图 */
  const applySceneImage = useCallback(
    (url: string) => {
      setData((prev) => {
        if (!prev) return prev;
        const next = {
          ...prev,
          scene: { ...prev.scene, beforeUrl: url, isExample: false },
        };
        scheduleSave(title, next);
        return next;
      });
    },
    [title, scheduleSave]
  );

  if (loading || !authReady) {
    return (
      <div className="flex min-h-screen items-center justify-center gap-3 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <span className="text-sm">正在载入活动…</span>
      </div>
    );
  }

  if (notFound || !data) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-4">
        <p className="text-sm text-muted-foreground">活动不存在或已被删除</p>
        <Button asChild variant="outline">
          <Link to="/projects">返回我的活动</Link>
        </Button>
      </div>
    );
  }

  /* 成果栏页签内容（桌面右栏与移动主区共用同一份，受控页签状态同步） */
  const modulesPanel = (
    /* @container：模块按成果栏自身宽度切换布局（窄=单列紧凑、宽=多列完整），与视口断点无关 */
    (<Tabs value={modTab ?? (data.intent === 'venue' ? 'scene' : 'plan')} onValueChange={handleModTab} className="@container w-full">
      <div className="px-1 md:px-0">
        <TabsList className="h-11 w-full justify-start gap-1 overflow-x-auto rounded-xl bg-muted p-1 md:w-fit">
          <TabsTrigger value="plan" className="min-h-9 flex-1 rounded-lg px-4 text-sm data-[state=active]:shadow-sm md:flex-none">活动方案</TabsTrigger>
          <TabsTrigger value="scene" className="min-h-9 flex-1 rounded-lg px-4 text-sm data-[state=active]:shadow-sm md:flex-none">场景布置</TabsTrigger>
          <TabsTrigger value="budget" className="min-h-9 flex-1 rounded-lg px-4 text-sm data-[state=active]:shadow-sm md:flex-none">预算与准备</TabsTrigger>
        </TabsList>
      </div>
      <div className="mt-4 px-1 md:mt-6 md:px-0">
        <TabsContent value="plan" className="mt-0" id="mod-plan">
          <PlanModule
            data={data}
            patch={patch}
            openSignal={reqSignal}
            reqEditSignal={reqEditSignal}
            copiesSignal={copiesSignal}
            schemeSignal={schemeSignal}
            themeSignal={themeSignal}
            onTaskLog={logTaskToChat}
            onUserRequest={logUserRequest}
            taskLocked={taskLocked}
            onTaskBegin={beginTask}
            onTaskEnd={endTask}
            allCollapsed={allCollapsed}
            fresh={freshTabs.includes('plan')}
          />
        </TabsContent>
        <TabsContent value="scene" className="mt-0" id="mod-scene">
          <SceneModule
            data={data}
            patchNow={patchNow}
            genSignal={sceneSignal}
            onUploadOnly={uploadSceneOnly}
            onGenerate={triggerSceneFromAi}
            onUserRequest={logUserRequest}
            onTaskLog={logTaskToChat}
            taskLocked={taskLocked}
            allCollapsed={allCollapsed}
            fresh={freshTabs.includes('scene')}
          />
        </TabsContent>
        <TabsContent value="budget" className="mt-0" id="mod-budget">
          <BudgetModule
            data={data}
            patch={patch}
            patchNow={patchNow}
            allCollapsed={allCollapsed}
            fresh={freshTabs.includes('budget')}
          />
        </TabsContent>
      </div>
    </Tabs>)
  );

  return (
    <div className="flex min-h-screen w-full flex-col bg-muted/30">
      {/* 顶栏 */}
      <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-[1600px] items-center gap-2 px-3 md:px-5">
          <Button asChild variant="ghost" size="icon" className="h-9 w-9 shrink-0" aria-label="返回">
            <Link to="/projects">
              <ArrowLeft className="h-4.5 w-4.5" />
            </Link>
          </Button>
          <Input
            value={title}
            onChange={(e) => onTitleChange(e.target.value)}
            className="min-w-0 max-w-xs flex-1 border-0 bg-transparent px-2 text-sm font-semibold shadow-none focus-visible:ring-1 md:max-w-sm md:text-base"
            placeholder="活动名称"
          />
          {/* 保存状态 */}
          <span className="ml-1 hidden items-center gap-1.5 text-xs text-muted-foreground md:inline-flex">
            {saveState === 'pending' && (<><Loader2 className="h-3.5 w-3.5 animate-spin text-amber-500" />已恢复未同步的编辑，正在同步…</>)}
            {saveState === 'saving' && (<><Loader2 className="h-3.5 w-3.5 animate-spin" />保存中…</>)}
            {saveState === 'saved' && (<><Check className="h-3.5 w-3.5 text-green-600" />已保存 {savedAt}</>)}
            {saveState === 'error' && (
              <>
                <CloudOff className="h-3.5 w-3.5 text-destructive" />
                保存失败
                <button type="button" onClick={() => persist(title, data)} className="inline-flex items-center gap-0.5 text-primary hover:underline">
                  <RotateCcw className="h-3 w-3" />
                  重试
                </button>
              </>
            )}
            {saveState === 'idle' && '自动保存已开启'}
          </span>

          <div className="ml-auto flex items-center gap-2">
            {/* 最近活动切换 + 新建（公共导航：不强制从我的活动绕回） */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 shrink-0">
                  <Clock3 className="h-4 w-4" />
                  <span className="hidden sm:inline">活动</span>
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-w-[calc(100%-2rem)] md:max-w-64">
                <DropdownMenuLabel>最近活动</DropdownMenuLabel>
                {recentProjects.filter((p) => p.id !== id).slice(0, 4).map((p, i) => (
                  <DropdownMenuItem key={p.id} onClick={() => navigate(`/workbench/${p.id}`)}>
                    <span className="min-w-0 truncate">{i === 0 ? `继续上次：${p.title}` : p.title}</span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => navigate('/projects')}>
                  <span>我的全部活动</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => navigate('/plan')}>
                  <Plus className="h-4 w-4" />
                  新建活动
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            {/* 移动端 AI 入口 */}
            <Button variant="outline" size="sm" className="h-9 md:hidden" onClick={() => setAiOpen(true)}>
              <MessageSquareHeart className="h-4 w-4" />
              AI
            </Button>
            {/* 桌面：宽屏编辑（成果区加宽为固定宽度的编辑模式）；返回分栏恢复并排布局与此前拖拽的比例 */}
            <Button
              variant="outline"
              size="sm"
              className="hidden h-9 gap-1.5 md:inline-flex"
              onClick={() => setPanelExpanded((v) => !v)}
              disabled={!aiPanel}
              aria-label={panelExpanded ? '退出宽屏（恢复聊天与成果并排及调整的宽度比例）' : '宽屏编辑（成果区加宽到可调整的最宽位置）'}
              title={panelExpanded ? '退出宽屏：恢复聊天与成果并排及此前拖拽的宽度比例' : '宽屏编辑：成果区加宽到拖拽线可调整的最宽位置，便于编辑完整方案与预算表'}
            >
              {panelExpanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              <span className="hidden lg:inline">{panelExpanded ? '退出宽屏' : '宽屏编辑'}</span>
            </Button>
            {/* 全部收起/展开：成果栏长内容一键折叠，状态随项目保存 */}
            <Button
              variant="outline"
              size="sm"
              className="hidden h-9 gap-1.5 md:inline-flex"
              onClick={toggleAllCollapsed}
              aria-label={allCollapsed ? '全部展开卡片' : '全部收起卡片'}
            >
              {allCollapsed ? <ChevronsUpDown className="h-4 w-4" /> : <ChevronsDownUp className="h-4 w-4" />}
              <span className="hidden lg:inline">{allCollapsed ? '全部展开' : '全部收起'}</span>
            </Button>
            {/* 桌面 AI 面板开关 */}
            <Button
              variant="ghost"
              size="icon"
              className="hidden h-9 w-9 md:inline-flex"
              onClick={() => setAiPanel((v) => !v)}
              aria-label={aiPanel ? '收起成果栏（扩大对话区）' : '展开成果栏'}
              title={aiPanel ? '收起成果栏' : '展开成果栏'}
            >
              {aiPanel ? <PanelRightClose className="h-4.5 w-4.5" /> : <PanelRightOpen className="h-4.5 w-4.5" />}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                /* 打开预览前先冲刷最新未保存编辑（草稿已同步写入，这里确保服务端也拿到） */
                if (dirtyRef.current && data && id && userId) {
                  if (saveTimer.current) clearTimeout(saveTimer.current);
                  void persist(title, data);
                }
                setPreviewOpen(true);
              }}
            >
              <Sparkles className="h-4 w-4" />
              <span className="hidden sm:inline">预览成果</span>
            </Button>
          </div>
        </div>
      </header>
      {/* 成果预览宽弹窗：不跳转页面；长内容在弹窗内滚动；独立页面为次级入口 */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        {/* [&>button.absolute]:hidden 隐藏 DialogContent 自带的角落关闭叉号，只保留标题行右侧那颗，避免双叉号重叠 */}
        <DialogContent className="flex h-[92dvh] max-w-[calc(100%-1rem)] flex-col gap-0 overflow-hidden p-0 md:max-w-6xl [&>button.absolute]:hidden">
          <div className="flex shrink-0 items-center gap-2 px-4 py-3 border-solid border-[#dbab2d] bg-[#ffe75100] bg-none border-[0px] border-[#dbbc6b]">
            <span className="min-w-0 flex-1 truncate text-sm font-semibold">{title} · 成果预览</span>
            <Button asChild variant="outline" size="sm">
              <a href={`/preview/${id}`} target="_blank" rel="noreferrer">
                <ExternalLink className="h-4 w-4" />
                <span className="hidden sm:inline">在独立页面打开</span>
                <span className="sm:hidden">独立页</span>
              </a>
            </Button>
            <DialogClose asChild>
              <Button variant="ghost" size="icon" aria-label="关闭预览" onClick={() => setPreviewOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </DialogClose>
          </div>
          <iframe
            src={`/preview/${id}?embed=1`}
            title="成果预览"
            className="min-h-0 w-full flex-1 border-0 bg-muted/30"
          />
        </DialogContent>
      </Dialog>
      {/* 主体：桌面 = 左宽对话区（连续共策主界面）+ 右可收起成果栏；移动 = 模块主区 + AI 抽屉 */}
      <div className="mx-auto flex w-full max-w-[1600px] flex-1 gap-0 px-0 md:gap-4 md:px-5">
        {/* 左：AI 对话协作区（桌面主区域；无成果时右侧不铺空表单，对话即主界面；单实例挂载防双触发） */}
        <div className="hidden min-w-0 flex-1 pt-4 pb-6 md:block">
          <div className="sticky top-14 h-[calc(100vh-3.5rem)] overflow-hidden rounded-2xl border bg-background shadow-sm">
            {isDesktop && (
            <AiAssistant
              data={data}
              activeTab={effTab as 'plan' | 'scene' | 'budget'}
              onChatLogAppend={appendChat}
              onChatLogUpdate={updateChat}
              onDraftApply={applyDraft}
              onSuggestedTheme={applySuggestedTheme}
              onSuggestedDirections={applySuggestedDirections}
              onSceneImage={applySceneImage}
              onConditionSync={syncConditions}
              onOpenRequirements={openRequirements}
              onOpenSceneGenerate={openSceneFromChat}
              onViewModule={openModuleTab}
              onAdjust={(card, action) => (action === 'apply' ? applyAdjust(card) : Promise.resolve({ ok: true, modules: [] }))}
              onSchemeGen={handleSchemeFromChat}
              onCopiesGen={handleCopiesFromChat}
              onThemeGen={handleThemeFromChat}
              onTriggerSceneGen={triggerSceneFromAi}
              onTaskBegin={beginTask}
              onTaskEnd={endTask}
              taskLocked={taskLocked}
              taskLabel={taskLabel}
              nickname={profile?.nickname ?? null}
              autoRespondEnabled={freshEnter}
            />
            )}
          </div>
        </div>

        {/* 右：成果栏（可拖拽调宽、可展开为宽视图；@container 按面板自身宽度切换布局，展开/收起不卸载组件不丢编辑状态） */}
        {aiPanel && (
          <aside
            ref={panelScrollRef}
            style={panelExpanded ? { width: expandedW } : { width: panelW }}
            className={cn(
              'sticky top-14 hidden h-[calc(100vh-3.5rem)] shrink-0 overflow-y-auto border-l bg-muted/20 md:block'
            )}
          >
            {isDesktop && modulesPanel}
            {/* 拖拽手柄：仅窄视图显示；常驻可见抓握条，悬停放大变色并浮出提示，宽度按浏览器记忆 */}
            {!panelExpanded && (
              <div
                role="separator"
                aria-orientation="vertical"
                aria-label="拖拽调整成果栏宽度"
                title="拖拽调整两侧宽度"
                className="group absolute inset-y-0 left-0 z-10 flex w-3 -translate-x-1/2 cursor-col-resize touch-none items-center justify-center hover:bg-primary/10"
                onPointerDown={onPanelResizeStart}
                onPointerMove={onPanelResizeMove}
                onPointerUp={onPanelResizeEnd}
              >
                <span className="h-10 w-1 rounded-full bg-border transition-all duration-200 group-hover:h-16 group-hover:bg-primary/60" />
                <span className="pointer-events-none absolute left-4 top-1/2 z-20 -translate-y-1/2 whitespace-nowrap rounded-md border bg-popover px-2 py-1 text-[11px] font-medium text-popover-foreground opacity-0 shadow-md transition-opacity duration-200 group-hover:opacity-100">
                  左右拖拽调整宽度
                </span>
              </div>
            )}
          </aside>
        )}

        {/* 移动端：模块主区（AI 对话经右上按钮以抽屉打开，界面连续不跳表单；单实例挂载防双触发） */}
        <div className="@container min-w-0 flex-1 px-3 pb-20 pt-4 md:hidden">
          {!isDesktop && modulesPanel}
        </div>
      </div>
      {/* 移动端 AI 助手 */}
      <Sheet open={aiOpen} onOpenChange={setAiOpen}>
        <SheetContent side="right" className="w-full p-0 md:hidden">
          <SheetHeader className="sr-only">
            <SheetTitle>AI 策划伙伴</SheetTitle>
          </SheetHeader>
          <div className={cn('h-full')}>
            <AiAssistant
              data={data}
              activeTab={effTab as 'plan' | 'scene' | 'budget'}
              onChatLogAppend={appendChat}
              onChatLogUpdate={updateChat}
              onDraftApply={applyDraft}
              onSuggestedTheme={applySuggestedTheme}
              onSuggestedDirections={applySuggestedDirections}
              onSceneImage={applySceneImage}
              onConditionSync={syncConditions}
              onOpenRequirements={openRequirements}
              onOpenSceneGenerate={openSceneFromChat}
              onViewModule={openModuleTab}
              onAdjust={(card, action) => (action === 'apply' ? applyAdjust(card) : Promise.resolve({ ok: true, modules: [] }))}
              onSchemeGen={handleSchemeFromChat}
              onCopiesGen={handleCopiesFromChat}
              onThemeGen={handleThemeFromChat}
              onTriggerSceneGen={triggerSceneFromAi}
              onTaskBegin={beginTask}
              onTaskEnd={endTask}
              taskLocked={taskLocked}
              taskLabel={taskLabel}
              nickname={profile?.nickname ?? null}
              autoRespondEnabled={freshEnter}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
