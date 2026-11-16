import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  PenLine,
  ArrowDown,
  Check,
  Clock3,
  Download,
  ExternalLink,
  Eye,
  Handshake,
  ImagePlus,
  Lightbulb,
  Loader2,
  Paperclip,
  Pencil,
  RotateCcw,
  Send,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Tag,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { AiAvatar, UserAvatar } from '@/components/auth/Avatars';
import CompareCanvas from '@/components/scene/CompareCanvas';
import { PendingImageBar } from '@/components/shared/PendingImageBar';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Slider } from '@/components/ui/slider';
import { Textarea } from '@/components/ui/textarea';
import MarkdownText from '@/components/workbench/MarkdownText';
import { cleanEmphasisText } from '@/services/textFormat';
import { MaterialCard } from '@/components/workbench/ResourceCards';
import { ASSETS } from '@/data/assets';
import { INSPIRATIONS } from '@/data/inspiration';
import type { PartnerResource } from '@/data/partnerCatalog';
import { matchPartnerCatalog, PARTNER_CATALOG, PARTNER_NEGATION_RE } from '@/data/partnerCatalog';
import { getMaterialMatches, MATERIAL_RESOURCES, type MaterialResource } from '@/data/resources';
import { fromQuery } from '@/services/returnContext';
import { usePendingImage } from '@/hooks/usePendingImage';
import { cn } from '@/lib/utils';
import type { ReplyDetail } from '@/services/ai';
import { aiChat, parseAdjustCard, parseSuggestedDirections, stripAdjustBlock } from '@/services/ai';
import { genId, understandImage } from '@/services/api';
import { extractScope, classifyUserIntent, extractExplicitFacts, parseNonNegativeNum, safeAmount } from '@/services/facts';
import { planChangeLines, snapshotOrig, normName } from '@/services/adjustPatch';
import { normalizeTags } from '@/services/sceneTags';
import type { AdjustCard, ChatMessage, Direction, ProjectData } from '@/types/types';

const QUICK_REPLIES = ['还没想好', '给我一些建议', '先跳过这个'];

/** 回复详略三档标签（默认适中，只影响下一次回复，不改历史） */
const DETAIL_OPTIONS: { key: ReplyDetail; label: string }[] = [
  { key: 'brief', label: '简短' },
  { key: 'medium', label: '适中' },
  { key: 'detailed', label: '详细' },
];
/** 滑块档位索引（与 DETAIL_OPTIONS 顺序对应） */
const DETAIL_INDEX: Record<ReplyDetail, number> = { brief: 0, medium: 1, detailed: 2 };


/** 用户主动询问购买 / 场地时才展示资源提示，不每轮插卡 */
const RESOURCE_HINT_RE = /买|购买|采购|哪里买|哪儿买|订购|租赁|租借|预订|场地|渠道|采购清单/;

/** 展示层隐藏内部协议控制行（「建议方向：」结构化行已解析为候选卡；「参考灵感：」解析为可点击标签；不再在正文重复露出；仅影响展示，不改历史数据与解析） */
/** 生图意图识别：与触发布置效果图生成的请求匹配（send 与 retryLast 共用） */
const SCENE_GEN_RE = /(生成|制作|出|渲染|看看|做个).*(布置|效果图|场景图|现场图)|(布置效果图|场地效果图|场景效果图)/i;
/** 明确请求生成完整方案（不含布置效果图）：与右侧「生成方案」按钮走同一套流程 */
const SCHEME_GEN_RE = /(生成|整理|制定|做|给我|出).*(完整方案|方案|计划)|(帮我生成方案|按.{1,12}方向.{0,8}(生成|整理|制定))/i;
/** 否定生成语义：明确说「不/别/无需…生成方案/图片」的请求不进入生成分发（防止关键词命中却忽略否定，普通调整走对话且只产生一份反馈） */
const NEG_GEN_RE =
  /(不|不用|无需|无须|别|先不|暂不|暂时不|尚未|还没)[^。！？!?;；\n]{0,10}(生成|重新生成|制作|弄|出|做)[^。！？!?;；\n]{0,8}(方案|完整方案|计划|图|图片|效果图)/;
/** 条件字段中文名（同步反馈展示） */
const FACT_LABEL: Record<string, string> = { headcount: '人数', budget: '预算', region: '地区', date: '时间', otherNeeds: '其他要求' };
/** 调整卡未完成模块的中文标签（用户可见文案不暴露内部字段名） */
const UNDONE_LABEL: Record<string, string> = {
  schedule: '流程',
  budget: '费用',
  materials: '物料',
  scene: '布置要求',
  theme: '主题',
  visualTheme: '配色',
  copies: '文案',
  tasks: '任务',
};

const stripProtocolLines = (text: string) => {
  const stripped = stripAdjustBlock(text);
  /* 流式期间协议块未收齐（```调整建议 未闭合）：stripAdjustBlock 剥不掉，
   * 从任意未闭合代码围栏起点整段截断，绝不把半截 JSON 渲染给用户；收齐后走正常剥离 */
  const openIdx = stripped.indexOf('```');
  const safe = openIdx >= 0 ? stripped.slice(0, openIdx).trimEnd() : stripped;
  return safe
    .split('\n')
    .filter((line) => !/^建议方向[：:]/.test(line.trim()) && !/^参考灵感[：:]/.test(line.trim()))
    .join('\n');
};

/** 从回复中解析真实参考过的灵感条目（标题须与灵感库完全一致才渲染可点击标签，无匹配不伪造来源） */
const parseInspirationRefs = (text: string): Array<{ id: string; title: string }> => {
  const lines = text.split('\n');
  const out: Array<{ id: string; title: string }> = [];
  for (const line of lines) {
    const m = line.trim().match(/^参考灵感[：:](.+)$/);
    if (!m) continue;
    for (const raw of m[1].split(/[、,，;；]/)) {
      const title = raw.trim();
      if (!title) continue;
      const hit = INSPIRATIONS.find((e) => e.title === title);
      if (hit && !out.some((x) => x.id === hit.id)) out.push({ id: hit.id, title });
    }
  }
  return out;
};

interface AiAssistantProps {
  data: ProjectData;
  /** 当前成果页签：站内引用跳转携带来源模块，返回时回原模块（不写死 plan） */
  activeTab: 'plan' | 'scene' | 'budget';
  /** 发送后回调（更新 chatLog 等） */
  onChatLogAppend: (msg: ChatMessage, patchFor?: { id: string; patch: Partial<ChatMessage> }) => void;
  /** 主题/文案待确认草稿的确认动作（此刻才真正写入成果；取消在组件回调内标记状态） */
  onDraftApply?: (msgId: string, draft: NonNullable<ChatMessage['draftCard']>) => void;
  /** 就地更新一条消息（图像识别结果回写并持久化） */
  onChatLogUpdate: (id: string, patch: Partial<ChatMessage>) => void;
  /** AI 建议了活动主题词时回调，写回需求摘要（source: 'ai'，待确认） */
  onSuggestedTheme?: (theme: string) => void;
  /** 成果更新标签「查看」入口：切到对应成果页签（Workbench 受控 modTab） */
  onViewModule?: (module: 'plan' | 'scene' | 'budget') => void;
  /** 调整建议卡回调：apply 写入成果 / skip 保持不变 / edit 待补充；返回成功与更新位置 */
  onAdjust?: (
    card: AdjustCard,
    action: 'apply' | 'skip' | 'edit'
  ) => Promise<{ ok: boolean; modules: Array<'plan' | 'scene' | 'budget'>; failed?: string[]; undoneFields?: string[] }>;
  /** 对话中明确请求生成完整方案：返回 true 表示已由方案模块接手（同一生成流程与忙碌锁） */
  onSchemeGen?: (text: string) => boolean;
  /** 对话中明确请求单独生成文案（不重写方案其余部分）：复用文案按钮同一流程 */
  onCopiesGen?: (text: string) => boolean;
  /** 对话明确「只改主题」→ 主题草稿确认链路（与主题按钮同一流程） */
  onThemeGen?: (text: string) => boolean;
  /** AI 输出「建议方向：」结构化行时回调，合并进候选方向区 */
  onSuggestedDirections?: (ds: Direction[]) => void;
  /** 用户随消息发送场地照片时回调（更新 scene.beforeUrl 并清空旧效果图） */
  onSceneImage?: (url: string) => void;
  /** 条件同步：用户消息中明确给出的条件（人数/预算/其他需求约束）写回需求摘要；返回实际写入的字段（无变更返回空） */
  onConditionSync?: (facts: {
    fields: string[];
    headcount: string | null;
    budgetLimit: number | null;
    budgetKind?: 'hard' | 'reference' | null;
    otherNeeds: string | null;
    region?: string | null;
    date?: string | null;
    duration?: string | null;
  }) => string[] | void;
  /** 打开需求摘要抽屉（同步标签「查看」入口） */
  onOpenRequirements?: () => void;
  /** 在对话中发起「生成布置效果」（可编辑要求预览，用户确认才真正生图） */
  onOpenSceneGenerate?: () => void;
  /** AI 伙伴直接调用同源布置生图服务 */
  onTriggerSceneGen?: (opts?: {
    density?: 'simple' | 'medium' | 'rich';
    tags?: string[];
    extra?: string;
  }) => Promise<{ ok: boolean; message?: string; needsBefore?: boolean; busy?: boolean }>;
  /** 全局任务锁：任一 AI 任务（含生图）进行中为 true，禁用发送与全部生成入口 */
  taskLocked?: boolean;
  /** 当前任务说明（锁激活时展示，如「AI 正在思考…」/「布置效果图生成中…」） */
  taskLabel?: string;
  /** 文本任务开始/结束回调（Workbench 全局登记，驱动所有入口互斥） */
  onTaskBegin?: (label: string) => void;
  onTaskEnd?: () => void;
  /** 仅项目新建进入时允许首条消息自动回应；刷新/重开不自动生成（防回复丢失后重复扣调用），走未完成横幅手动继续 */
  autoRespondEnabled?: boolean;
  /** 用户昵称（来自当前登录/访客资料；空则不称呼） */
  nickname?: string | null;
}

