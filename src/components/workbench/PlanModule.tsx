import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ClipboardCopy,
  Loader2,
  PanelRightOpen,
  PencilLine,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { isUnknownReqText, isUnknownReqValue, deriveTimeRange, fixCopiesTimeRange, sanitizeCopiesFacts, sanitizeCopiesDates } from '@/services/deliverables';
import { cleanEmphasisText } from '@/services/textFormat';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import CollapsibleSection from '@/components/workbench/CollapsibleSection';
import { cn } from '@/lib/utils';
import { classifyAiError, aiChat, sanitizeDirection } from '@/services/ai';
import { knownTotal, unpricedItems } from '@/services/budgetMath';
import { genId } from '@/services/api';
import { ensureIds } from '@/services/normalize';
import type { BudgetItem, Direction, ProjectData, ProjectRequirements, ReqSource, ScheduleItem } from '@/types/types';
import { fitScheduleDur, parseDurToMin, scheduleRange, syncCopiesTimes } from '@/services/scheduleCheck';
import { resolveSelectedTheme } from '@/services/themeResolve';

interface PlanModuleProps {
  data: ProjectData;
  /** 更新 data（触发工作台统一自动保存） */
  patch: (partial: Partial<ProjectData>) => void;
  /** 外部请求打开需求摘要（对话同步标签「查看」入口） */
  openSignal?: number;
  /** 外部请求直接打开「全部字段」编辑弹窗并定位第一个未确定项（预览「未知条件→去处理」入口）；
   * 可跳过：弹窗关闭不提交、未知项可留空保存 */
  reqEditSignal?: number;
  /** 对话内明确请求生成完整方案：复用按钮同一生成流程（补问/替换确认/概览消息全保留）；
   * viaChat=true 表示由对话分发触发——用户原文已在会话中，模块不再合成第二条用户请求 */
  schemeSignal?: { seq: number; viaChat: boolean } | null;
  /** 对话明确「只改主题」：复用主题按钮同一草稿链路（新主题先待确认，确认才替换）；
   * viaChat=true 时用户原文已在会话中，不合成第二条用户请求 */
  themeSignal?: { seq: number; viaChat: boolean; text?: string } | null;
  /** 策划对话（只读）：用户选择已有主题建议时，程序定位上文候选完整内容（不经模型转述） */
  chatLog?: ReadonlyArray<{ role: string; content: string; draftCard?: { kind: string; theme?: ProjectData['theme'] } | null }>;
  /** 对话明确请求单独生成文案（不重写方案其余部分）：复用 doGenCopies 同一流程；
   * viaChat=true 时用户原文已在会话中，不再合成第二条用户请求 */
  copiesSignal?: { seq: number; viaChat: boolean } | null;
  /** 模块内 AI 任务结果以自然消息进入策划对话（同一份项目数据，不重复调用 AI 写寒暄）；
   * draft：主题/文案替换生成结果作为待确认草稿随消息展示（不直接写入成果，用户确认后落地） */
  onTaskLog?: (
    msg: string,
    actionTag?: { label: string; module: 'plan' | 'scene' | 'budget' },
    draft?: { kind: 'theme' | 'copies'; theme?: ProjectData['theme']; copies?: ProjectData['copies'] },
    /** 失败消息附带的手动重试入口（随消息持久化，点击继续原任务） */
    retry?: { kind: 'theme' | 'copies' | 'scheme' }
  ) => void;
  /** 按钮触发生成前，先在会话流插入一条自然用户请求（与直接对话同任务，只调用一次模型） */
  onUserRequest?: (msg: string) => void;
  /** 全局任务锁：任一 AI 任务（含对话/生图）进行中时为 true，禁用全部生成入口防并发覆盖 */
  taskLocked?: boolean;
  /** 任务开始/结束回调（Workbench 统一登记全局任务，驱动所有入口禁用与状态展示） */
  onTaskBegin?: (label: string) => void;
  onTaskEnd?: () => void;

  /** 全部收起 */
  allCollapsed?: boolean;
  /** 新内容红点提示 */
  fresh?: boolean;
}

/* 需求字段展示配置 */
const REQ_FIELDS: { key: keyof ProjectRequirements; label: string; kind?: 'rv' }[] = [
  { key: 'visualTheme', label: '活动主题', kind: 'rv' },
  { key: 'headcount', label: '人数', kind: 'rv' },
  { key: 'budget', label: '预算', kind: 'rv' },
  { key: 'region', label: '地区', kind: 'rv' },
  { key: 'date', label: '日期', kind: 'rv' },
  { key: 'venueType', label: '场地类型', kind: 'rv' },
  { key: 'style', label: '风格', kind: 'rv' },
];