export default function AiAssistant({
  data,
  activeTab,
  onChatLogAppend,
  onDraftApply,
  onChatLogUpdate,
  onAdjust,
  onSuggestedTheme,
  onSuggestedDirections,
  onSceneImage,
  onConditionSync,
  onOpenRequirements,
  onOpenSceneGenerate,
  onViewModule,
  onTriggerSceneGen,
  onSchemeGen,
  onCopiesGen,
  onThemeGen,
  taskLocked = false,
  taskLabel,
  onTaskBegin,
  onTaskEnd,
  autoRespondEnabled = true,
  nickname,
}: AiAssistantProps) {
  /** 调整卡操作：确认→回调写入并更新消息状态；失败保留卡片并指出未完成项 */
  /* 确认应用会话内锁（不再把「应用中」持久化到消息：刷新截断保存队列曾导致卡在应用中无恢复入口） */
  const adjustInFlightRef = useRef<Set<string>>(new Set());
  const handleAdjust = async (msgId: string, card: AdjustCard, action: 'apply' | 'skip' | 'edit') => {
    if (action === 'edit') {
      onChatLogUpdate(msgId, { adjustCard: { ...card, status: 'editing' } });
      textAreaFocusRef.current?.focus();
      return;
    }
    if (action === 'skip') {
      onChatLogUpdate(msgId, { adjustCard: { ...card, status: 'skipped' } });
      toast.info('好的，本次不调整，已有成果保持不变');
      return;
    }
    /* 幂等保护：已应用且无未完成项、或应用中，均不可再次执行（重复点击不重复应用） */
    if (card.status === 'applied' && !(card.undoneFields && card.undoneFields.length > 0)) {
      toast.info('这条建议已应用过，无需重复确认～');
      return;
    }
    if (adjustInFlightRef.current.has(msgId)) return; /* 双击防重（内存锁，刷新后由幂等识别兜底） */
    /* 建议未包含任何可写字段（如只描述时长未给流程数据）：明确说明并保持待确认，不再无声点击 */
    if (Object.keys(card.plan ?? {}).length === 0) {
      toast.info('这条建议没有可写入的具体变更（缺流程/费用等数据），请继续对话说明要改的具体内容，我重新给出可确认的调整');
      return;
    }
    /* 应用中不再落库（消息保持待确认态）：真正持久化成功才写「已应用」；等待期间由内存锁+toast 防重 */
    adjustInFlightRef.current.add(msgId);
    toast.loading('正在应用调整…', { id: 'adj-apply' });
    let r: Awaited<ReturnType<NonNullable<typeof onAdjust>>> | undefined;
    try {
      r = await onAdjust?.(card, 'apply');
    } catch (e) {
      console.error(e);
      onChatLogUpdate(msgId, { adjustCard: { ...card, status: 'failed', failReason: '应用出现异常' } });
      toast.error('调整应用出现异常，成果保持原样，可在卡片中重试', { id: 'adj-apply' });
      return;
    } finally {
      adjustInFlightRef.current.delete(msgId);
    }
    if (!r) {
      onChatLogUpdate(msgId, { adjustCard: { ...card, status: 'failed', failReason: '调整处理未就绪' } });
      toast.error('调整处理未就绪，请稍后重试', { id: 'adj-apply' });
      return;
    }
    const remain = (r.undoneFields ?? []).length > 0;
    if (r.ok || r.modules.length > 0) {
      /* 全部或部分写入成功：状态固化；未完成项记入 undoneFields（配 failReason 明细），重试只处理这些；
       * 重试基线只校验未完成项（已成功写入的内容跳过校验，不再误判为「等待期间被修改」） */
      onChatLogUpdate(msgId, {
        adjustCard: {
          ...card,
          status: 'applied',
          undoneFields: remain ? r.undoneFields : undefined,
          failReason: remain ? (r.failed ?? []).join('、') : undefined,
        },
        actionTag: { label: remain ? `部分完成：${card.change.slice(0, 12)}` : `已调整：${card.change.slice(0, 14)}`, module: r.modules[0] ?? 'plan' },
      });
      if (!r.ok)
        toast.warning(
          `部分内容未完成：${(r.failed ?? []).join('、') || '写入失败'}。已成功的部分保持不变，可在卡片中重试未完成项（不会重复执行）`,
          { id: 'adj-apply', duration: 6000 }
        );
      else toast.success('调整已写入对应成果', { id: 'adj-apply' });
    } else {
      /* 全部失败（含范围越界/等待期间内容已变）：成果原样未动，卡片标记失败原因，可重试或重新发起 */
      const reason = (r.failed ?? []).join('、') || '写入失败';
      onChatLogUpdate(msgId, { adjustCard: { ...card, status: 'failed', failReason: reason } });
      toast.error(`未能更新：${reason}，成果保持原样`, { id: 'adj-apply' });
    }
  };
  const textAreaFocusRef = useRef<HTMLTextAreaElement | null>(null);
  /* send 阶段前置同步成功的字段：挂到随后 respond 产出的助手消息上（同一请求一份反馈） */
  const pendingSyncRef = useRef<string[] | null>(null);

  const [input, setInput] = useState(() => {
    /* 跨页返回恢复：读取为本项目保存的输入草稿（离开工作区时落 sessionStorage） */
    try {
      return sessionStorage.getItem(`sf-draft-${data.id}`) ?? '';
    } catch {
      return '';
    }
  });
  const [streaming, setStreaming] = useState(false);
  /* 输入草稿持久化（sessionStorage）：跨页返回工作区时恢复未发送内容 */
  useEffect(() => {
    try {
      if (input) sessionStorage.setItem(`sf-draft-${data.id}`, input);
      else sessionStorage.removeItem(`sf-draft-${data.id}`);
    } catch {
      /* ignore */
    }
  }, [input, data.id]);

  const [streamText, setStreamText] = useState('');
  const [error, setError] = useState<{ short: string; detail?: string } | null>(null);
  /** 独立图像理解服务正在读取照片（真实看图阶段，与文字流式分开提示） */
  const [visionWorking, setVisionWorking] = useState(false);
  /** 用户主动询问购买时匹配到的物料参考 */
  const [resourceHint, setResourceHint] = useState<MaterialResource[] | null>(null);
  /** 回复详略档位（默认适中，仅影响下次自由讨论，不改历史） */
  const [detail, setDetail] = useState<ReplyDetail>('medium');
  /** 最近一条已同步条件的反馈标签（fields 由程序判定，只有真实写入才显示） */
  const [syncedFields, setSyncedFields] = useState<{ msgId: string; fields: string[] } | null>(null);
  /* 已忽略的未完成提示消息 id（用户点「知道了」后本次会话不再提示；不自动重发） */
  const dismissedInterruptRef = useRef<string | null>(null);
  /** 待随下一条消息发送的场地照片（四态状态机，与策划起点/场景区一致） */
  const venue = usePendingImage('venue');
  /** 欢迎形象加载失败时回退圆形头像 */
  const [welcomeFailed, setWelcomeFailed] = useState(false);
  /** 对话内效果图大图弹窗 */
  const [bigPreview, setBigPreview] = useState<string | null>(null);
  /** 详略滑块是否正在滑动（用于动态浮层显示档位，不常驻显示） */
  const [sliding, setSliding] = useState(false);
  const slideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** AI 对话中展示的生图材料清单与轻量合作商 Badge 标签 */
  const aiMaterials = useMemo(() => {
    const scene = data.scene ?? {};
    const lrTags = normalizeTags(scene.lastReq?.tags);
const scTags = normalizeTags(scene.tags);
const activeTags = lrTags.length > 0 ? lrTags : scTags.length > 0 ? scTags : ['氛围装饰', '灯光'];
    const items: Array<{
      name: string;
      category?: string;
      partner?: { name: string; url: string; platform: string };
    }> = [];

    for (const t of activeTags) {
      const matched = PARTNER_CATALOG.find(
        (p) => p.category === 'online' && p.keywords.some((k) => t.includes(k) || k.includes(t))
      );
      /* 对齐原则：推广链接只来自合作伙伴目录；未命中则不挂推广标签，不回退到泛品类条目 */
      items.push({
        name: t.length <= 3 ? `${t}饰品/组合` : t,
        partner: matched ? { name: matched.name, url: matched.url, platform: matched.urlLabel } : undefined,
      });
    }

    for (const m of (data.materials ?? []).slice(0, 3)) {
      if (!items.some((it) => it.name.includes(m.name))) {
        const matched = PARTNER_CATALOG.find(
          (p) => p.category === 'online' && p.keywords.some((k) => m.name.includes(k))
        );
        items.push({
          name: m.name,
          category: m.category,
          partner: matched ? { name: matched.name, url: matched.url, platform: matched.urlLabel } : undefined,
        });
      }
    }
    return items;
  }, [data.scene, data.materials]);

  const downloadSceneImg = async (url: string) => {
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
      toast.success('已开始下载布置图');
    } catch {
      toast.error('下载失败，可右键图片另存');
    }
  };
  const scrollRef = useRef<HTMLDivElement>(null);
  const accRef = useRef('');
  const fileRef = useRef<HTMLInputElement>(null);
  /** 初始描述自动回应防重（避免重复渲染/StrictMode 下重复请求） */
  const autoRespondedRef = useRef(false);

  const chatLog = data.chatLog ?? [];

  /* 流式滚动跟随：用户在底部（或接近底部）时跟随新内容；主动上滚后停止跟随，
   * 出现「有新回复」回到底部入口，点击或手动滚回底部才恢复——不抢滚动位置 */
  const stickToBottomRef = useRef(true);
  const [showJumpDown, setShowJumpDown] = useState(false);
  const onScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    stickToBottomRef.current = nearBottom;
    if (nearBottom) setShowJumpDown(false);
  };
  const scrollIfSticking = () => {
    const el = scrollRef.current;
    if (el && stickToBottomRef.current) el.scrollTop = el.scrollHeight;
  };
  const jumpToLatest = () => {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current = true;
    setShowJumpDown(false);
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  };

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (stickToBottomRef.current) el.scrollTop = el.scrollHeight;
    else setShowJumpDown(true);
  }, [chatLog.length, streamText, resourceHint, venue.img?.status]);

  /** 请求 AI 回复（不追加用户消息）；history 为完整对话历史，末条必须是用户消息 */
  const respond = async (history: ChatMessage[]) => {
    const last = history[history.length - 1];
    if (!last || last.role !== 'user' || (last.content.trim() === '' && !last.imageUrl)) return;
    /* 每个分支都有可理解反馈：忙/占用不静默 return（「继续」无响应的根因） */
    if (streaming) {
      toast.info('正在回复中，请稍候…');
      return;
    }
    /* 全局任务锁兜底：其余 AI 任务进行中不并发回复（不排队、不重发，说明状态与下一步） */
    if (taskLocked) {
      toast.info(`${taskLabel ?? 'AI 任务'}进行中，这条回复暂未发出；任务完成后点击「继续」即可恢复，不会重复计费`);
      return;
    }
    setStreaming(true);
    onTaskBegin?.('AI 正在思考…');
    setStreamText('');
    setError(null);
    accRef.current = '';
    try {
      /* 当前消息带图但缺真实识别结果：先真实看图；失败即中止，不以纯文字代替发送，也不假装看过 */
      let lastMsg = last;
      if (lastMsg.imageUrl && !lastMsg.vision) {
        setVisionWorking(true);
        let vision: string;
        try {
          vision = await understandImage(lastMsg.imageUrl);
    } catch (e) {
      const full = e instanceof Error && e.message ? e.message : '识图失败';
      setError({ short: '看图失败，请点击重试（不会降级为纯文字发送）', detail: full });
      toast.error('看图失败，可点击气泡下方重试');
      return;
} finally {
  setVisionWorking(false);
}
onChatLogUpdate(lastMsg.id, { vision });
lastMsg = { ...lastMsg, vision };
}
/* 历史带图消息缺识别结果时补看，保留历史视觉上下文（每张图只看一次并持久化；旧图失败不阻塞当前对话） */
let historyBase = history.slice(0, -1);
const needVision = historyBase.filter((m) => m.imageUrl && !m.vision).slice(-3);
if (needVision.length > 0) {
  setVisionWorking(true);
  for (const m of needVision) {
    try {
      if (!m.imageUrl) continue;
      const vision = await understandImage(m.imageUrl);
      onChatLogUpdate(m.id, { vision });
      historyBase = historyBase.map((h) => (h.id === m.id ? { ...h, vision } : h));
} catch (e) {
  console.warn('历史消息看图失败，本次对话暂缺该图上下文', e);
}
}
setVisionWorking(false);
}
/* 本次请求动作边界（供提示词与回复解析守卫共用）：无生成请求的纯聊天才接受建议写入；
 * 用户明确禁止的动作（如不生成图片）在回落对话中继续遵守 */
const respondIntent = classifyUserIntent(lastMsg.content);
const intent = respondIntent;
/* 本次用户消息经 userText 传入，历史需去掉末条避免重复；场地照片以真实识别结果文本传入 */
const result = await aiChat(
  'chat',
  { ...data, chatLog: historyBase },
  lastMsg.content,
  (delta) => {
    accRef.current += delta;
    setStreamText(accRef.current);
    scrollIfSticking();
},
  lastMsg.vision,
  {
    detail,
    nickname,
    memOnly: respondIntent.memOnly,
    /* 用户明确禁止的生成动作在回落对话中继续遵守 */
    noScene: respondIntent.sceneNegated,
  }
);
/* 调整建议块 → 结构化确认卡（确认前不写入成果；正文剥离围栏由卡片呈现）；
 * sourceText=触发本建议的用户原文（范围校验依据）；orig=目标原值快照（应用前比对防覆盖手工编辑） */
/* 兜底：剥离模型照抄的提示词残句（如「（如果昵称未知则用"你"）」），不损伤正常正文 */
const sanitized = result.text
  .replace(/[（(][^（）()]*(?:昵称未知|提示词|占位|准则\d+|模板)[^（）()]*[)）]/g, '')
  .replace(/\s{2,}/g, ' ')
  .trim();
const adjust = parseAdjustCard(sanitized, lastMsg.content);
const aiMsg: ChatMessage = {
  id: `a-${Date.now()}`,
  role: 'assistant',
  content: adjust ? stripAdjustBlock(sanitized) : sanitized,
  ts: Date.now(),
  ...(adjust ? { adjustCard: { ...adjust, status: 'pending' as const, orig: snapshotOrig(adjust.plan, data) } } : {}),
};
onChatLogAppend(aiMsg);
/* 条件同步已在 send 阶段前置完成（生成与对话用同一份最新状态）；此处只把同步结果标签挂到本条回复 */
if (pendingSyncRef.current && pendingSyncRef.current.length > 0) {
  setSyncedFields({ msgId: aiMsg.id, fields: pendingSyncRef.current });
  pendingSyncRef.current = null;
}
/* AI 建议了活动主题词时写回需求摘要（待用户采纳确认；多候选保持建议态展示，不拼成已确定条件，不把分隔符漏给用户） */
const themeMatch = sanitized.match(/建议主题[：:]\s*([^\n（()，,。；;]{2,24})/);
if (themeMatch && onSuggestedTheme && intent.allowSuggest) {
  /* 与建议方向同一兜底：真实写入摘要后，给本会话消息挂标签（自由讨论路径原本漏挂） */
  if (aiMsg?.id) {
    onChatLogAppend(aiMsg, {
      id: aiMsg.id,
      patch: { actionTag: { label: '已更新到需求摘要', module: 'plan' } },
    });
  }
  const raw = themeMatch[1].trim();
  const candidates = raw
    .split(/[|｜/／、]/)
    .map((w) => w.trim())
    .filter(Boolean);
if (candidates.length > 0) {
  const themeWord = candidates.join(' / ');
  const currentRV = data.requirements?.visualTheme;
  const current = (currentRV?.value as string | undefined) ?? '';
  /* 已确认的主题与用户局部改动不自动覆盖 */
  if (currentRV?.source !== 'confirmed' && themeWord !== current) {
    onSuggestedTheme(themeWord);
    toast.info(
      candidates.length > 1
        ? `已把「${themeWord}」记为需求摘要里的建议主题词（${candidates.length} 个候选，与右侧活动主题成果相互独立，采纳需你在摘要中确认）`
        : `已将「${themeWord}」记为需求摘要里的建议主题词（与右侧活动主题成果相互独立，采纳需你在摘要中确认）`
);
}
}
}
/* 「建议方向：」结构化行 → 合并进候选方向区；
 * 同时给本会话中的助手消息挂上「已更新到候选方向」标签（初次进入/自由讨论都会漏挂，统一兜底） */
if (onSuggestedDirections && intent.allowSuggest) {
  const ds = parseSuggestedDirections(sanitized, genId);
  if (ds.length > 0) {
    onSuggestedDirections(ds);
    toast.info(`已把 ${ds.length} 个建议方向加入「候选方向」，可在方案页签查看`);
    /* 响应后给已写入的消息补标签：数据已落库、右侧已填充，标签必须同步出现 */
    if (aiMsg?.id) {
      onChatLogAppend(aiMsg, {
        id: aiMsg.id,
        patch: { actionTag: { label: '已更新到候选方向', module: 'plan' } },
      });
    }
  }
}
} catch (e) {
  console.error(e);
  /* 简短提示在前，HTTP/JSON 细节折叠供排查，不占满对话 */
  const full = e instanceof Error && e.message ? e.message : 'AI 回复失败';
  const firstLine = full.split('\n')[0].slice(0, 60);
  const short = /HTTP|Invalid request|网络|请求/i.test(firstLine) ? 'AI 回复失败，请点击重试' : firstLine;
  setError({ short, detail: full });
  toast.error('AI 回复失败，可点击气泡下方重试');
} finally {
  setStreaming(false);
  setStreamText('');
  setVisionWorking(false);
  accRef.current = '';
  onTaskEnd?.();
}
};

  /* 用户直接点击重试：按原任务类型分发（使用发送时已记录的动作意图，不重新猜测、不降级成普通回复）。
   * 幂等：方案/文案入口有全局任务锁与进程内 signal，进行中不重复触发；生图沿用只一条结果的守卫 */
  const retryLast = () => {
    const lastUser = [...chatLog].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    const it = classifyUserIntent(lastUser.content);
    /* 生图类请求：任务进行中或已有结果时不重发（同一任务只一条结果；主动重生成走场景卡入口） */
    if (it.allowScene && (data.scene?.genTask?.status === 'querying' || data.scene?.afterUrl)) {
      dismissedInterruptRef.current = lastUser.id;
      toast.info(data.scene?.genTask?.status === 'querying' ? '布置效果图正在生成中，完成后会自动呈现' : '该消息已生成过布置效果图；需要新版本请在场景卡主动重新生成');
      return;
    }
    /* 方案/文案任务失败后的「重试」继续原任务类型、目标范围与禁止项（同任务同一套确认与保存流程） */
    if (it.allowScheme && onSchemeGen) {
      dismissedInterruptRef.current = lastUser.id;
      if (onSchemeGen(lastUser.content)) return;
    }
    if (it.allowTheme && onThemeGen) {
      dismissedInterruptRef.current = lastUser.id;
      if (onThemeGen(lastUser.content)) return;
    }
    if (it.allowCopies && onCopiesGen) {
      dismissedInterruptRef.current = lastUser.id;
      if (onCopiesGen(lastUser.content)) return;
    }
    const idx = chatLog.findIndex((m) => m.id === lastUser.id);
    void respond(chatLog.slice(0, idx + 1));
  };

  const send = async (text: string) => {
    const content = text.trim();
    /* 上传中 / 失败均不发送：等待成功或用户处理，杜绝丢图或纯文字掩盖 */
    if (venue.img && venue.img.status !== 'ok') return;
    const img = venue.readyUrl;
    /* 全局任务锁：任一 AI 任务（含生图）进行中禁发新消息（含生图入口），输入草稿保留 */
    if ((!content && !img) || streaming || taskLocked) {
      if (taskLocked && !streaming) toast.info(`${taskLabel ?? 'AI 任务'}，请稍候再发送～`);
      return;
    }

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: content || '（发送了一张场地照片）',
      ts: Date.now(),
      ...(img ? { imageUrl: img } : {}),
    };
    onChatLogAppend(userMsg);
    /* 新场地照片进入 scene：旧效果图作废（对应新场地重新生成） */
    if (img && onSceneImage) onSceneImage(img);

    /* 主动询问购买/场地时匹配资源参考 */
    setResourceHint(RESOURCE_HINT_RE.test(content) ? getMaterialMatches([content]).slice(0, 3) : null);

    setInput('');
    venue.clear();

    /* 动作意图分发（按动作分别识别允许/禁止，否定只否其就近修饰的对象）：
     * 「重新生成完整方案…不生成图片」→ 进入真实方案流程但不动生图；
     * 「只记条件/只讨论」→ 不进入任何生成分发，作为普通对话处理；
     * 对话与右侧按钮复用同一套操作、确认、任务与保存流程 */
    const intent = classifyUserIntent(content);
    const schemeDispatch = intent.allowScheme && !!onSchemeGen;
    const themeDispatch = intent.allowTheme && !!onThemeGen;
    const copiesDispatch = intent.allowCopies && !!onCopiesGen;
    const isSceneGenReq = intent.allowScene;
    /* 条件同步前置（分发与对话共用同一份最新状态）：用户明确给出的条件先写摘要，真实写入才有反馈；
     * 已确认的既有决定不静默覆盖（由 syncConditions 守卫），修改走调整确认 */
    const facts = extractExplicitFacts(content);
    if (onConditionSync && (facts.headcount || facts.budgetLimit || facts.otherNeeds || facts.region || facts.date || facts.duration)) {
      const written =
        onConditionSync({
          fields: [],
          headcount: facts.headcount,
          budgetLimit: facts.budgetLimit,
          budgetKind: facts.budgetKind,
          otherNeeds: facts.otherNeeds,
          region: facts.region,
          date: facts.date,
          duration: facts.duration,
        }) ?? [];
      if (written.length > 0) {
        const label = written.map((k) => FACT_LABEL[k] ?? k).join('、');
        if (schemeDispatch || isSceneGenReq) toast.info(`已将「${label}」同步到需求摘要`);
        else pendingSyncRef.current = written; /* 挂到本条回复的同步标签 */
      }
    }
    if (schemeDispatch) {
      if (onSchemeGen?.(content)) return;
    }
    /* 单独改主题请求：走主题草稿确认链路（新主题先待确认，确认才替换主题字段，其余模块不动），
     * 不再落入普通回复后把「建议主题」写进需求摘要（建议词类讨论仍走对话保持建议态） */
    if (themeDispatch) {
      if (onThemeGen?.(content)) return;
    }
    /* 单独文案请求（「生成文案但不要重新生成方案」）：走文案生成同一流程（任务锁/草稿确认/概述共用） */
    if (copiesDispatch) {
      if (onCopiesGen?.(content)) return;
    }
    if (isSceneGenReq) {
      const hasBefore = !!img || !!data.scene?.beforeUrl;
      if (!hasBefore) {
        const replyMsg: ChatMessage = {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: `${nickname ? `亲爱的${nickname}，` : ''}我非常乐意为你生成逼真的场地布置效果图！\n\n为了能够严格锁定门窗、梁柱与真实机位结构，仅添加可移动活动软装，我们需要一张**原始场地照片**作为底图哦～\n\n你可以点击输入框左下角的 📎 上传场地照片，或者在左侧「场景布置」直接选用现成示例场地，我立刻为你施展魔法生成！`,
          ts: Date.now(),
        };
        onChatLogAppend(replyMsg);
        return;
      }

      if (data.scene?.genTask?.status === 'querying') {
        const replyMsg: ChatMessage = {
          id: `a-${Date.now()}`,
          role: 'assistant',
          content: `${nickname ? `${nickname}，` : ''}场地布置效果图正在快马加鞭生成中（约需 1–2 分钟），请稍等片刻，生成完成后我会在对话中直接呈现给你哦～`,
          ts: Date.now(),
        };
        onChatLogAppend(replyMsg);
        return;
      }

      if (onTriggerSceneGen) {
        /* 启动提示由 Workbench triggerSceneFromAi 成功提交后单点写入（两条路径共用，防重复消息） */
        void onTriggerSceneGen().then((res) => {
          if (!res.ok) {
            toast.error(res.message || '生成未成功启动');
          }
        });
        return;
      }
    }

    await respond([...chatLog, userMsg]);
  };

  /* 当生图成功就绪时：向 chatLog 追加持久化消息卡片，永久沉淀在对话流中（不遮挡最新消息，切页/换场地不丢失） */
  useEffect(() => {
    if (!data.scene?.afterUrl || data.scene.isExample) return;
    const currentAfterUrl = data.scene.afterUrl;
    const exists = chatLog.some((m) => m.sceneCard?.afterUrl === currentAfterUrl);
    if (!exists) {
      onChatLogAppend({
        id: `scene-msg-${Date.now()}`,
        role: 'assistant',
        content: `✨ 场地布置效果图已为你生成就绪！我已经严格保留了场地的真实建筑结构与门窗透视，仅布置可移动软装物料。\n\n你可以在下方拖动中间的分割线实时查看场地布置前后的对比效果：`,
        sceneCard: {
          beforeUrl: data.scene.beforeUrl,
          afterUrl: currentAfterUrl,
          style: data.scene.lastReq?.style ?? data.scene.style,
          tags: data.scene.lastReq?.tags ?? data.scene.tags,
          density: data.scene.lastReq?.density ?? data.scene.density,
          materials: aiMaterials,
        },
        ts: Date.now(),
      });
    }
  }, [
    data.scene?.afterUrl,
    data.scene?.beforeUrl,
    data.scene?.isExample,
    chatLog,
    onChatLogAppend,
    aiMaterials,
    data.scene?.lastReq,
    data.scene?.style,
    data.scene?.tags,
    data.scene?.density,
  ]);

  /* 初始承接：项目首条用户消息（来自开始页描述或场地照片）自动获得 AI 回应。
   * 仅限新建进入（autoRespondEnabled）：刷新/重开后 chatLog 只剩用户消息时（历史回复丢失或生成中断），
   * 不自动再次请求——由未完成横幅提示用户手动继续，不静默重复扣调用。 */