export default function PlanModule({ data, patch, openSignal, reqEditSignal, schemeSignal, themeSignal, copiesSignal, chatLog, onTaskLog, onUserRequest, taskLocked, onTaskBegin, onTaskEnd, allCollapsed, fresh }: PlanModuleProps) {
  const [reqOpen, setReqOpen] = useState(false);
  const reqBodyRef = useRef<HTMLDivElement | null>(null);
  const focusFirstEmptyRef = useRef(false);
  /* 候选方向详情展开（按需，默认紧凑：名称+一句话特点+选中态） */
  const [dirDetailIds, setDirDetailIds] = useState<string[]>([]);
  const [genLoading, setGenLoading] = useState<'directions' | 'scheme' | 'theme' | 'copies' | null>(null);
  /* 抽屉草稿：打开时从当前需求复制；取消不保存（已保存内容保留），保存一次性写入 */
  const [draft, setDraft] = useState<ProjectRequirements | null>(null);
  /* 确认路径标志：区分「确认后关闭」与「真实取消」，杜绝确认成功仍发取消消息 */
  const confirmRef = useRef(false);
  const [confirmState, setConfirmState] = useState<{
    onCancel?: () => void;
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

  /* 对话「查看」入口：打开抽屉并滚动到需求摘要 */
  useEffect(() => {
    if (!openSignal) return;
    setDraft({ ...(data.requirements ?? {}) });
    setReqOpen(true);
    document.getElementById('req-summary-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [openSignal]);

  const req = data.requirements ?? {};
  const directions = data.directions ?? [];
  /* 卡片展开/收起：随项目持久化（data.ui.collapsed）；allCollapsed 为全局收起 */
  const uiC = data.ui?.collapsed ?? {};
  const secOpen = (k: string) => !(allCollapsed || uiC[k]);
  const toggleSec = (k: string, next: boolean) =>
    patch({ ui: { ...data.ui, collapsed: { ...uiC, [k]: !next } } });
  const schedule = data.schedule ?? [];

  /* ---------- 生成：创意方向 ---------- */
  /* 更新/生成方向：与重新生成方案同一确认通道——已有候选方向时先二次确认，防止误触整批替换 */
  const genDirections = () => {
    /* 全局任务锁：任一 AI 任务进行中（含首轮对话/生图）不允许并发生成，防先后覆盖 */
    if (taskLocked || genLoading) return;
    if (directions.length > 0) {
      patch({ pendingConfirm: { kind: 'directions', directionId: '', viaChat: false, ts: Date.now() } });
      setConfirmState({
        open: true,
        title: '确认更新候选方向？',
        description: '更新会整批替换当前候选方向，并清除已选中的方向（已有方案内容不受影响）。确定要换一批方向吗？',
        confirmText: '确认更新',
        destructive: true,
        onConfirm: () => void doGenDirections(false),
        onCancel: () => {
          patch({ pendingConfirm: null });
          toast.info('已取消，现有候选方向保持不变');
        },
      });
      return;
    }
    void doGenDirections(false);
  };

  const doGenDirections = async (viaChat: boolean) => {
    if (taskLocked || genLoading) return;
    setGenLoading('directions');
    onTaskBegin?.('AI 正在构思创意方向…');
    /* 按钮即对话：先在会话流插入自然用户请求（不额外调用模型写请求寒暄） */
    onUserRequest?.(
      `请结合我们当前讨论，重新给我几个活动方向${viaChat || directions.length > 0 ? '（换一批不一样的）' : ''}。`
    );
    try {
      const { json } = await aiChat('directions', data, '', () => undefined);
      const parsed = json as { directions?: unknown[] } | null;
      if (parsed?.directions?.length) {
        /* 逐条字段级校验（名称/风格长度与非法字符拦截，杜绝协议串漏出或拆错后写入） */
        const list = parsed.directions
          .map((d) => sanitizeDirection(d, genId))
          .filter((d): d is Direction => !!d)
          .slice(0, 3);
        if (list.length === 0) {
          onTaskLog?.('这次方向生成的内容没通过格式校验，已有的候选方向都原样保留，稍后再试一次～');
          toast.error('生成结果校验未通过，请重试');
          return;
        }
        patch({ directions: list, selectedDirectionId: undefined });
        toast.success(`已生成 ${list.length} 个创意方向`);
        onTaskLog?.(
          `我重新整理了 ${list.length} 个创意方向（${list.map((d) => d.name).join('、')}），已加入「候选方向」区，点击即可选中。`,
          { label: '已更新到候选方向', module: 'plan' }
        );
      } else {
        onTaskLog?.('这次方向生成没能解析出有效结果，已有的候选方向都还在，稍后可以再试一次～');
        toast.error('生成结果解析失败，请重试');
      }
    } catch (e) {
      console.error(e);
      onTaskLog?.('方向生成失败了，你现有的候选方向和方案都没有被动到，稍后再试一次吧～');
      toast.error('生成失败，请重试');
    } finally {
      setGenLoading(null);
      onTaskEnd?.();
    }
  };

  /* ---------- 生成：仅主题（不生成流程/预算/物料/任务/文案） ----------
   * 已有主题：生成结果先作为待确认草稿进入会话（展示新主题名/口号/亮点与替换范围），确认后才写入，取消保留旧稿；
   * 初次目标为空：直接形成初稿写入（无可替换内容，无需确认） */
  const doGenTheme = async (viaChat = false, userText = '') => {
    if (taskLocked || genLoading) return;
    setGenLoading('theme');
    onTaskBegin?.('AI 正在构思活动主题…');
    /* 对话分发触发时用户原文已在会话中（「只改主题…其余不要动」），不合成第二条用户请求 */
    if (!viaChat) {
      onUserRequest?.('请只重新想一个活动主题（主题名、口号、亮点），流程、预算、物料、任务和文案都不要动。');
    }
    if (data.theme?.name) {
      onTaskLog?.('正在重新构思主题：完成后会先把新主题给你过目，你确认后才会替换现有主题；在此之前右侧成果保持原样。');
    }
    try {
      /* 用户已选内容优先程序化采用（不经模型转述，杜绝缩写/缺首字）：上文候选可定位 → 直接构造草稿；
       * 引用确实不唯一/无法定位 → 正常走模型生成（提示词已要求逐字采用用户句内容），不再让模型自由转述已选内容 */
      const picked = userText ? resolveSelectedTheme(userText, chatLog ?? []) : null;
      if (picked) {
        const newTheme = { ...data.theme, name: picked.name, slogan: picked.slogan || data.theme?.slogan || '', highlights: picked.highlights };
        if (!data.theme?.name) {
          patch({ theme: newTheme });
          toast.success('活动主题初稿已生成');
          onTaskLog?.(
            `主题已按你的选择定为「${newTheme.name}」${newTheme.slogan ? `，口号「${newTheme.slogan}」` : ''}，亮点 ${newTheme.highlights.length} 条。只更新了主题本身，流程、预算、物料、任务与文案全部保持原样。`,
            { label: '已更新到活动主题', module: 'plan' }
          );
        } else {
          onTaskLog?.(
            `已按你选中的「${newTheme.name}」整理主题草稿：名称/口号/亮点为选定内容的完整原文，未经改写。确认后只替换主题名、口号与亮点；流程、预算、物料、任务与文案（含手动修改）全部保持原样。`,
            undefined,
            { kind: 'theme', theme: newTheme }
          );
          toast.info('主题草稿已按你的选择整理好，请在对话中确认');
        }
        return;
      }
      const { json } = await aiChat('theme', data, userText, () => undefined);
      const t = (json as { theme?: { name?: string; slogan?: string; highlights?: string[] } } | null)?.theme;
      if (t?.name?.trim()) {
        const highlights = (t.highlights ?? [])
          .filter((h) => typeof h === 'string' && h.trim())
          .map((h) => cleanEmphasisText(h.trim()));
        const newTheme = { ...data.theme, name: cleanEmphasisText(t.name.trim()), slogan: cleanEmphasisText(t.slogan?.trim() ?? data.theme?.slogan ?? ''), highlights };
        if (!data.theme?.name) {
          /* 初次生成：直接形成初稿 */
          patch({ theme: newTheme });
          toast.success('活动主题初稿已生成');
          onTaskLog?.(
            `新主题定为「${t.name.trim()}」${t.slogan?.trim() ? `，口号「${t.slogan.trim()}」` : ''}${highlights.length > 0 ? `，亮点 ${highlights.length} 条` : ''}。只更新了主题本身，流程、预算、物料、任务与文案全部保持原样。`,
            { label: '已更新到活动主题', module: 'plan' }
          );
        } else {
          /* 已有主题：待确认草稿（不直接替换，刷新也保留待确认状态） */
          onTaskLog?.(
            `新主题已整理好：「${t.name.trim()}」${t.slogan?.trim() ? `，口号「${t.slogan.trim()}」` : ''}${highlights.length > 0 ? `，亮点 ${highlights.length} 条` : ''}。确认后只替换主题名、口号与亮点；流程、预算、物料、任务与文案（含手动修改）全部保持原样。`,
            undefined,
            { kind: 'theme', theme: newTheme }
          );
          toast.info('新主题已整理好，请在对话中确认是否替换');
        }
      } else {
        /* 格式不符（服务成功返回但内容不是主题格式）≠ 服务失败：分开提示，都给手动重试入口 */
        onTaskLog?.(
          '主题生成返回的内容不符合主题格式（没解析出主题名），现有主题原样保留；可点击下方重试本操作～',
          undefined,
          undefined,
          { kind: 'theme' }
        );
        toast.error('主题生成返回格式异常，可点击重试');
      }
    } catch (e) {
      console.error(e);
      const ei = classifyAiError(e);
      onTaskLog?.(
        `${ei.userMessage}，现有主题与其它内容都完好保留。${ei.waitHint ?? ''}～`,
        undefined,
        undefined,
        { kind: 'theme' }
      );
      toast.error(`${ei.userMessage}，可点击重试`);
    } finally {
      setGenLoading(null);
      onTaskEnd?.();
    }
  };
  const tryGenTheme = () => {
    /* 已有主题：先二次确认再发起 AI 调用，防误触覆盖（生成结果仍先进待确认草稿卡）；
     * 首次生成（无主题）不弹确认 */
    if (taskLocked || genLoading) return;
    if (data.theme) {
      setConfirmState({
        open: true,
        title: '确认重新生成主题？',
        description: '将重新生成活动主题（名称、口号、亮点）；现有主题（含手动修改）会在新内容确认后被替换。确定要重新生成吗？',
        confirmText: '确认重新生成',
        destructive: true,
        onConfirm: () => void doGenTheme(),
        onCancel: () => toast.info('已取消，现有主题保持不变'),
      });
      return;
    }
    void doGenTheme();
  };

  /* 对话明确「只改主题」：与按钮同一草稿链路（待确认草稿卡/确认只替换主题字段/取消保留旧主题） */
  const lastThemeSeqRef = useRef(0);
  useEffect(() => {
    if (!themeSignal || themeSignal.seq === lastThemeSeqRef.current) return;
    lastThemeSeqRef.current = themeSignal.seq;
    if (taskLocked || genLoading) {
      toast.info('当前有 AI 任务进行中，请稍候再生成主题～');
      return;
    }
    void doGenTheme(themeSignal.viaChat, themeSignal.text ?? '');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [themeSignal]);

  /* ---------- 生成：完整方案 ---------- */
  const doGenScheme = async (selected: NonNullable<ReturnType<typeof directions.find>>, suppText?: string, viaChat = false) => {
    if (taskLocked || genLoading) return;
    setGenLoading('scheme');
    onTaskBegin?.(`AI 正在按「${selected.name}」整理完整方案…`);
    /* 按钮即对话：按钮触发时用户请求先入会话流；对话分发触发时用户原文已在会话中，
     * 不再合成第二条用户请求（避免一次操作伪造两次请求） */
    if (!viaChat) {
      onUserRequest?.(
        `请结合我们刚才聊到的内容，按「${selected.name}」这个方向整理一份完整方案（主题、流程、预算、物料、任务和文案都要）。${suppText ?? ''}`
      );
    }
    /* 过程进入同一对话：开始时说明正在做什么、更新哪里（完成后另有结果消息，不额外调用 AI 写寒暄） */
    onTaskLog?.(
      `正在按「${selected.name}」方向整理完整方案：主题、流程、预算、物料、任务与文案都会生成，约需 1–2 分钟；完成后更新到对应模块，可在这里继续讨论调整。`
    );
    try {
      const { json } = await aiChat('scheme', data, `已选定方向：「${selected.name}」（${selected.style}）`, () => undefined);
      const parsed = json as
        | {
            theme?: ProjectData['theme'];
            schedule?: ScheduleItem[];
            budgetItems?: BudgetItem[];
            materials?: ProjectData['materials'];
            tasks?: ProjectData['tasks'];
            copies?: ProjectData['copies'];
          }
        | null;
      if (parsed?.theme || parsed?.schedule?.length) {
        /* 列表条目写入边界统一补稳定唯一 id：AI 输出不保证 id，缺失/重复会导致单项编辑串改 */
        let schedule = ensureIds(parsed.schedule);
        /* 时长硬约束程序化校验（提交前，非仅提示词）：对话明确的时长从需求摘要携带，
         * 流程总时长超出 → 比例压缩重排（起止连续、不编造日期/场地）；压不动 → 如实说明需用户取舍 */
        const durNote: string[] = [];
        const durText = data.requirements?.otherNeeds ?? '';
        const dm = /(?:活动|全程|整场)[^。；，\n]*?(\d+(?:\.\d+)?)\s*(?:个?小时|分钟)/.exec(durText);
        const targetMin = dm?.[0] ? parseDurToMin(dm[0]) : null;
        if (targetMin != null && schedule.length > 0) {
          const fit = fitScheduleDur(schedule, targetMin);
          if (fit.needAsk) {
            durNote.push(`流程环节总时长超出了「${dm?.[0] ?? ""}」的明确要求且存在刚性环节（单环节已无法再压缩），已保留生成结果但需要你取舍：可减少环节、合并内容或告诉我调整时长要求～`);
          } else if (fit.changed) {
            schedule = fit.items as typeof schedule;
            durNote.push(`流程总时长已按你的明确时长「${dm?.[0] ?? ""}」程序收敛：各环节时长与起止时间已按比例重排，未延长你的要求。`);
          }
        }
        /* 流程实际区间（首环节开始→末环节结束）：主题说明/文案时间共用同一数据源 */
        const rng = scheduleRange(schedule);
        const syncCopiesTime = (cc: ProjectData['copies']) => {
          if (!cc || !rng) return cc;
          return {
            ...cc,
            invite: syncCopiesTimes(cc.invite, rng.start, rng.end, rng.totalMin),
            hosting: cc.hosting ? syncCopiesTimes(cc.hosting, rng.start, rng.end, rng.totalMin) : cc.hosting,
          };
        };
        const budgetItems = ensureIds(parsed.budgetItems);
        const materials = ensureIds(parsed.materials);
        const tasks = ensureIds(parsed.tasks);
        patch({
          theme: parsed.theme ?? data.theme,
          schedule,
          budget: { limit: data.budget?.limit ?? null, items: budgetItems.length > 0 ? budgetItems : (data.budget?.items ?? []) },
          materials: materials.length > 0 ? materials : (data.materials ?? []),
          tasks: tasks.length > 0 ? tasks : (data.tasks ?? []),
          copies: (() => {
            /* 完整方案里的文案：先做时长/起止时间程序同步（与流程同一数据源），再做事实校验 */
            if (!parsed.copies) return data.copies ?? {};
            const synced = syncCopiesTime(parsed.copies);
            let outCopies = synced;
            const fr = sanitizeCopiesFacts(outCopies, {
              confirmedSpots: [],
              readyMaterialNames: (data.materials ?? []).filter((m) => m.ready).map((m) => m.name ?? ''),
              requirementNeeds: (data.requirements?.otherNeeds as string | undefined) ?? '',
            });
            if (fr.fixes.length > 0) outCopies = { ...outCopies, invite: fr.invite, hosting: fr.hosting, onsite: fr.onsite };
            /* 日期未定：擦除编造的相对/具体日期（「下周日」→「日期待定」），与需求摘要同一未知判定 */
            const dateUnknown = isUnknownReqValue(data.requirements?.date);
            const fd = sanitizeCopiesDates(outCopies, dateUnknown);
            if (fd.fixed) outCopies = { ...outCopies, invite: fd.invite, hosting: fd.hosting, onsite: fd.onsite };
            return outCopies;
          })(),
        });
        /* 提取核心巧思简析与整体方案概览，增强伙伴感 */
        const themeHighlight = parsed.theme?.slogan || parsed.theme?.highlights?.[0] || '注重现场温情互动与氛围沉浸';
        const scheduleSummary = schedule.length > 0 ? `流程从「${schedule[0].name}」到「${schedule[schedule.length - 1].name}」递进展开` : '';
        const schemeInsight = `这套方案以「${parsed.theme?.name || selected.name}」为主线，${themeHighlight}；${scheduleSummary}，既有清晰仪式感，又给伙伴们留足了自由交流的热络氛围。`;

        if (durNote.length > 0) onTaskLog?.(`时长校验：${durNote.join('；')}。`);
        toast.success('完整方案已生成，可继续编辑调整');
        /* 会话内方案概览：按实际写入的数据组织六类成果（主题理由/流程/费用物料重点/任务/文案/待确认），不只报条数 */
        const flowLine = schedule.slice(0, 5).map((it) => `${it.time ?? ''} ${it.name}`.trim()).join(' → ');
        const knownSum = knownTotal(budgetItems);
        const unpriced = unpricedItems(budgetItems);
        const topFees = [...budgetItems].sort((a, b) => (b.qty ?? 0) * (b.unitPrice ?? 0) - (a.qty ?? 0) * (a.unitPrice ?? 0)).slice(0, 3).map((it) => it.name);
        const budgetLine =
          budgetItems.length > 0
            ? `已知合计 ¥${knownSum.toLocaleString('zh-CN')}${topFees.length > 0 ? `（大头是${topFees.join('、')}）` : ''}${unpriced.length > 0 ? `，另有 ${unpriced.length} 项待询价未计入` : ''}`
            : '费用清单这次没有生成（保持原有明细）';
        const matReady = materials.filter((m) => m.ready).length;
        /* 物料/任务带实际重点（前几项名称），让用户不逐卡翻看也知道安排了什么 */
        const matNames = materials.slice(0, 3).map((m) => m.name).filter(Boolean);
        const matLine =
          materials.length > 0
            ? `${materials.length} 项物料（${matReady} 项已就绪）${matNames.length > 0 ? `，如${matNames.join('、')}${materials.length > 3 ? '等' : ''}` : ''}`
            : '物料清单这次没有生成（保持原有清单）';
        const taskNames = tasks.slice(0, 3).map((t) => t.name).filter(Boolean);
        const taskLine =
          tasks.length > 0
            ? `${tasks.length} 项准备任务${taskNames.length > 0 ? `（${taskNames.join('、')}${tasks.length > 3 ? '等' : ''}）` : ''}${tasks.some((t) => t.deadline) ? `，最近的截止是「${tasks.filter((t) => t.deadline).map((t) => t.deadline).sort()[0]}」` : ''}`
            : '任务清单这次没有生成（保持原有任务）';
        const copyLine = parsed.copies?.invite ? '邀请函/主持词/现场指引都已写好，可直接复制使用' : '文案这次没有生成（保持原有文案）';
        const pendingLine = suppMissing.length > 0 ? `尚待确认：${suppMissing.map((k) => (k === 'headcount' ? '人数' : k === 'region' ? '地区' : k === 'budget' ? '预算' : '日期')).join('、')}（影响数量与价格的部分已标注待定）` : '关键条件已齐；如需微调随时告诉我';
        onTaskLog?.(
          `我按「${selected.name}」方向整理好完整方案啦！✨\n\n🎯 **活动主线**：${schemeInsight}\n\n🕐 **主要流程**：${flowLine}${schedule.length > 5 ? ' → …' : ''}\n\n💰 **费用**：${budgetLine}\n\n📦 **物料**：${matLine}\n\n✅ **任务**：${taskLine}\n\n✉️ **文案**：${copyLine}\n\n⏳ ${pendingLine}\n\n全部内容已写入「活动方案」，点击下方查看即可核对与编辑；想调整任何细节（比如只改某个环节时间），我们继续聊～`,
          { label: '已更新到完整方案', module: 'plan' }
        );
      } else {
        onTaskLog?.('方案生成没能解析出有效内容，你现有的方案与所有手动修改都原样保留，稍后再试一次吧～');
        toast.error('方案生成未完成，请重试');
      }
    } catch (e) {
      console.error(e);
      onTaskLog?.('完整方案生成失败了，现有方案内容与手动修改都完好保留，稍后可以再试～');
      toast.error('方案生成失败，请稍后重试');
    } finally {
      setGenLoading(null);
      onTaskEnd?.();
    }
  };

  /* 方案前补问：不看缺几项，只看是否影响当前建议——人数（座位/物料/预算估算）与地区（场地/本地建议）任一缺失时先给可跳过的补充卡；每次最多问这 2 项，预算/日期留待定不追问 */
  const [suppOpen, setSuppOpen] = useState(false);
  const [suppSelected, setSuppSelected] = useState<NonNullable<ReturnType<typeof directions.find>> | null>(null);
  const [suppDraft, setSuppDraft] = useState({ headcount: '', region: '', budget: '', date: '' });
  const suppMissing = useMemo(() => {
    const confirmed = (k: 'headcount' | 'region' | 'date') => {
      const rv = data.requirements?.[k];
      return rv?.source === 'confirmed' && rv.value != null && String(rv.value).trim() !== '';
    };
    const out: Array<'headcount' | 'region' | 'budget' | 'date'> = [];
    if (!confirmed('headcount')) out.push('headcount');
    if (!(confirmed('region') || (data.requirements?.region?.value != null && String(data.requirements.region.value).trim() !== ''))) out.push('region');
    const hasBudget = data.budget?.limit != null || (data.requirements?.budget?.value != null && String(data.requirements.budget.value).trim() !== '');
    if (!hasBudget) out.push('budget');
    if (!confirmed('date')) out.push('date');
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.requirements, data.budget?.limit]);
  const applySuppAndGen = () => {
    const selected = suppSelected;
    setSuppOpen(false);
    setSuppSelected(null);
    if (!selected) return;
    const r = { ...(data.requirements ?? {}) };
    const parts: string[] = [];
    const hc = suppDraft.headcount.trim();
    if (hc) {
      r.headcount = { value: hc, source: 'confirmed' as const };
      parts.push(`大概人数 ${hc}`);
    }
    const rg = suppDraft.region.trim();
    if (rg) {
      r.region = { value: rg, source: 'confirmed' as const };
      parts.push(`所在地区 ${rg}`);
    }
    const dt = suppDraft.date.trim();
    if (dt) {
      r.date = { value: dt, source: 'confirmed' as const };
      parts.push(`时间 ${dt}`);
    }
    const bl = parseBudgetLimit(suppDraft.budget);
    if (suppDraft.budget.trim() && bl != null) {
      /* 0 元：显示「0 元以内（免费）」并作为硬上限同步（bl==0 也同步，不再用真假吞掉） */
      r.budget = { value: `${bl.toLocaleString('zh-CN')} 元以内`, source: 'confirmed' as const };
      parts.push(`预算上限 ${bl.toLocaleString('zh-CN')} 元`);
    }
    if (parts.length > 0) {
      patch({
        requirements: r,
        ...(bl != null && suppDraft.budget.trim()
          ? { budget: { ...(data.budget ?? { limit: null, items: [] }), limit: bl } }
          : {}),
      });
      toast.success(`已补充：${parts.join('；')}`);
    }
    void doGenScheme(selected, parts.length > 0 ? `补充条件：${parts.join('；')}。` : undefined);
  };

  const genScheme = (viaChat = false): 'ok' | 'no-direction' | 'locked' => {
    const selected = directions.find((d) => d.id === data.selectedDirectionId);
    if (!selected) return 'no-direction';
    /* 全局任务锁下的按钮已禁用；此处兜底拦截（确认弹窗回调亦可能迟到） */
    if (taskLocked) return 'locked';
    /* 首次生成且直接影响建议的条件（人数/地区）缺失：先弹可跳过的补充卡（缺几项不是门槛） */
    if ((data.schedule?.length ?? 0) === 0 && suppMissing.some((k) => k === 'headcount' || k === 'region')) {
      setSuppDraft({ headcount: '', region: '', budget: '', date: '' });
      setSuppSelected(selected);
      setSuppOpen(true);
      return 'ok';
    }
    /* 已有内容时重生成先给真实弹窗确认机会：用户取消即保留旧方案，不静默覆盖手改内容 */
    if ((data.schedule?.length ?? 0) > 0) {
      /* 待确认操作持久化（目标/范围/来源快照）：刷新或重开后恢复可操作确认入口，不自动执行 */
      patch({ pendingConfirm: { kind: 'scheme', directionId: selected.id, viaChat, ts: Date.now() } });
      setConfirmState({
        open: true,
        title: '确认重新生成完整方案？',
        description: `重新生成会替换现有方案内容（主题、流程、预算明细、物料、任务与文案，含所有手动修改）。确定按「${selected.name}」重新生成吗？`,
        confirmText: '确认重新生成',
        destructive: true,
        onConfirm: () => void doGenScheme(selected, undefined, viaChat),
        /* 取消是正常结束（非失败/中断）：旧成果原样保留，不出现失败重试提示；持久化状态同步清除 */
        onCancel: () => {
          patch({ pendingConfirm: null });
          onTaskLog?.('已取消重新生成～现有方案与所有手动修改原样保留；想再生成随时点「生成方案」或在对话里说一声。');
          toast.info('已取消，现有方案保持不变');
        },
      });
      return 'ok';
    }
    void doGenScheme(selected, undefined, viaChat);
    return 'ok';
  };

  /* ---------- 待确认操作恢复：刷新/重开后由持久化状态重开确认弹窗（真实状态驱动，不自动确认/执行）。
   * 恢复前重新核对目标：方向或方案其间被编辑/删除则快照过期，清除并交用户重新发起，不直接覆盖 ---------- */
  useEffect(() => {
    const pc = data.pendingConfirm;
    if (!pc || confirmState.open) return;
    if (pc.kind === 'directions') {
      if ((data.directions ?? []).length === 0) {
        patch({ pendingConfirm: null });
        return;
      }
      setConfirmState({
        open: true,
        title: '继续上次的更新方向确认？',
        description: '刷新前你请求更新候选方向，尚未确认。更新会整批替换当前候选方向并清除已选中的方向（已有方案内容不受影响）。现在确认执行，或取消保留现有方向。',
        confirmText: '确认更新',
        destructive: true,
        onConfirm: () => void doGenDirections(pc.viaChat),
        onCancel: () => {
          patch({ pendingConfirm: null });
          toast.info('已取消，现有候选方向保持不变');
        },
      });
      return;
    }
    if (pc.kind !== 'scheme') return;
    const sel = (data.directions ?? []).find((d) => d.id === pc.directionId);
    const stillHasScheme = (data.schedule?.length ?? 0) > 0;
    if (!sel || !stillHasScheme) {
      patch({ pendingConfirm: null });
      toast.info('刷新前的重新生成请求已失效（方案或所选方向已变化），需要时请重新发起，现有内容不会被覆盖。');
      return;
    }
    setConfirmState({
      open: true,
      title: '继续上次的重新生成确认？',
      description: `刷新前你请求按「${sel.name}」重新生成完整方案，尚未确认。重新生成会替换现有方案内容（主题、流程、预算明细、物料、任务与文案，含所有手动修改）。现在确认执行，或取消保留现有方案。`,
      confirmText: '确认重新生成',
      destructive: true,
      /* 恢复执行沿用原触发来源：chat 触发不再合成用户请求（原文已在会话历史） */
      onConfirm: () => void doGenScheme(sel, undefined, pc.viaChat),
      onCancel: () => {
        patch({ pendingConfirm: null });
        onTaskLog?.('已取消重新生成～现有方案与所有手动修改原样保留；想再生成随时点「生成方案」或在对话里说一声。');
        toast.info('已取消，现有方案保持不变');
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.pendingConfirm]);

  /* 对话内明确请求生成完整方案：与按钮同一流程；未选方向已在 Workbench handleSchemeFromChat 单点反馈，此处只处理已选方向的生成 */
  const lastSchemeSeqRef = useRef(0);
  useEffect(() => {
    if (!schemeSignal || schemeSignal.seq === lastSchemeSeqRef.current) return;
    lastSchemeSeqRef.current = schemeSignal.seq;
    const r = genScheme(schemeSignal.viaChat);
    if (r === 'locked') {
      toast.info('当前有 AI 任务进行中，请稍候再生成方案～');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schemeSignal]);
  /* 对话明确请求单独生成文案（「生成文案但不要重新生成方案」）：同一 doGenCopies 流程
   * （任务锁/已有文案走待确认草稿/概述来自实际写入），方案其余部分不动 */
  const lastCopiesSeqRef = useRef(0);
  useEffect(() => {
    if (!copiesSignal || copiesSignal.seq === lastCopiesSeqRef.current) return;
    lastCopiesSeqRef.current = copiesSignal.seq;
    void doGenCopies(copiesSignal.viaChat);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [copiesSignal]);

  /* ---------- 生成：文案（已有文案先确认拟替换范围，取消保留原文） ---------- */
  const hasCopies = !!(data.copies?.invite?.trim() || data.copies?.hosting?.trim() || (data.copies?.onsite ?? []).some((l) => l.trim()));
  const doGenCopies = async (viaChat = false) => {
    if (taskLocked || genLoading) return;
    setGenLoading('copies');
    onTaskBegin?.('AI 正在撰写活动文案…');
    /* 对话分发触发时用户原文已在会话中，不合成第二条用户请求 */
    if (!viaChat) {
      onUserRequest?.('请结合我们当前讨论的主题和流程，重新写一版活动文案（邀请函、主持词、现场指引）。');
    }
    if (hasCopies) {
      onTaskLog?.('正在撰写新文案：完成后会先给你过目（邀请函、主持词与现场指引的新内容），确认后才会替换；现有文案在此之前保持原样。');
    }
    try {
      const { json } = await aiChat('copies', data, '', () => undefined);
      const parsed = json as ProjectData['copies'] | null;
      if (parsed?.invite || parsed?.hosting) {
        /* 保存前可确定矛盾检查：文案时间区间与流程推导不一致时以流程推导修正（如末项 16:00+10 分钟=16:10，
         * 邀请函写 13:45—16:00 → 修正为 13:45—16:10），不把可核对的时间矛盾存进成果 */
        const tr = deriveTimeRange(data.schedule);
        const fixedRes = fixCopiesTimeRange({ invite: parsed.invite, hosting: parsed.hosting }, tr);
        /* 生成后可核对状态校验：无场地照片的方位、未就绪物料的「已备好」、无依据的步行时间、
         * 「保证有」选址要求——逐句定点改待确认措辞，不动正常创意；ctx 只来自已确认数据，不读旧草稿 */
        const factRes = sanitizeCopiesFacts(
          { invite: fixedRes.invite || parsed.invite, hosting: fixedRes.hosting || parsed.hosting, onsite: parsed.onsite ?? [] },
          {
            /* 已采纳布置位置（用户确认过的位置表述）：场地照片不在此列——有照片只代表有参考图 */
            confirmedSpots: [],
            readyMaterialNames: (data.materials ?? []).filter((m) => m.ready).map((m) => m.name ?? ''),
            allMaterialNames: (data.materials ?? []).map((m) => m.name ?? ''),
            requirementNeeds: (data.requirements?.otherNeeds as string | undefined) ?? '',
          }
        );
        const newCopies = { ...data.copies, ...parsed, invite: factRes.invite || parsed.invite, hosting: factRes.hosting || parsed.hosting, onsite: factRes.onsite };
        const timeNote =
          fixedRes.fixed && tr
            ? `；文案中的时间已按流程表推导修正为 ${tr.start}—${tr.end}${tr.crossDay ? '（跨日，次日结束）' : ''}`
            : '';
        /* 内容概述：不只汇报成功，给出实际写了什么（邀请函主旨/主持词变化/指引用途） */
        const inviteBrief = parsed.invite?.trim().replace(/\s+/g, ' ').slice(0, 46);
        const hostingBrief = parsed.hosting?.trim().replace(/\s+/g, ' ').slice(0, 46);
        const onsiteCount = (parsed.onsite ?? []).filter((l) => l?.trim()).length;
        const brief = [
          inviteBrief ? `邀请函围绕「${inviteBrief}」展开` : '',
          hostingBrief ? `主持词改为「${hostingBrief}」的开场脉络` : '',
          onsiteCount > 0 ? `现场指引 ${onsiteCount} 条（签到、动线与注意事项）` : '',
        ]
          .filter(Boolean)
          .join('；') + timeNote + (factRes.fixes.length > 0 ? `；${factRes.fixes.join('；')}` : '');
        if (!hasCopies) {
          /* 初次生成：直接形成初稿 */
          patch({ copies: newCopies });
          toast.success('文案初稿已生成');
          onTaskLog?.(`文案初稿已写好：${brief || '邀请函、主持词与现场指引'}。主题、流程、预算、物料与任务保持原样。`, {
            label: '已更新到活动文案',
            module: 'plan',
          });
        } else {
          /* 已有文案：待确认草稿（展示拟替换内容，确认后写入，取消保留旧稿） */
          onTaskLog?.(
            `新文案已整理好：${brief || '邀请函、主持词与现场指引均已改写'}。确认后替换邀请函、主持词与现场指引（含手动修改）；主题、流程、预算、物料与任务保持不变。`,
            undefined,
            { kind: 'copies', copies: newCopies }
          );
          toast.info('新文案已整理好，请在对话中确认是否替换');
        }
      } else {
        onTaskLog?.(
          '文案生成返回的内容不符合文案格式（没解析出邀请函等正文），现有文案原样保留；可点击下方重试本操作～',
          undefined,
          undefined,
          { kind: 'copies' }
        );
        toast.error('文案生成返回格式异常，可点击重试');
      }
    } catch (e) {
      console.error(e);
      const ei = classifyAiError(e);
      onTaskLog?.(
        `${ei.userMessage}，现有文案完好保留。${ei.waitHint ?? ''}～`,
        undefined,
        undefined,
        { kind: 'copies' }
      );
      toast.error(`${ei.userMessage}，可点击重试`);
    } finally {
      setGenLoading(null);
      onTaskEnd?.();
    }
  };
  const tryGenCopies = () => {
    /* 已有文案：先二次确认再发起 AI 调用，防误触覆盖（新内容生成后仍会先给你过目确认）；
     * 首次生成（无文案）不弹确认，直接形成初稿 */
    if (taskLocked || genLoading) return;
    if (hasCopies) {
      setConfirmState({
        open: true,
        title: '确认重新生成文案？',
        description: '将基于当前主题与流程重写邀请函、主持词与现场指引；现有文案（含手动修改）会在新内容确认后被替换。确定要重新生成吗？',
        confirmText: '确认重新生成',
        destructive: true,
        onConfirm: () => void doGenCopies(),
        onCancel: () => toast.info('已取消，现有文案保持不变'),
      });
      return;
    }
    void doGenCopies();
  };

  /* ---------- 需求值更新（即时写入，用于常驻条上的采纳/冲突确认等即时操作；抽屉字段走草稿） ---------- */
  /* 摘要预算值解析为数字上限（如「80,000 元」「8万」）；
   * 明确未知表达（待定/还没想好等）= 未确定 → 取消旧上限（清除硬约束）；
   * 其他解析失败 = 无效输入 → 不动已有上限（不静默取消有效条件） */
  const UNKNOWN_BUDGET_WORDS = ['待定', '未定', '还没想好', '没想好', '不确定', '未确定', '不知道', '暂无', '再说', '待确认', '以后再说', 'no idea'];
  const isExplicitUnknown = (v: string) => {
    const s = v.trim().toLowerCase();
    return s === '' || UNKNOWN_BUDGET_WORDS.some((w) => s.includes(w));
  };
  const parseBudgetLimit = (v: string): number | null => {
    const s = v.replace(/[,，\s]/g, '');
    const m = s.match(/(\d+(?:\.\d+)?)万/);
    if (m) {
      const n = Number(m[1]) * 10000;
      return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) / 100 : null;
    }
    const m2 = s.match(/^(\d+(?:\.\d+)?)(?:元.*)?$/);
    if (m2) {
      const n = Number(m2[1]);
      /* 0 是有效预算（免费活动）：返回 0 而非 null——不能用 n>0 真假判断吞掉 0 */
      return Number.isFinite(n) && n >= 0 ? n : null;
    }
    return null;
  };
  const setReqRV = (key: keyof ProjectRequirements, value: string) => {
    const current = req[key] as { value: string | null; source: ReqSource } | undefined;
    /* 预算字段：明确未知→取消上限；数字→同步上限；无效输入→不动上限 */
    if (key === 'budget') {
      const budget = data.budget;
      const oldLimit = budget?.limit ?? null;
      let nextLimit = oldLimit;
      if (isExplicitUnknown(value)) {
        nextLimit = null; /* 明确未知：取消旧硬约束（费用明细保留不动） */
      } else {
        const parsed = parseBudgetLimit(value);
        if (parsed != null) nextLimit = parsed;
      }
      patch({
        requirements: {
          ...req,
          [key]: {
            value: value || null,
            source: isExplicitUnknown(value) ? 'undecided' : 'confirmed',
          },
        },
        ...(nextLimit !== oldLimit ? { budget: { ...(budget ?? { limit: null, items: [] }), limit: nextLimit } } : {}),
      });
      void current;
      return;
    }
    patch({
      requirements: {
        ...req,
        [key]: { value: value || null, source: value ? 'confirmed' : 'undecided' },
      },
    });
    void current;
  };
  /* ---------- 需求抽屉草稿操作（编辑不即时落库，保存/取消见抽屉底部按钮） ---------- */
  const setDraftValue = (key: keyof ProjectRequirements, value: string) => {
    if (!draft) return;
    setDraft({ ...draft, [key]: value || undefined });
  };
  const setDraftRV = (key: keyof ProjectRequirements, value: string) => {
    if (!draft) return;
    setDraft({
      ...draft,
      [key]: { value: value || null, source: value ? ('confirmed' as const) : ('undecided' as const) },
    });
  };
  /* 预览「未知条件→去处理」：直接打开全部字段编辑并定位第一个未确定项（不强迫填写，可留空保存/关闭） */
  useEffect(() => {
    if (!reqEditSignal) return;
    setDraft({ ...req });
    setReqOpen(true);
    focusFirstEmptyRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reqEditSignal]);
  /* 弹窗渲染后把焦点放到第一个未填写字段（仅在明确请求定位时，不抢普通打开的焦点） */
  useEffect(() => {
    if (!reqOpen || !focusFirstEmptyRef.current) return;
    const t = setTimeout(() => {
      const inputs = reqBodyRef.current?.querySelectorAll<HTMLInputElement>('input, textarea') ?? [];
      /* 未知=空串或「还没想好/日期待定」类占位串（与预览/PDF 同一判定）：焦点定位相应未知字段，
       * 不因占位串非空而落到开头（活动目标） */
      const empty = Array.from(inputs).find((el) => !el.value.trim() || isUnknownReqText(el.value));
      empty?.focus();
      empty?.scrollIntoView({ block: 'center' });
      focusFirstEmptyRef.current = false;
    }, 60);
    return () => clearTimeout(t);
  }, [reqOpen]);

  const openReqDrawer = (focusFirstEmpty = false) => {
    setDraft({ ...req });
    setReqOpen(true);
    focusFirstEmptyRef.current = focusFirstEmpty;
  };
  const cancelReqDrawer = () => {
    setReqOpen(false);
    setDraft(null);
  };
  const saveReqDrawer = () => {
    if (!draft) return;
    /* 预算字段：与旧表单同规则同步上限（明确未知→取消；数字→更新；无效→不动） */
    const bv = (draft.budget?.value as string | null) ?? '';
    const oldLimit = data.budget?.limit ?? null;
    let nextLimit = oldLimit;
    if (isExplicitUnknown(bv)) nextLimit = null;
    else {
      const parsed = parseBudgetLimit(bv);
      if (parsed != null) nextLimit = parsed;
    }
    patch({
      requirements: draft,
      ...(nextLimit !== oldLimit
        ? { budget: { ...(data.budget ?? { limit: null, items: [] }), limit: nextLimit } }
        : {}),
    });
    setReqOpen(false);
    setDraft(null);
    toast.success('需求摘要已保存');
  };
  const adoptReq = (key: keyof ProjectRequirements) => {
    const rv = req[key] as { value: string | null; source: ReqSource } | undefined;
    if (rv?.source === 'ai') {
      /* 采纳 AI 预算建议时同步解析上限（保持摘要与预算页一致） */
      if (key === 'budget') {
        const limit = parseBudgetLimit(String(rv.value ?? ''));
        if (limit != null) {
          patch({
            requirements: { ...req, [key]: { ...rv, source: 'confirmed' } },
            budget: { ...(data.budget ?? { limit: null, items: [] }), limit },
          });
          toast.success('已采纳为确定信息');
          return;
        }
      }
      patch({ requirements: { ...req, [key]: { ...rv, source: 'confirmed' } } });
      toast.success('已采纳为确定信息');
    }
  };

  /* ---------- 流程编辑 ---------- */
  const updateSchedule = (id: string, p: Partial<ScheduleItem>) => {
    patch({ schedule: schedule.map((s) => (s.id === id ? { ...s, ...p } : s)) });
  };
  const removeSchedule = (id: string) => {
    const target = schedule.find((s) => s.id === id);
    setConfirmState({
      open: true,
      title: '确认删除流程环节？',
      description: `确定要删除流程环节「${target?.name || '未命名'}」吗？删除后该环节不可恢复。`,
      confirmText: '确认删除',
      destructive: true,
      onConfirm: () => patch({ schedule: schedule.filter((s) => s.id !== id) }),
    });
  };
  const moveSchedule = (idx: number, dir: -1 | 1) => {
    const next = [...schedule];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    patch({ schedule: next });
  };
  const addSchedule = () => {
    patch({
      schedule: [
        ...schedule,
        { id: genId(), name: '新环节', time: '', duration: '', note: '' },
      ],
    });
  };

  const copyText = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(`${label}已复制到剪贴板`);
    } catch {
      toast.error('复制失败，请手动选择复制');
    }
  };

  /* 类型冲突确认：选定后写入 requirements.type 并清除待确认（随项目保存，刷新重开保持）；选「还没想好」保持待定、不残留旧硬约束 */
  const resolveTypePending = (choice: string) => {
    const nextReq: ProjectRequirements = { ...req };
    delete nextReq.typePending;
    if (choice === '还没想好') delete nextReq.type;
    else nextReq.type = choice;
    patch({ requirements: nextReq });
    toast.success(choice === '还没想好' ? '活动类型保持待定' : `活动类型已确认：${choice}`);
  };

  const rvEntries = REQ_FIELDS.filter((f) => f.kind === 'rv' && req[f.key]);

  return (
    <div className="flex flex-col gap-6">
      {/* ============ 需求摘要：常驻紧凑条件条（无需展开即可见已知条件与冲突提醒） ============ */}
      <section id="req-summary-anchor" className="relative scroll-mt-20 rounded-2xl border bg-card shadow-sm">
        <div className="flex flex-wrap items-center gap-2 p-4 md:p-5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold">当前条件</span>
            {(() => {
              const items: { label: string; value: string; hint?: string }[] = [];
              if (req.type) items.push({ label: '类型', value: req.type, hint: '已确认' });
              if (req.headcount?.value) items.push({ label: '人数', value: req.headcount.value as string });
              if (req.budget?.value) items.push({ label: '预算', value: req.budget.value as string });
              if (data.budget?.limit != null) items.push({ label: '上限', value: `${data.budget.limit.toLocaleString('zh-CN')} 元` });
              if (req.region?.value) items.push({ label: '地区', value: req.region.value as string });
              if (req.date?.value) items.push({ label: '日期', value: req.date.value as string });
              if (req.visualTheme?.value) items.push({ label: '主题', value: req.visualTheme.value as string });
              if (items.length === 0)
                return <span className="text-xs text-muted-foreground">暂无确定条件——未知也可以继续，随时补充</span>;
              return items.map((it) => (
                <span
                  key={it.label}
                  className="rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary"
                  title={it.hint}
                >
                  {it.label}：{it.value}
                </span>
              ));
            })()}
            {/* 冲突待确认：常驻可见、非阻断（无需展开折叠即可选择） */}
            {req.typePending && (
              <span className="inline-flex flex-wrap items-center gap-1.5 rounded-full border border-amber-500/50 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-700 dark:text-amber-400">
                类型待确认
                {req.typePending.options.map((o) => (
                  <button
                    key={o}
                    type="button"
                    onClick={() => resolveTypePending(o)}
                    className="rounded-full border border-amber-600/50 px-2 py-0.5 font-medium transition-colors hover:bg-amber-500/20"
                  >
                    {o}
                  </button>
                ))}
              </span>
            )}
          </div>
          <Button variant="outline" size="sm" className="shrink-0" onClick={() => openReqDrawer()}>
            <PencilLine className="h-4 w-4" />
            全部字段
          </Button>
        </div>
        {/* 全部字段：完整需求编辑弹窗（居中 Dialog）；未知条件留空可保存，取消/关闭不提交；长内容滚动、按钮常驻 */}
        {reqOpen && draft && (
          <Dialog open onOpenChange={(o) => { if (!o) cancelReqDrawer(); }}>
            <DialogContent className="flex max-h-[90dvh] max-w-[calc(100%-2rem)] flex-col md:max-w-lg">
              <DialogHeader className="text-left">
                <DialogTitle>全部条件字段</DialogTitle>
              </DialogHeader>
              <div ref={reqBodyRef} className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1">
              <div className="grid gap-4 p-4">
              <Field label="活动目标">
                <Textarea value={draft.goal ?? ''} onChange={(e) => setDraftValue('goal', e.target.value)} rows={2} placeholder="这场活动最想实现什么？" />
              </Field>
              <Field label="活动类型">
                <Input value={draft.type ?? ''} onChange={(e) => setDraftValue('type', e.target.value)} placeholder="如：企业年会 / 生日派对" />
              </Field>
              <Field label="活动主题（视觉风格词）">
                <Input
                  value={(draft.visualTheme?.value as string) ?? ''}
                  onChange={(e) => setDraftRV('visualTheme', e.target.value)}
                  placeholder="如：多巴胺 / 森系 / 还没想好可留空"
                />
              </Field>
              <Field label="人数">
                <Input value={(draft.headcount?.value as string) ?? ''} onChange={(e) => setDraftRV('headcount', e.target.value)} placeholder="如：80 人 / 不确定" />
              </Field>
              <Field label="预算">
                <Input value={(draft.budget?.value as string) ?? ''} onChange={(e) => setDraftRV('budget', e.target.value)} placeholder="如：80,000 元 / 待定" />
              </Field>
              <Field label="地区">
                <Input value={(draft.region?.value as string) ?? ''} onChange={(e) => setDraftRV('region', e.target.value)} placeholder="如：杭州" />
              </Field>
              <Field label="日期">
                <Input value={(draft.date?.value as string) ?? ''} onChange={(e) => setDraftRV('date', e.target.value)} placeholder="如：12 月下旬周五晚" />
              </Field>
              <Field label="场地类型">
                <Input value={(draft.venueType?.value as string) ?? ''} onChange={(e) => setDraftRV('venueType', e.target.value)} placeholder="如：酒店宴会厅" />
              </Field>
              <Field label="风格偏好">
                <Input value={(draft.style?.value as string) ?? ''} onChange={(e) => setDraftRV('style', e.target.value)} placeholder="如：温暖现代 / 轻松活泼" />
              </Field>
              <Field label="其他需求／补充说明">
                <Textarea
                  value={draft.otherNeeds ?? ''}
                  onChange={(e) => setDraftValue('otherNeeds', e.target.value)}
                  rows={2}
                  placeholder="如：不要让个人上台、只增加可移动装饰、提前一天进场…（进入后续 AI 当前条件）"
                />
              </Field>
              <Field label="背景故事（可选）">
                <Textarea value={draft.story ?? ''} onChange={(e) => setDraftValue('story', e.target.value)} rows={2} placeholder="寿星喜好、团队氛围、共同回忆…" />
              </Field>
              <Field label="组织介绍（可选）">
                <Textarea value={draft.orgIntro ?? ''} onChange={(e) => setDraftValue('orgIntro', e.target.value)} rows={2} placeholder="组织规模、性质…" />
              </Field>
              <Field label="近期成果（可选）">
                <Textarea value={draft.achievements ?? ''} onChange={(e) => setDraftValue('achievements', e.target.value)} rows={2} placeholder="年会回顾素材、表彰线索…" />
              </Field>
              <Field label="重点人物（可选）">
                <Input value={draft.keyPeople ?? ''} onChange={(e) => setDraftValue('keyPeople', e.target.value)} placeholder="如：陈工（年度技术之星）" />
              </Field>
              <Field label="文案语气（可选）">
                <Input value={draft.tone ?? ''} onChange={(e) => setDraftValue('tone', e.target.value)} placeholder="如：真诚、轻松、带点幽默" />
              </Field>
              <Field label="避免提及（可选）">
                <Input value={draft.avoid ?? ''} onChange={(e) => setDraftValue('avoid', e.target.value)} placeholder="敏感话题、不宜出现的内容" />
              </Field>
              </div>
            </div>
            <div className="flex shrink-0 items-center justify-end gap-2 border-t pt-4">
              <Button variant="outline" onClick={() => cancelReqDrawer()}>
                取消
              </Button>
              <Button onClick={() => saveReqDrawer()}>
                保存
              </Button>
            </div>
          </DialogContent>
        </Dialog>
        )}
      </section>

      {/* 生成完整方案前的补充卡：只列缺失项，可跳过直接要初稿（与对话内请求同一套引导） */}
        <Dialog open={suppOpen} onOpenChange={(o) => !o && setSuppOpen(false)}>
          <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md">
            <DialogHeader>
              <DialogTitle className="text-left">生成前，补几项关键条件？</DialogTitle>
              <DialogDescription className="text-left">
只问最影响安排的 1–2 项（人数影响物料与预算估算，城市影响场地建议），可留空；预算和日期可先待定；也可以先要一份可调整的初稿。
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-3">
              {suppMissing.includes('headcount') && (
                <Field label="大概人数">
                  <Input
                    value={suppDraft.headcount}
                    onChange={(e) => setSuppDraft((d) => ({ ...d, headcount: e.target.value }))}
                    placeholder="如 25 人 / 60 人左右"
                  />
                </Field>
              )}
              {suppMissing.includes('region') && (
                <Field label="所在城市">
                  <Input
                    value={suppDraft.region}
                    onChange={(e) => setSuppDraft((d) => ({ ...d, region: e.target.value }))}
                    placeholder="如 杭州 / 上海"
                  />
                </Field>
              )}
            </div>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setSuppOpen(false);
                  if (suppSelected) void doGenScheme(suppSelected);
                  setSuppSelected(null);
                }}
              >
                还没想好，先给初稿
              </Button>
              <Button onClick={applySuppAndGen}>带着这些条件生成</Button>
            </div>
          </DialogContent>
        </Dialog>

      {/* ============ 候选方向 ============ */}
      <CollapsibleSection
        sectionKey="directions"
        title="候选方向"
        summary={`${directions.length} 个候选方向`}
        open={secOpen('directions')}
        onToggle={(v) => toggleSec('directions', v)}
        fresh={fresh}
        className=""
        bodyClassName="p-4 pt-0 md:p-5 md:pt-0"
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2.5">
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
            方向是活动的策划路线（如桌游派对 / 户外野餐），会决定流程、物料与预算的走向
          </p>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" disabled={genLoading !== null || taskLocked} onClick={genDirections}>
              {genLoading === 'directions' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {directions.length > 0 ? '更新方向' : '生成方向'}
            </Button>
            {directions.length > 0 && (
              <Button
                size="sm"
                disabled={!data.selectedDirectionId || genLoading !== null || taskLocked}
                onClick={() => genScheme()}
                title={data.selectedDirectionId ? undefined : '先在上方选择一个方向'}
              >
                {genLoading === 'scheme' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Wand2 className="h-4 w-4" />}
                生成完整方案
              </Button>
            )}
          </div>
        </div>
        {directions.length === 0 ? (
          <EmptyHint text="还没有候选方向。条件不全也可以开始——直接在右侧和 AI 聊出想法，或让它生成 2-3 个建议供你挑选；已有完整方案时无需重选方向。" />
        ) : (
          <>
            {/* 窄成果栏单列、宽视图三列：@container 按面板自身宽度切换（不缩字号不挤碎） */}
            <div className="grid gap-3 @2xl:grid-cols-3 @md:grid-cols-2">
              {directions.map((d) => {
                const selected = data.selectedDirectionId === d.id;
                const open = dirDetailIds.includes(d.id);
                return (
                  <div
                    key={d.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => patch({ selectedDirectionId: d.id })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        patch({ selectedDirectionId: d.id });
                      }
                    }}
                    className={cn(
                      'flex cursor-pointer flex-col gap-1.5 rounded-xl border p-3.5 text-left transition-all',
                      selected ? 'border-primary ring-2 ring-primary/30' : 'hover:border-primary/40'
                    )}
                  >
                    <span className="flex w-full items-center justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-semibold">{d.name}</span>
                      {selected && <Check className="h-4 w-4 shrink-0 text-primary" />}
                    </span>
                    <span className="line-clamp-1 text-xs text-muted-foreground">{d.style}</span>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setDirDetailIds((prev) => (prev.includes(d.id) ? prev.filter((x) => x !== d.id) : [...prev, d.id]));
                      }}
                      className="mt-0.5 inline-flex w-fit items-center gap-1 text-[11px] font-medium text-muted-foreground transition-colors hover:text-primary"
                    >
                      <ChevronDown className={cn('h-3 w-3 transition-transform', open && 'rotate-180')} />
                      详情{d.difficulty || d.budgetLevel ? `（${[d.difficulty ? `准备 ${d.difficulty}` : '', d.budgetLevel ? `预算 ${d.budgetLevel}` : ''].filter(Boolean).join(' · ')}）` : ''}
                    </button>
                    {open && (
                      <div className="mt-1 flex flex-col gap-2 border-t pt-2">
                        {d.highlights.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {d.highlights.map((h) => (
                              <span key={h} className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary">{h}</span>
                            ))}
                          </div>
                        )}
                        <span className="text-xs leading-relaxed text-muted-foreground">{d.note}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {genLoading === 'scheme' && (
              <div className="mt-3 flex items-start gap-2 rounded-xl border border-primary/30 bg-primary/5 p-3 text-xs leading-relaxed text-primary">
                <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" />
                <span>
                  正在生成完整方案，约需 1–2 分钟，请勿关闭页面。完成后主题、流程、预算、物料、任务与文案会更新到对应模块，并可在右侧对话中继续讨论调整。
                </span>
              </div>
            )}
          </>
        )}
      </CollapsibleSection>

      {/* ============ 主题 ============ */}
      {data.theme && (
        <CollapsibleSection
          sectionKey="theme"
          title="活动主题"
          summary={data.theme?.name ?? '已定主题'}
          open={secOpen('theme')}
          onToggle={(v) => toggleSec('theme', v)}
          fresh={fresh}
          className="overflow-hidden"
          bodyClassName="p-4 pt-0 md:p-5 md:pt-0"
        >
          <div className="mb-3 flex items-center justify-between">
            
            <Button variant="ghost" size="sm" disabled={genLoading !== null || taskLocked} onClick={tryGenTheme}>
              {genLoading === 'theme' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              重新生成
            </Button>
          </div>
          <Input
            value={data.theme.name ?? ''}
            onChange={(e) => patch({ theme: { ...data.theme, name: e.target.value } })}
            className="mb-2 border-0 gradient-text px-0 text-xl font-bold shadow-none focus-visible:ring-0"
            placeholder="主题名"
          />
          <Input
            value={data.theme.slogan ?? ''}
            onChange={(e) => patch({ theme: { ...data.theme, slogan: e.target.value } })}
            className="mb-3 border-0 px-0 text-sm text-muted-foreground shadow-none focus-visible:ring-0"
            placeholder="主题口号"
          />
          <div className="flex flex-wrap items-center gap-1.5">
            {(data.theme.highlights ?? []).map((h, i) => (
              <span key={i} className="group inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-1 text-xs text-primary">
                <input
                  value={h}
                  onChange={(e) => {
                    const next = [...(data.theme?.highlights ?? [])];
                    next[i] = e.target.value;
                    patch({ theme: { ...data.theme, highlights: next } });
                  }}
                  className="w-20 bg-transparent text-primary outline-none"
                />
                <button
                  type="button"
                  onClick={() => {
                    setConfirmState({
                      open: true,
                      title: '确认删除亮点？',
                      description: `确定要删除亮点「${h}」吗？`,
                      confirmText: '确认删除',
                      destructive: true,
                      onConfirm: () =>
                        patch({
                          theme: {
                            ...data.theme,
                            highlights: (data.theme?.highlights ?? []).filter((_, j) => j !== i),
                          },
                        }),
                    });
                  }}
                  className="opacity-50 hover:opacity-100"
                  aria-label="删除亮点"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={() => patch({ theme: { ...data.theme, highlights: [...(data.theme?.highlights ?? []), '新亮点'] } })}
              className="inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-xs text-muted-foreground hover:text-primary"
            >
              <Plus className="h-3 w-3" />
              添加亮点
            </button>
          </div>
        </CollapsibleSection>
      )}

      {/* ============ 流程时间轴 ============ */}
      {schedule.length > 0 && (
        <CollapsibleSection
          sectionKey="schedule"
          title="活动流程"
          summary={`${schedule.length} 个环节`}
          open={secOpen('schedule')}
          onToggle={(v) => toggleSec('schedule', v)}
          fresh={fresh}
          className="overflow-hidden"
          bodyClassName="p-4 pt-0 md:p-5 md:pt-0"
        >
          <div className="mb-4 flex items-center justify-between">
            
            <Button variant="outline" size="sm" onClick={addSchedule}>
              <Plus className="h-4 w-4" />
              添加环节
            </Button>
          </div>
          <ol className="flex flex-col gap-2">
            {schedule.map((s, i) => (
              <li key={s.id} className="flex flex-col gap-2 rounded-xl border bg-background p-3">
                {/* 按容器实际宽度弹性换行（窄成果栏下自动折行，不再按视口断点横排撑破） */}
                <div className="flex flex-wrap items-center gap-2">
                  <Input value={s.time} onChange={(e) => updateSchedule(s.id, { time: e.target.value })} className="w-20 shrink-0 text-center text-xs" placeholder="时间" />
                  <Input value={s.name} onChange={(e) => updateSchedule(s.id, { name: e.target.value })} className="min-w-[7.5rem] flex-1 text-sm font-medium" placeholder="环节名" />
                  <Input value={s.duration} onChange={(e) => updateSchedule(s.id, { duration: e.target.value })} className="w-24 shrink-0 text-center text-xs" placeholder="时长" />
                </div>
                <div className="flex items-center justify-between gap-1">
                  <Input value={s.note} onChange={(e) => updateSchedule(s.id, { note: e.target.value })} className="min-w-0 flex-1 text-sm text-muted-foreground" placeholder="组织要点" />
                  <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => moveSchedule(i, -1)} disabled={i === 0} aria-label="上移">
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => moveSchedule(i, 1)} disabled={i === schedule.length - 1} aria-label="下移">
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive hover:text-destructive" onClick={() => removeSchedule(s.id)} aria-label="删除环节">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ol>
        </CollapsibleSection>
      )}

      {/* ============ 文案 ============ */}
      <CollapsibleSection
        sectionKey="copies"
        title="活动文案"
        summary={data.copies?.invite ? '已生成文案' : '未生成文案'}
        open={secOpen('copies')}
        onToggle={(v) => toggleSec('copies', v)}
        fresh={fresh}
        className=""
        bodyClassName="p-4 pt-0 md:p-5 md:pt-0"
      >
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          
          <Button variant="outline" size="sm" disabled={genLoading !== null || taskLocked} onClick={tryGenCopies}>
            {genLoading === 'copies' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
            {hasCopies ? '重新生成文案' : '生成文案'}
          </Button>
        </div>
        {(data.copies?.invite?.trim() || data.copies?.hosting?.trim() || (data.copies?.onsite ?? []).some((l) => l.trim())) ? (
          <div className="flex flex-col gap-4">
          <Field label="邀请函">
            <div className="flex gap-2">
              <Textarea value={data.copies?.invite ?? ''} onChange={(e) => patch({ copies: { ...data.copies, invite: e.target.value } })} rows={5} placeholder="邀请函全文" className="flex-1" />
              <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => copyText(data.copies?.invite ?? '', '邀请函')} aria-label="复制邀请函">
                <ClipboardCopy className="h-4 w-4" />
              </Button>
            </div>
          </Field>
          <Field label="主持词">
            <div className="flex gap-2">
              <Textarea value={data.copies?.hosting ?? ''} onChange={(e) => patch({ copies: { ...data.copies, hosting: e.target.value } })} rows={4} placeholder="主持开场词" className="flex-1" />
              <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => copyText(data.copies?.hosting ?? '', '主持词')} aria-label="复制主持词">
                <ClipboardCopy className="h-4 w-4" />
              </Button>
            </div>
          </Field>
          <Field label="现场指引">
            <div className="flex flex-col gap-2">
              {(data.copies?.onsite ?? []).map((line, i) => (
                <div key={i} className="flex gap-2">
                  <Input
                    value={line}
                    onChange={(e) => {
                      const next = [...(data.copies?.onsite ?? [])];
                      next[i] = e.target.value;
                      patch({ copies: { ...data.copies, onsite: next } });
                    }}
                    placeholder={`现场指引 ${i + 1}`}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-9 w-9 shrink-0 text-destructive hover:text-destructive"
                    onClick={() => {
                      setConfirmState({
                        open: true,
                        title: '确认删除现场指引？',
                        description: '确定要删除此条现场指引文案吗？',
                        confirmText: '确认删除',
                        destructive: true,
                        onConfirm: () =>
                          patch({
                            copies: {
                              ...data.copies,
                              onsite: (data.copies?.onsite ?? []).filter((_, j) => j !== i),
                            },
                          }),
                      });
                    }}
                    aria-label="删除指引"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" className="self-start" onClick={() => patch({ copies: { ...data.copies, onsite: [...(data.copies?.onsite ?? []), ''] } })}>
                <Plus className="h-4 w-4" />
                添加指引
              </Button>
            </div>
          </Field>
          </div>
        ) : (
          <p className="rounded-xl border border-dashed p-4 text-sm leading-relaxed text-muted-foreground">
            还没有生成文案。先和右侧 AI 聊定方向与要点，再点「生成文案」按需产出——未生成前不铺开空框。
          </p>
        )}
      </CollapsibleSection>

      {/* 真实 UI 警示确认弹窗（替代原生 window.confirm） */}
      <ConfirmDialog
        open={confirmState.open}
        onOpenChange={(open) => {
          /* 假取消根因：确认路径也会走 onOpenChange(false)。用确认标志区分——
           * 只有「非确认关闭」（点取消/遮罩/ESC）才算真实取消，触发取消回调 */
          if (!open && !confirmRef.current) confirmState.onCancel?.();
          confirmRef.current = false;
          setConfirmState((s) => ({ ...s, open }));
        }}
        title={confirmState.title}
        description={confirmState.description}
        confirmText={confirmState.confirmText}
        destructive={confirmState.destructive}
        onConfirm={() => {
          confirmRef.current = true;
          confirmState.onConfirm();
        }}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
      <Sparkles className="h-4 w-4 shrink-0 text-primary" />
      {text}
    </div>
  );
}