useEffect(() => {
  if (!autoRespondEnabled || autoRespondedRef.current || streaming) return;
  /* 首条是 AI 招呼语 + 其次用户消息：只要末条是用户消息即承接回应（限新建进入，刷新不重复请求） */
  if (chatLog.length > 0 && chatLog[chatLog.length - 1].role === 'user') {
    autoRespondedRef.current = true;
    void respond(chatLog);
}
// eslint-disable-next-line react-hooks/exhaustive-deps
}, [chatLog]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 标题 */}
      <div className="flex items-center gap-2 border-b px-4 py-3">
        <AiAvatar className="h-7 w-7" />
        <h2 className="text-sm font-semibold">小灵 · AI 策划伙伴</h2>
        {/* 去右侧场景布置页签生成（本按钮只做跳转，不直接出图，文案明确「去」避免误会）；
            与所有生成入口共用同一活动忙碌状态：任一 AI 任务进行中外观置灰、aria 禁用、事件不触发 */}
        <Button
          variant="outline"
          size="sm"
          className="ml-auto h-8 gap-1.5"
          disabled={taskLocked || streaming}
          aria-disabled={taskLocked || streaming}
          title={taskLocked || streaming ? `${taskLabel ?? 'AI 任务'}进行中，完成后可去生成布置效果` : '跳转到右侧「场景布置」页签生成效果图'}
          onClick={() => {
            if (taskLocked || streaming) {
              toast.info(`${taskLabel ?? 'AI 任务'}进行中，请稍后再去生成布置效果`);
              return;
            }
            /* 无底图时明确提示上传场地照片，而不是静默无响应（服务层已强制要求参考图） */
            if (!data.scene?.beforeUrl) {
              toast.info('请先在右侧「场景布置」上传或选择一张场地照片作为底图，再生成布置效果');
              return;
            }
            onOpenSceneGenerate?.();
          }}
        >去生成布置效果</Button>
  </div>
      {/* 消息列表 */}
      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {/* 用户上滚后：新内容不抢滚动，出现「回到底部」入口 */}
        {showJumpDown && (
          <button
            type="button"
            onClick={jumpToLatest}
            className="sticky top-0 z-10 mx-auto mb-2 flex items-center gap-1.5 rounded-full border bg-background px-3 py-1 text-xs font-medium text-primary shadow-sm"
          >
            <ArrowDown className="h-3 w-3" />
            有新回复，回到最新
          </button>
        )}
        {chatLog.length === 0 && !streaming && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            {welcomeFailed ? (
              <AiAvatar className="h-20 w-20" />
        ) : (
          <img
            src={ASSETS.aiCat.full}
            alt="AI 策划伙伴"
            className="h-24 w-auto"
            onError={() => setWelcomeFailed(true)}
      />
)}
<p className="text-sm font-medium">你好，我是你的策划伙伴</p>
<p className="max-w-56 text-xs leading-relaxed text-muted-foreground">
  随时聊你的想法或顾虑——「还没想好」也没关系，我们一步步来。
</p>
</div>
)}
<div className="flex flex-col gap-3">
  {chatLog.map((m) => (
    <div
      key={m.id}
      className={cn(
        'flex w-full items-end gap-2',
        m.role === 'user' ? 'flex-row-reverse justify-start' : 'justify-start'
      )}
    >
      {m.role === 'user' ? <UserAvatar className="h-7 w-7 shrink-0" /> : <AiAvatar className="h-7 w-7 shrink-0" />}
      <div
        className={cn(
          'max-w-[80%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed break-words',
          m.role === 'user'
            ? 'whitespace-pre-line bg-primary text-primary-foreground'
            : 'border bg-muted'
        )}
      >
  {m.imageUrl && (
    <img
      src={m.imageUrl}
      alt="随消息发送的场地照片"
      loading="lazy"
      className="mb-2 aspect-[3/2] w-full rounded-lg object-cover"
/>
)}
{m.role === 'assistant' ? (
  <>
    <MarkdownText text={stripProtocolLines(m.content)} />
    {parseInspirationRefs(m.content).length > 0 && (
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <span className="text-[11px] text-muted-foreground">参考灵感：</span>
        {parseInspirationRefs(m.content).map((ref) => (
          <Link
            key={ref.id}
            to={`/inspiration?focus=${ref.id}&${fromQuery(data.id ?? '', activeTab)}`}
            className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/5 px-2 py-0.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
          >
            <Lightbulb className="h-3 w-3" />
            {ref.title}
          </Link>
        ))}
      </div>
    )}
    {/* 建议调整确认卡：修改前影响说明，确认前不写入成果 */}
    {m.adjustCard && <AdjustCardView card={m.adjustCard} onAction={(a) => handleAdjust(m.id, m.adjustCard!, a)} />}
    {m.draftCard && (
      <DraftCardView
        card={m.draftCard}
        currentTheme={m.draftCard.origTheme ?? data?.theme}
        onApply={() => onDraftApply?.(m.id, m.draftCard!)}
        onSkip={() => onChatLogUpdate(m.id, { draftCard: { ...m.draftCard!, status: 'skipped' } })}
      />
    )}

    {/* 失败消息的手动重试入口（随消息持久化，刷新后仍可用）：点击继续原任务类型与禁止项，
     * 不追加第二条用户请求；忙碌期间禁用；重新发起后旧入口标记失效不重复执行 */}
    {m.retryAction && !m.retryAction.resolved && (
      <button
        type="button"
        disabled={taskLocked || streaming}
        onClick={() => {
          const k = m.retryAction!.kind;
          if (k === 'theme' && onThemeGen) { onThemeGen(m.content); return; }
          if (k === 'copies' && onCopiesGen) { onCopiesGen(m.content); return; }
          if (k === 'scheme' && onSchemeGen) { onSchemeGen(m.content); }
        }}
        className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-amber-500/50 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-700 transition-all hover:bg-amber-500/20 hover:shadow-sm active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-50 dark:text-amber-400"
      >
        <RotateCcw className="h-3 w-3" />
        重试{m.retryAction.kind === 'theme' ? '主题生成' : m.retryAction.kind === 'copies' ? '文案生成' : '完整方案生成'}
        {(taskLocked || streaming) && <span className="text-amber-600/70">（任务进行中，稍候）</span>}
      </button>
    )}

    {/* 成果更新标签：成功写入成果的会话消息附带「已更新到XX · 查看」入口 */}
    {m.actionTag && (
      <button
        type="button"
        onClick={() => onViewModule?.(m.actionTag!.module)}
        className="mt-2 inline-flex cursor-pointer items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary transition-all hover:bg-primary/20 hover:shadow-sm active:scale-[0.97]"
      >
        <Check className="h-3 w-3" />
        {m.actionTag.label}
        <span className="text-primary/70">· 查看</span>
      </button>
    )}
  </>
) : (
  m.content
)}

{/* 消息内流式沉淀的布置效果图卡片：支持原图与效果图左右拖拽对比、材料清单与轻量Badge，不遮挡最新对话 */}
{m.sceneCard && (
  <div className="mt-3 overflow-hidden rounded-xl border bg-card p-3 shadow-2xs">
    <div className="mb-2.5 flex items-center justify-between">
      <span className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        场地布置前后对比与方案
      </span>
      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px] text-primary hover:bg-primary/10"
          onClick={() => setBigPreview(m.sceneCard?.afterUrl || null)}
        >
          <Eye className="mr-1 h-3 w-3" />
          查看大图
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 px-2 text-[11px] text-primary hover:bg-primary/10"
          onClick={() => downloadSceneImg(m.sceneCard?.afterUrl as string)}
        >
          <Download className="mr-1 h-3 w-3" />
          下载
        </Button>
      </div>
    </div>

    {/* 拖拽对比画布（有原图时支持左右滑块自由拖拽对比；无原图时展示效果图） */}
    {m.sceneCard.beforeUrl ? (
      <div className="overflow-hidden rounded-lg border">
        <CompareCanvas
          beforeUrl={m.sceneCard.beforeUrl}
          afterUrl={m.sceneCard.afterUrl}
          className="aspect-[16/9] w-full"
          initial={50}
        />
        <p className="bg-muted/40 py-1 text-center text-[10px] text-muted-foreground">
          左右拖动中间滑杆查看布置前与布置后对比
        </p>
      </div>
    ) : (
      <div className="overflow-hidden rounded-lg border">
        <img
          src={m.sceneCard.afterUrl}
          alt="布置效果图"
          className="aspect-[16/9] w-full cursor-pointer object-cover hover:opacity-95"
          onClick={() => setBigPreview(m.sceneCard?.afterUrl || null)}
        />
      </div>
    )}

    {/* 本次生图材料清单与轻量合作商 Badge 标签 */}
    {m.sceneCard.materials && m.sceneCard.materials.length > 0 && (
      <div className="mt-3 rounded-lg border bg-muted/20 p-2.5">
        <div className="mb-1.5 flex items-center justify-between">
          <span className="text-[11px] font-medium text-foreground">本次布置用到的材料清单</span>
          <span className="text-[10px] text-muted-foreground">{m.sceneCard.materials.length} 项</span>
        </div>
        <div className="flex flex-col gap-1.5">
          {m.sceneCard.materials.map((mat, idx) => (
            <div key={idx} className="flex flex-wrap items-center justify-between gap-1.5 text-xs">
              <span className="text-muted-foreground">{mat.name}</span>
              {mat.partner && (
                <a
                  href={mat.partner.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary hover:bg-primary/20"
                  title={`查看合作物料：${mat.partner.name}`}
                >
                  <Tag className="h-2.5 w-2.5" />
                  合作推荐：{mat.partner.name}
                  <ExternalLink className="h-2.5 w-2.5" />
                </a>
              )}
            </div>
          ))}
        </div>
      </div>
    )}
  </div>
)}
{/* 真实同步反馈标签：程序提取到用户明确条件且写入成功才显示（持久化由统一保存队列完成，此处为已生效提示）；可点开摘要抽屉核对 */}
{syncedFields && syncedFields.msgId === m.id && (
  <div className="mt-1.5 flex items-center gap-1.5 border-t border-border/60 pt-1.5 text-xs text-muted-foreground">
    <Check className="h-3 w-3 text-primary" />
    <span className="min-w-0 flex-1">已更新需求摘要：{syncedFields.fields.map((k) => FACT_LABEL[k] ?? k).join('、')}</span>
    {onOpenRequirements && (
      <button type="button" onClick={onOpenRequirements} className="shrink-0 text-primary hover:underline">
        查看
      </button>
    )}
  </div>
)}
{/* 合作推荐：与用户消息确定性匹配（否定/不采购不推；最多3个短标签；只查看渠道，不改预算采购） */}
{m.role === 'assistant' && !streaming && (() => {
  const prevUser = [...chatLog.slice(0, chatLog.indexOf(m)).reverse()].find((x) => x.role === 'user');
  const city = data.requirements?.region?.value as string | undefined;
  let recs = prevUser ? matchPartnerCatalog(prevUser.content, 3, city) : [];
  /* 易触发：用户消息未直接提到物料时，结合当前场景上下文（布置元素/物料/主题）再匹配；
     仅在用户没有明确否定采购时轻推，每次最多 2 个，不强制每条都带 */
  if (recs.length === 0 && prevUser && !PARTNER_NEGATION_RE.test(prevUser.content)) {
    const sc = data.scene ?? {};
    const ctxTags = normalizeTags(sc.lastReq?.tags).length > 0 ? normalizeTags(sc.lastReq?.tags) : normalizeTags(sc.tags);
    const ctxText = [...ctxTags, ...(data.materials ?? []).map((mm) => mm.name), data.theme?.name ?? ''].join(' ');
    recs = matchPartnerCatalog(ctxText, 2, city);
  }
  return recs.length > 0 ? (
    <div className="mt-1.5 flex flex-wrap items-center gap-1.5 border-t border-border/60 pt-1.5">
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Handshake className="h-3 w-3" />
        合作推荐
        <span className="rounded bg-muted px-1 text-[10px]">推广</span>
      </span>
      {recs.map((r) => (
        <a
          key={r.id}
          href={r.url}
          target="_blank"
          rel="noreferrer"
          title={`${r.name}：${r.use}`}
          className="inline-flex max-w-full items-center gap-1 truncate rounded-full border border-primary/40 bg-primary/5 px-2 py-0.5 text-xs text-primary hover:bg-primary/10"
        >
          {r.name}
          <span className="rounded bg-muted px-1 text-[10px] text-muted-foreground">推广</span>
          <span className="text-[10px] opacity-70">{r.urlLabel}↗</span>
        </a>
      ))}
    </div>
  ) : null;
})()}
</div>
</div>
))}
{streaming && (
  <div className="flex items-end gap-2 self-start">
    <AiAvatar className="h-7 w-7 shrink-0" />
    <div className="max-w-[80%] rounded-2xl border bg-muted px-3.5 py-2.5 text-sm leading-relaxed">
      {visionWorking ? (
        <span className="flex items-center gap-2 text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          正在查看你的照片…
        </span>
      ) : streamText ? (
        <MarkdownText text={stripProtocolLines(streamText)} />
      ) : (
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      )}
      {!visionWorking && (
        <span className="ml-0.5 inline-block h-4 w-0.5 animate-pulse bg-primary align-middle" />
      )}
    </div>
  </div>
)}

{/* 同步展示当前进行中的场地布置生图任务卡片（与面板完全同源，切页不丢失） */}
{data.scene?.genTask?.status === 'querying' && (
  <div className="flex max-w-[90%] items-start gap-3 self-start rounded-2xl border border-primary/40 bg-primary/5 p-3.5 shadow-2xs">
    <AiAvatar className="h-7 w-7 shrink-0" />
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-primary">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          场地布置效果图生成中…
        </span>
        <span className="text-[11px] text-muted-foreground">约需 1–2 分钟</span>
      </div>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        正在严格锁定场地建筑结构与透视机位，将当前主题与可移动装饰进行真实渲染，请稍候…
      </p>
    </div>
  </div>
)}

{/* 中断恢复：末条用户消息从未获得回复（页面关闭/网络中断），明确提示未完成并提供手动继续；不自动重发 */}
{(() => {
  const lastMsg = chatLog[chatLog.length - 1];
  const interrupted =
    !streaming &&
    !error &&
    !visionWorking &&
    !taskLocked && /* 生图/方案等任务进行中属正常等待，不误报「回复未完成」 */
    chatLog.length >= 1 &&
    lastMsg?.role === 'user' &&
    dismissedInterruptRef.current !== lastMsg.id;
if (!interrupted) return null;
return (
  <div className="flex max-w-[92%] flex-col gap-2 self-start rounded-2xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-700 dark:text-amber-400">
    <div className="flex items-center gap-2">
      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 leading-relaxed">
        这条消息的回复未完成（页面可能中途关闭）。消息已保留，不算已完成的历史。
  </span>
</div>
<div className="flex gap-2 pl-6">
  <button
    type="button"
    onClick={retryLast}
    className="inline-flex items-center gap-1 rounded-full border border-amber-600/50 px-2.5 py-1 font-medium transition-colors hover:bg-amber-500/20"
>
  <RotateCcw className="h-3 w-3" />
  继续生成回复
</button>
<button
  type="button"
  onClick={() => {
    if (lastMsg) dismissedInterruptRef.current = lastMsg.id;
}}
className="rounded-full px-2.5 py-1 text-muted-foreground transition-colors hover:text-foreground"
>
  知道了
</button>
</div>
</div>
);
})()}
{/* 失败提示 + 重试：简短信息在前，技术细节折叠；发送内容已保留在消息流中 */}
{error && !streaming && (
  <div className="flex max-w-[92%] flex-col gap-2 self-start rounded-2xl border border-destructive/30 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive">
    <div className="flex items-center gap-2">
      <AlertCircle className="h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 flex-1 leading-relaxed">{error.short}</span>
      <button
        type="button"
        onClick={retryLast}
        className="inline-flex shrink-0 items-center gap-1 rounded-full border border-destructive/40 px-2.5 py-1 font-medium transition-colors hover:bg-destructive/15"
  >
    <RotateCcw className="h-3 w-3" />
    重试
</button>
</div>
{error.detail && (
  <details className="text-[11px] text-destructive/80">
    <summary className="cursor-pointer select-none">技术详情</summary>
    <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background/60 p-2 font-mono">{error.detail}</pre>
</details>
)}
</div>
)}
{/* 资源参考（仅用户主动询问购买/场地时出现） */}
{resourceHint && resourceHint.length > 0 && !streaming && (
  <div className="flex max-w-[92%] flex-col gap-2 self-start rounded-2xl border bg-card p-3">
    <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
      <ShoppingBag className="h-3.5 w-3.5 text-primary" />
      相关物料与购买渠道
</p>
{resourceHint.map((r) => (
  <MaterialCard key={r.id} r={r} compact />
))}
<p className="text-[11px] text-muted-foreground">完整清单与更多渠道见「预算与准备」页签</p>
</div>
)}
</div>
</div>
      {/* 底部快捷控制栏：规整优雅，左侧快捷提问胶囊，右侧三档详略调节；任务锁激活时显示当前任务 */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t bg-muted/20 px-3.5 py-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {QUICK_REPLIES.map((q) => (
            <button
              key={q}
              type="button"
              disabled={streaming || taskLocked}
              onClick={() => send(q)}
              className="inline-flex h-7 items-center rounded-full border border-border/70 bg-background/90 px-2.5 text-xs text-muted-foreground shadow-2xs transition-all hover:border-primary/50 hover:bg-primary/5 hover:text-primary disabled:opacity-50"
            >
              {q}
            </button>
          ))}
        </div>
        {/* 任务锁状态：明确显示当前正在执行的任务（不只禁用按钮），允许阅读与编辑草稿 */}
        {taskLocked && !streaming && (
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-primary">
            <Loader2 className="h-3 w-3 animate-spin" />
            {taskLabel}
          </span>
        )}
        {/* 回复详略滑块：极致精简，不常驻显示中文档位文字，仅拖动滑动时浮现对应档位提示 */}
        <div
          className="relative ml-auto inline-flex h-7 items-center gap-2 rounded-full border border-border/70 bg-background/90 px-2.5 shadow-2xs"
          role="group"
          aria-label="回复详略"
        >
          <span className="text-[11px] text-muted-foreground select-none">详略</span>
          <div className="relative flex items-center">
            {sliding && (
              <div className="absolute -top-7 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-0.5 text-[10px] font-medium text-background shadow-md animate-in fade-in zoom-in-95">
                {DETAIL_OPTIONS.find((o) => o.key === detail)?.label}
              </div>
            )}
            <Slider
              value={[DETAIL_INDEX[detail]]}
              min={0}
              max={2}
              step={1}
              onValueChange={(v) => {
                const idx = v[0];
                const key = DETAIL_OPTIONS[idx]?.key;
                if (key) setDetail(key);
                setSliding(true);
                if (slideTimerRef.current) clearTimeout(slideTimerRef.current);
                slideTimerRef.current = setTimeout(() => setSliding(false), 1200);
              }}
              className="w-16"
              aria-label="回复详略滑块"
            />
          </div>
        </div>
      </div>
      {/* 输入区 */}
      <div className="border-t p-3">
        {/* 待发送照片：四态预览（上传中 / 成功 / 失败重试），失败不丢文字 */}
        {venue.img && (
          <div className="mb-2">
            <PendingImageBar img={venue.img} onRetry={venue.retry} onRemove={venue.clear} />
      </div>
)}
<div className="flex items-end gap-2">
  <input
    ref={fileRef}
    type="file"
    accept="image/*"
    className="hidden"
    onChange={(e) => {
      const f = e.target.files?.[0];
      e.target.value = '';
      void venue.pick(f);
}}
/>
<Button
  variant="outline"
  size="icon"
  className="h-10 w-10 shrink-0"
  disabled={streaming || venue.busy}
  onClick={() => fileRef.current?.click()}
  aria-label="附加场地照片"
  title="附加场地照片"
>
  {venue.busy ? (
    <Loader2 className="h-4 w-4 animate-spin" />
) : (
  <Paperclip className="h-4 w-4" />
)}
</Button>
<Textarea
  ref={textAreaFocusRef}
  value={input}
  onChange={(e) => setInput(e.target.value)}
  onKeyDown={(e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(input);
}
}}
placeholder={taskLocked && !streaming ? `${taskLabel ?? 'AI 任务进行中'}，输入会保留为草稿…` : venue.img ? '可搭配一句话说明（也可直接发送照片）' : '说说你的想法、顾虑或问题…'}
className="max-h-28 min-h-10 flex-1 resize-none"
rows={2}
/>
          <Button
            size="icon"
            className="h-10 w-10 shrink-0"
            disabled={(!input.trim() && !venue.readyUrl) || streaming || !!venue.img || taskLocked}
            onClick={() => void send(input)}
            title={taskLocked && !streaming ? taskLabel : undefined}
          >
            {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
        </div>
      </div>
      {/* 大图查看弹窗 */}
      <Dialog open={bigPreview !== null} onOpenChange={(open) => !open && setBigPreview(null)}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-4xl p-2 md:p-4">
          <DialogHeader>
            <DialogTitle className="text-left">场地布置效果图</DialogTitle>
            <DialogDescription className="text-left">
              严格保留原场地门窗透视与空间结构，渲染可移动软装物料
            </DialogDescription>
          </DialogHeader>
          {bigPreview && (
            <div className="overflow-hidden rounded-xl border">
              <img src={bigPreview} alt="效果图大图" className="w-full object-contain max-h-[75vh]" />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}



/** 建议调整确认卡：变更清单直接由待应用补丁派生（与真实写入同源，不另写承诺文本），五态操作（待确认/应用中/已应用/已取消/失败） */
/** 主题/文案替换生成的待确认草稿卡：展示拟替换的实际内容与范围，「已整理，等待确认」态不动成果；
 * 确认才写入（成功态=真实保存），取消保留旧稿；随消息持久化，刷新保持待确认 */
/** 主题/文案替换生成的待确认草稿卡：默认紧凑展示，可一键展开完整邀请函/主持词/每条指引
 * （完整内容来自将要应用的同一份草稿，确认前可完整阅读）；确认才写入，取消保留旧稿；随消息持久化 */
function DraftCardView({
  card,
  onApply,
  onSkip,
  currentTheme,
}: {
  card: NonNullable<ChatMessage['draftCard']>;
  onApply: () => void;
  onSkip: () => void;
  /** 当前活动主题（原值）：确认卡展示同一补丁的原值→新值对照，取消则完全不改 */
  currentTheme?: ProjectData['theme'];
}) {
  const [expanded, setExpanded] = useState(false);
  const st = card.status;
  const isTheme = card.kind === 'theme';
  const t = card.theme;
  const c = card.copies;
  const onsiteLines = (c?.onsite ?? []).filter((l) => l?.trim()).map((l) => cleanEmphasisText(l));
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-primary/35 bg-card shadow-md">
      <div className="flex items-center gap-2 border-b bg-primary/5 px-3.5 py-2.5">
        <PenLine className="h-4 w-4 shrink-0 text-primary" />
        <span className="text-xs font-semibold text-foreground">{isTheme ? '新主题草稿' : '新文案草稿'}</span>
        {st === 'pending' && (
          <span className="ml-auto rounded-full bg-chart-5/15 px-2 py-0.5 text-[10px] font-medium text-chart-5">已整理，等待确认</span>
        )}
        {st === 'applied' && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground">
            <Check className="h-3 w-3" /> 已更新
          </span>
        )}
        {st === 'skipped' && (
          <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">已取消，旧稿保留</span>
        )}
      </div>
      <div className="space-y-2.5 px-3.5 py-3">
        {isTheme && t && (
          <>
            {/* 原值→新值对照（同一份结构化补丁）：仅列出将替换的三个字段，取消完全不改 */}
            {currentTheme?.name && (
              <div className="space-y-0.5 rounded-lg bg-muted/50 px-3 py-2 text-xs leading-relaxed">
                <p className="text-muted-foreground">
                  当前主题名：<span className="text-foreground/80">{currentTheme.name}</span>
                  <span className="mx-1 text-primary">→</span>
                  <span className="font-medium text-foreground">{cleanEmphasisText(t.name ?? '')}</span>
                </p>
                {t.slogan && currentTheme.slogan && currentTheme.slogan !== t.slogan && (
                  <p className="text-muted-foreground">
                    当前口号：<span className="text-foreground/80">{currentTheme.slogan}</span>
                    <span className="mx-1 text-primary">→</span>
                    <span className="font-medium text-foreground">{cleanEmphasisText(t.slogan)}</span>
                  </p>
                )}
                {(currentTheme.highlights ?? []).length > 0 && (
                  <p className="text-muted-foreground">
                    当前亮点：<span className="text-foreground/80">{(currentTheme.highlights ?? []).slice(0, 3).join('；')}</span>
                    <span className="mx-1 text-primary">→</span>
                    <span className="font-medium text-foreground">{(t.highlights ?? []).slice(0, 4).map((h) => cleanEmphasisText(h)).join('；')}</span>
                  </p>
                )}
              </div>
            )}
            <p className="text-sm font-semibold text-foreground">「{cleanEmphasisText(t.name ?? '')}」{t.slogan ? <span className="font-normal text-foreground/75">· {cleanEmphasisText(t.slogan)}</span> : null}</p>
            {t.highlights && t.highlights.length > 0 && (
              <ul className="space-y-0.5">
                {t.highlights.slice(0, 4).map((h) => (
                  <li key={h} className="flex items-start gap-1.5 text-xs leading-relaxed text-foreground/90">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" /> {cleanEmphasisText(h)}
                  </li>
                ))}
              </ul>
            )}
            <p className="text-[11px] leading-relaxed text-muted-foreground">拟替换范围：仅主题名、口号与亮点；流程、预算、物料、任务与文案（含手动修改）保持不变。</p>
          </>
        )}
        {!isTheme && c && (
          <>
            {/* 紧凑预览：首句提示内容方向；完整内容在同一卡片内展开（同份草稿，非另一来源） */}
            {!expanded && (
              <div className="space-y-1.5">
                {c.invite && (
                  <p className="text-xs leading-relaxed text-foreground/90">
                    邀请函（开头）：{c.invite.split(/\n/)[0].slice(0, 60)}{c.invite.split(/\n/)[0].length > 60 ? '…' : ''}
                  </p>
                )}
                {c.hosting && (
                  <p className="text-xs leading-relaxed text-foreground/90">
                    主持词（开场）：{c.hosting.split(/\n/)[0].slice(0, 60)}{c.hosting.split(/\n/)[0].length > 60 ? '…' : ''}
                  </p>
                )}
                {onsiteLines.length > 0 && <p className="text-xs leading-relaxed text-foreground/90">现场指引 {onsiteLines.length} 条</p>}
              </div>
            )}
            {/* 完整内容：确认前可逐字阅读将要应用的全部草稿文本 */}
            {expanded && (
              <div className="space-y-3">
                {c.invite && (
                  <div>
                    <p className="mb-1 text-[11px] font-medium text-muted-foreground">邀请函（完整）</p>
                    <p className="whitespace-pre-wrap rounded-lg bg-muted/40 px-3 py-2 text-xs leading-relaxed text-foreground">{cleanEmphasisText(c.invite)}</p>
                  </div>
                )}
                {c.hosting && (
                  <div>
                    <p className="mb-1 text-[11px] font-medium text-muted-foreground">主持词（完整）</p>
                    <p className="whitespace-pre-wrap rounded-lg bg-muted/40 px-3 py-2 text-xs leading-relaxed text-foreground">{cleanEmphasisText(c.hosting)}</p>
                  </div>
                )}
                {onsiteLines.length > 0 && (
                  <div>
                    <p className="mb-1 text-[11px] font-medium text-muted-foreground">现场指引（全部 {onsiteLines.length} 条）</p>
                    <ol className="space-y-1">
                      {onsiteLines.map((l, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-xs leading-relaxed text-foreground">
                          <span className="mt-px shrink-0 text-[10px] text-muted-foreground">{i + 1}.</span>
                          <span className="min-w-0 flex-1">{l}</span>
                        </li>
                      ))}
                    </ol>
                  </div>
                )}
              </div>
            )}
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
              aria-expanded={expanded}
            >
              {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              {expanded ? '收起完整内容' : '展开完整内容（确认前可完整阅读）'}
            </button>
            <p className="text-[11px] leading-relaxed text-muted-foreground">拟替换范围：邀请函、主持词与现场指引；主题、流程、预算、物料与任务保持不变。</p>
          </>
        )}
        {st === 'pending' && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border/60 pt-2.5">
            <Button size="sm" className="h-8" onClick={onApply}>
              <Check className="h-3.5 w-3.5" /> 采纳并更新到成果
            </Button>
            <Button size="sm" variant="ghost" className="h-8 text-muted-foreground" onClick={onSkip}>
              <X className="h-3.5 w-3.5" /> 暂不替换，保留现有
            </Button>
          </div>
        )}
        {st === 'skipped' && (
          <p className="border-t border-border/60 pt-2 text-[11px] text-muted-foreground">现有内容保持原样；想再试可点模块里的重新生成。</p>
        )}
      </div>
    </div>
  );
}

function AdjustCardView({
  card,
  onAction,
}: {
  card: AdjustCard;
  onAction: (a: 'apply' | 'skip' | 'edit') => void;
}) {
  const st = card.status ?? 'pending';
  /* 变更清单来自同一份待应用补丁数据；无结构化补丁时退回 affects 描述 */
  /* 差异展示与实际写入同源：配色行带原值→新值，并明示同步替换范围（活动亮点/场景主题/文案），
   * 消除「标题说三处、实际将写入只列一处」的不一致 */
  const patchLines = planChangeLines(card.plan).map((line) => {
    if (line.startsWith('视觉主题改为')) {
      return `视觉主题配色：${card.orig?.visualTheme ? `「${card.orig.visualTheme}」→` : '原配色→'}「${card.plan?.visualTheme}」`;
    }
    /* 环节补丁行：附「原值→新值」明细（来自创建卡时的 orig 快照，不随成果变化，取消不改） */
    if (line.startsWith('环节「') && card.orig?.schedule?.length) {
      const nameMatch = line.match(/^环节「(.+?)」/);
      const dispName = nameMatch?.[1] ?? '';
      const snap = card.orig.schedule.find(
        (o) => (o.name ?? '').trim() === dispName || normName(o.name ?? '') === normName(dispName)
      );
      if (snap) {
        const patch = (card.plan?.schedulePatch ?? []).find(
          (x) => normName(x.name ?? '') === normName(dispName) || (x.id && snap.id === x.id)
        );
        const pairs: string[] = [];
        if (patch?.time !== undefined) pairs.push(`时间 ${snap.time || '（空）'} → ${patch.time || '（空）'}`);
        if (patch?.duration !== undefined) pairs.push(`时长 ${snap.duration || '（空）'} → ${patch.duration || '（空）'}`);
        if (patch?.note !== undefined) pairs.push(`备注 ${snap.note || '（空）'} → ${patch.note || '（空）'}`);
        if (patch?.rename !== undefined) pairs.push(`名称 ${snap.name || '（空）'} → ${patch.rename || '（空）'}`);
        if (pairs.length > 0) {
          const tail = line.replace(/^环节「.+?」/, '');
          return `环节「${dispName}」${pairs.join('；')}${tail}`;
        }
      }
    }
    return line;
  });
  /* 同步范围与 applyAdjust 实际写入同一套判定（extractScope）：点名了哪些模块就同步哪些，
   * 未点名文案/场景补充说明时不显示也不写入（卡片展示=实际补丁） */
  const syncScope = card.plan?.visualTheme !== undefined ? extractScope(card.sourceText ?? '') : null;
  const syncNames: string[] = [];
  if (syncScope) {
    if (!syncScope.restricted || syncScope.allowed.includes('theme')) syncNames.push('活动亮点');
    if (!syncScope.restricted || syncScope.allowed.includes('scene')) syncNames.push('场景主题');
    if (!syncScope.restricted || syncScope.allowed.includes('copies')) syncNames.push('文案');
  }
  const hasColorSync = syncNames.length > 0;
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-primary/35 bg-card shadow-md">
      <div className="flex items-center gap-2 border-b bg-primary/5 px-3.5 py-2.5">
        <ShieldCheck className="h-4 w-4 shrink-0 text-primary" />
        <span className="text-xs font-semibold text-foreground">建议调整 · 确认后才会更新成果</span>
        {st === 'applying' && (
          <span className="ml-auto rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">应用中…</span>
        )}
        {st === 'applied' && !(card.undoneFields && card.undoneFields.length > 0) && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-primary px-2 py-0.5 text-[10px] font-medium text-primary-foreground">
            <Check className="h-3 w-3" /> 已应用
          </span>
        )}
        {st === 'applied' && card.undoneFields && card.undoneFields.length > 0 && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-chart-5/20 px-2 py-0.5 text-[10px] font-medium text-chart-5">
            <AlertCircle className="h-3 w-3" /> 部分完成
          </span>
        )}
        {st === 'failed' && (
          <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-chart-4/15 px-2 py-0.5 text-[10px] font-medium text-chart-4">
            <AlertCircle className="h-3 w-3" /> 应用失败
          </span>
        )}
        {st === 'skipped' && (
          <span className="ml-auto rounded-full bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">已取消</span>
        )}
        {st === 'editing' && (
          <span className="ml-auto rounded-full bg-chart-5/15 px-2 py-0.5 text-[10px] font-medium text-chart-5">待你补充</span>
        )}
      </div>
      <div className="space-y-2.5 px-3.5 py-3">
        <p className="text-sm font-medium leading-relaxed text-foreground">{card.change}</p>
        {patchLines.length > 0 ? (
          <div>
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">实际将写入（未列出的内容保持原样）</p>
            <ul className="space-y-0.5">
              {patchLines.map((x) => (
                <li key={x} className="flex items-start gap-1.5 text-xs leading-relaxed text-foreground/90">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" /> {x}
                </li>
              ))}
              {hasColorSync && (
                <li className="flex items-start gap-1.5 text-xs leading-relaxed text-foreground/90">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" />
                  同步替换{syncNames.join('、')}中的同款旧色词（只动颜色词，未点名的模块与文字不动）
                </li>
              )}
            </ul>
          </div>
        ) : (
          card.affects.length > 0 && (
            <div>
              <p className="mb-1 text-[11px] font-medium text-muted-foreground">将会调整</p>
              <ul className="space-y-0.5">
                {card.affects.map((x) => (
                  <li key={x} className="flex items-start gap-1.5 text-xs leading-relaxed text-foreground/90">
                    <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" /> {x}
                  </li>
                ))}
              </ul>
            </div>
          )
        )}
        {st === 'failed' && card.failReason && (
          <div className="rounded-lg border border-chart-4/40 bg-chart-4/5 px-2.5 py-2">
            <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-chart-4">
              <AlertCircle className="h-3 w-3" /> 未写入（成果保持原样）
            </p>
            {card.failReason.split('、').map((x) => (
              <p key={x} className="text-xs leading-relaxed text-foreground/80">{x}</p>
            ))}
            <p className="mt-1 text-[11px] text-muted-foreground">可重试，或在对话中补充说明后我重新给出建议。</p>
          </div>
        )}
        {card.keep.length > 0 && (
          <div>
            <p className="mb-1 text-[11px] font-medium text-muted-foreground">保持不变</p>
            <ul className="space-y-0.5">
              {card.keep.map((x) => (
                <li key={x} className="flex items-start gap-1.5 text-xs leading-relaxed text-foreground/70">
                  <ShieldCheck className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground/60" /> {x}
                </li>
              ))}
            </ul>
          </div>
        )}
        {card.manualWarn.length > 0 && (
          <div className="rounded-lg border border-chart-5/40 bg-chart-5/5 px-2.5 py-2">
            <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-chart-5">
              <AlertCircle className="h-3 w-3" /> 将覆盖你的手动修改
            </p>
            {card.manualWarn.map((x) => (
              <p key={x} className="text-xs leading-relaxed text-foreground/80">{x}</p>
            ))}
          </div>
        )}
        {card.pending.length > 0 && (
          <div>
            <p className="mb-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
              <Clock3 className="h-3 w-3" /> 尚需确认
            </p>
            {card.pending.map((x) => (
              <p key={x} className="text-xs leading-relaxed text-muted-foreground">{x}</p>
            ))}
          </div>
        )}
      </div>
      {(st === 'pending' || st === 'failed') && (
        <div className="flex flex-wrap items-center gap-2 border-t bg-muted/30 px-3.5 py-2.5">
          <Button
            size="sm"
            className="h-8"
            disabled={Object.keys(card.plan ?? {}).length === 0}
            onClick={() => onAction('apply')}
          >
            <Check className="h-3.5 w-3.5" /> {st === 'failed' ? '重试应用' : '确认调整'}
          </Button>
          <Button size="sm" variant="outline" className="h-8" onClick={() => onAction('edit')}>
            <Pencil className="h-3.5 w-3.5" /> 再改一下
          </Button>
          <Button size="sm" variant="ghost" className="h-8 text-muted-foreground" onClick={() => onAction('skip')}>
            <X className="h-3.5 w-3.5" /> 暂不调整
          </Button>
        </div>
      )}
      {st === 'applying' && (
        <div className="border-t bg-muted/30 px-3.5 py-2.5">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            上次应用未完成（可能保存时页面被刷新中断）。成果未被覆盖；点下方继续应用——已写入的部分会自动识别，不会重复执行。
          </p>
          <Button size="sm" variant="outline" className="mt-1.5 h-7" onClick={() => onAction('apply')}>
            <RotateCcw className="h-3 w-3" /> 继续应用
          </Button>
        </div>
      )}
      {st === 'applied' && (
        <div className="border-t bg-muted/30 px-3.5 py-2">
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {card.undoneFields && card.undoneFields.length > 0
              ? `部分完成：${card.undoneFields.map((k) => UNDONE_LABEL[k] ?? k).join('、')}未写入${card.failReason ? `（${card.failReason}）` : ''}；已成功写入的内容保持不变。`
              : '已写入对应成果，点击上方「查看」可跳转；不受影响的已确认内容保持原样。'}
          </p>
          {card.undoneFields && card.undoneFields.length > 0 && (
            <Button size="sm" variant="outline" className="mt-1.5 h-7" onClick={() => onAction('apply')}>
              <RotateCcw className="h-3 w-3" /> 重试未完成项
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
