import { INSPIRATIONS } from '@/data/inspiration';
import { matchPartnerCatalog } from '@/data/partnerCatalog';
import { ApiError, apiRequest, apiUrl, getAuthToken } from '@/lib/apiClient';
import { sendStreamRequest } from '@/lib/sse';
import type {
  AdjustCard,
  ChatMessage,
  Direction,
  InspirationEntry,
  ProjectData,
  SchedulePatchItem,
} from '@/types/types';

/**
 * AI 共策调用。提示词、需求摘要与模式指令全部由后端组装（backend/app/ai/），
 * 前端只发送数据：项目快照、用户话语、识图结果、选项，以及与本次话语匹配到的
 * 合作资源 / 灵感条目（结构化字段，由后端模板决定如何引用）。
 */
export type AiMode = 'chat' | 'directions' | 'theme' | 'scheme' | 'copies';

/** 候选方向字段级校验：字段超长/含协议分隔符/串列的直接丢弃，防止「方向名串入预算字段」类脏数据写入 */
export function sanitizeDirection(d: unknown, genId: () => string): Direction | null {
  if (!d || typeof d !== 'object') return null;
  const x = d as Record<string, unknown>;
  const str = (v: unknown, max: number): string | null => {
    if (typeof v !== 'string') return null;
    const s = v.trim().replace(/\s*\n\s*/g, ' ');
    if (!s || s.length > max || /[|｜{}"]/ .test(s)) return null;
    return s;
  };
  const name = str(x.name, 12);
  const style = str(x.style, 8);
  if (!name || !style) return null;
  const note = str(x.note, 40) ?? '';
  const difficulty = str(x.difficulty, 6);
  const budgetLevel = str(x.budgetLevel, 6);
  const highlights = Array.isArray(x.highlights)
    ? x.highlights.filter((h): h is string => typeof h === 'string' && h.trim() !== '' && h.trim().length <= 12 && !h.includes('|')).slice(0, 3)
    : [];
  return { id: genId(), name, style, highlights, difficulty: difficulty ?? undefined, budgetLevel: budgetLevel ?? undefined, note };
}

/** 中文数字列表容错（规则 10 的补充）：模型在长文回复中常用「方向一/方案二：名称 描述…」自然列表，
 * 而非协议行；此处把每段提取为 名称/风格/取舍说明，仍经 sanitizeDirection 校验后才可写入候选方向 */
const CN_LIST_MARKS = [
  ...['一', '二', '三', '四', '1', '2', '3', '4'].flatMap((n) => [`方向${n}`, `方案${n}`, `选项${n}`]),
];

function parseChineseListDirections(text: string, genId: () => string): Direction[] {
  const hits: { start: number; bodyStart: number; mark: string }[] = [];
  for (const mk of CN_LIST_MARKS) {
    const re = new RegExp(`${mk}[：:]`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      hits.push({ start: m.index, bodyStart: m.index + mk.length + 1, mark: mk });
    }
  }
  hits.sort((a, b) => a.start - b.start);
  const out: Direction[] = [];
  for (let i = 0; i < hits.length; i++) {
    const end = i + 1 < hits.length ? hits[i + 1].start : text.length;
    const seg = text.slice(hits[i].bodyStart, end).trim();
    const firstLine = (seg.split('\n')[0] ?? '').trim();
    /* 名称：段首短语（空格/逗号前截止）；note：优先截取「适合…」取舍句，退化取首句 */
    const nameM = firstLine.match(/^([^\s，,。；;|]{2,12})/);
    if (!nameM) continue;
    const name = nameM[1].trim();
    const fitM = seg.match(/适合[^\n。]{4,60}/);
    const noteSrc = fitM ? fitM[0] : firstLine.slice(name.length).replace(/^[\s，,。；;：:-]+/, '').slice(0, 60);
    /* 风格：名称已含主题词时直接沿用（≤8 字即合法风格）；否则取描述首短句，再退化用方向词 */
    let style = name.length <= 8 ? name : name.slice(0, 8);
    const descRest = firstLine.slice(name.length).replace(/^[\s，,。；;：:-]+/, '');
    const styleM = descRest.match(/^([^，,。；;\s]{2,8})/);
    if (styleM && !styleM[1].includes('把') && !styleM[1].includes('用') && !styleM[1].includes('做')) {
      style = styleM[1];
    }
    const d = sanitizeDirection({ name, style, note: noteSrc.trim() }, genId);
    if (d && !out.some((o) => o.name === d.name)) out.push(d);
    if (out.length >= 4) break;
  }
  return out;
}

/** 从 AI 回复中解析「建议方向：名称|风格|说明」结构化行（规则 10），供候选方向区承接 */
export function parseSuggestedDirections(text: string, genId: () => string): Direction[] {
  /* 兼容 3 段与 5 段：名称|风格|说明 或 名称|风格|难度|预算压力|说明 */
  const re = /建议方向[：:]\s*([^|\n]+)\|([^|\n]+)(?:\|([^|\n]+)\|([^|\n]+))?\|([^\n]+)/g;
  const out: Direction[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw =
      m[3] && m[4]
        ? { name: m[1], style: m[2], difficulty: m[3], budgetLevel: m[4], note: m[5] }
        : { name: m[1], style: m[2], note: m[5] };
    /* 每段独立校验：名称/风格超长或残留协议符的段落丢弃，不再整行写入 */
    const d = sanitizeDirection(raw, genId);
    if (d) out.push(d);
  }
  /* 协议行未命中：兼容模型自然输出的「方向一/方案二：…」中文列表（截名称与取舍说明，同样过校验） */
  if (out.length === 0) return parseChineseListDirections(text, genId);
  return out;
}

export interface AiChatResult {
  /** 流式聚合后的完整文本 */
  text: string;
  /** JSON 模式下解析出的结构（解析失败为 null） */
  json: unknown | null;
}

/** 回复详略三档（只影响下次自由讨论表达详略，不改历史，不影响结构化任务完整输出） */
export type ReplyDetail = 'brief' | 'medium' | 'detailed';

/** 按当前诉求挑选少量相关灵感条目（≤3 条）：标题/标签/玩法命中才算相关；无命中返回空，不伪造来源 */
export function relevantInspirations(userText: string, limit = 3): InspirationEntry[] {
  const text = userText.trim();
  if (text.length < 2) return [];
  const words = [
    ...new Set(
      text
        .replace(/[，。！？、；：""''（）\s]/g, ' ')
        .split(/[\s/]+/)
        .filter((w) => w.length >= 2)
    ),
  ];
  const scored = INSPIRATIONS.map((e) => {
    let score = 0;
    const title = e.title;
    for (const w of words) {
      if (title.includes(w)) score += 3;
      if (e.tags.some((t) => t.includes(w) || w.includes(t))) score += 2;
      if (e.howTo.includes(w)) score += 1;
    }
    return { e, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.e);
}

/** 合作资源与灵感目录仍在前端（多个页面共用）：这里只做确定性匹配，把命中条目以结构化字段交给后端 */
function partnerHints(userText: string, region?: string | null) {
  return matchPartnerCatalog(userText, 3, region ?? undefined).map((r) => ({ name: r.name, use: r.use, scenes: r.scenes }));
}

function inspirationHints(userText: string) {
  return relevantInspirations(userText).map((e) => ({ title: e.title, howTo: e.howTo, format: e.format, needs: e.needs }));
}

/** 发给后端的项目快照：去掉与提示词无关的界面状态与大字段，控制请求体积（后端只使用最近 12 条有效对话） */
function projectSnapshot(project: ProjectData): ProjectData {
  const { ui: _ui, pendingConfirm: _pending, ...rest } = project;
  const chatLog: ChatMessage[] = (project.chatLog ?? []).slice(-40).map((m) => ({
    id: m.id,
    role: m.role,
    content: m.content,
    ts: m.ts,
    ...(m.imageUrl ? { imageUrl: m.imageUrl } : {}),
    ...(m.vision ? { vision: m.vision } : {}),
  }));
  return { ...rest, chatLog };
}

/** 调用 AI 策划：chat 为流式对话（协议行由调用方解析），其余模式返回后端校验过的结构化结果。
 * vision 为独立图像理解服务对场地照片的真实识别结果。 */
export async function aiChat(
  mode: AiMode,
  project: ProjectData,
  userText: string,
  onChunk: (delta: string) => void,
  vision?: string,
  opts?: { detail?: ReplyDetail; nickname?: string | null; memOnly?: boolean; noScene?: boolean }
): Promise<AiChatResult> {
  const snapshot = projectSnapshot(project);

  if (mode !== 'chat') {
    const res = await apiRequest<{ mode: AiMode; data: unknown; promptVersion: string }>(`/api/v1/ai/plan/${mode}`, {
      method: 'POST',
      body: JSON.stringify({ project: snapshot, userText, nickname: opts?.nickname || undefined }),
    });
    return { text: JSON.stringify(res.data), json: res.data };
  }

  const region = (project.requirements?.region?.value as string | undefined) ?? null;
  let acc = '';
  await sendStreamRequest({
    functionUrl: apiUrl('/api/v1/ai/plan/chat'),
    requestBody: {
      project: snapshot,
      userText,
      vision: vision || undefined,
      detail: opts?.detail ?? 'medium',
      nickname: opts?.nickname || undefined,
      memOnly: !!opts?.memOnly,
      noScene: !!opts?.noScene,
      partnerHints: partnerHints(userText, region),
      inspirationHints: inspirationHints(userText),
    },
    authToken: getAuthToken(),
    onData: (data) => {
      if (data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data);
        const chunk = parsed.choices?.[0]?.delta?.content ?? '';
        if (chunk) {
          acc += chunk;
          onChunk(chunk);
        }
      } catch {
        /* 跳过无法解析的帧 */
      }
    },
    onComplete: () => undefined,
  });

  /* 流正常结束但无任何内容：视为异常，避免空消息落库形成空白气泡 */
  if (!acc.trim()) {
    throw new Error('AI 未返回内容，请稍后重试');
  }
  return { text: acc, json: null };
}

/** 从回复中提取「调整建议」围栏块：```调整建议 {...}```（sourceText 为触发本次建议的用户原文，供应用端范围校验） */
export function parseAdjustCard(text: string, sourceText?: string): Omit<AdjustCard, 'status'> | null {
  const m = text.match(/```调整建议\s*\n([\s\S]*?)```/);
  if (!m) return null;
  try {
    const raw = JSON.parse(m[1].trim());
    if (!raw || typeof raw.change !== 'string' || !raw.plan) return null;
    return {
      change: raw.change,
      affects: Array.isArray(raw.affects) ? raw.affects.filter((x: unknown) => typeof x === 'string') : [],
      keep: Array.isArray(raw.keep) ? raw.keep.filter((x: unknown) => typeof x === 'string') : [],
      pending: Array.isArray(raw.pending) ? raw.pending.filter((x: unknown) => typeof x === 'string') : [],
      manualWarn: Array.isArray(raw.manualWarn) ? raw.manualWarn.filter((x: unknown) => typeof x === 'string') : [],
      plan: sanitizeAdjustPlan(raw.plan),
      sourceText: sourceText?.trim() || undefined,
    };
  } catch {
    return null;
  }
}

/** 短字段清洗：去首尾空白、限长、剔除整段指令/操作说明式文本（含句号、分号、引号、换行、协议符） */
function shortField(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim().replace(/\s*\n\s*/g, ' ');
  if (!s || s.length > max) return undefined;
  /* 指令性文本特征：句中带句号/分号/冒号指令/引号或「保留/采用/不修改/保持不变」等操作词 → 拒绝写入短字段 */
  if (/[。；;“”"'|｜]/.test(s) || /(保留|采用|不变|不修改|不改动|改为|替换成)[^，,]{4,}/.test(s)) return undefined;
  return s;
}

/** plan 字段防御性清洗：新补丁协议（字段级），越界/含指令文本的字段一律丢弃不写入 */
function sanitizeAdjustPlan(p: Record<string, unknown> | undefined): AdjustCard['plan'] {
  if (!p || typeof p !== 'object') return {};
  const out: AdjustCard['plan'] = {};
  const strArr = (v: unknown, itemMax = 40): string[] | undefined => {
    if (v == null) return undefined;
    if (Array.isArray(v)) {
      const a = v
        .filter((x): x is string => typeof x === 'string')
        .map((x) => x.trim())
        .filter((x) => x !== '' && x.length <= itemMax && !/[|｜{}"]/.test(x));
      return a.length > 0 ? a : undefined;
    }
    if (typeof v === 'string') {
      const a = v.split(/[、，,;；/\n]+/).map((x) => x.trim()).filter((x) => x !== '' && x.length <= itemMax);
      return a.length > 0 ? a : undefined;
    }
    return undefined;
  };
  /* 兼容：模型若仍输出旧协议 schedule 完整数组，按「未指定字段级补丁」整体丢弃（应用端绝不整套替换） */
  if (p.visualTheme != null) {
    const vt = shortField(p.visualTheme, 24);
    if (vt) out.visualTheme = vt;
  }
  const th = p.theme as Record<string, unknown> | undefined;
  if (th && typeof th === 'object') {
    const t: NonNullable<AdjustCard['plan']['theme']> = {};
    if (typeof th.name === 'string') {
      const n = shortField(th.name, 20);
      if (n) t.name = n;
    }
    /* slogan/highlights 支持明确清空（null/空串） */
    if (th.slogan === null || th.slogan === '') t.slogan = null;
    else if (typeof th.slogan === 'string') {
      const s = shortField(th.slogan, 24);
      if (s) t.slogan = s;
    }
    const hl = strArr(th.highlights, 16);
    if (hl) t.highlights = hl;
    if (Object.keys(t).length > 0) out.theme = t;
  }
  /* schedulePatch：每项必须有定位键（id 或 name），只保留显式提供的字段（undefined=不动；null/空串=明确清空） */
  if (Array.isArray(p.schedulePatch)) {
    const list: SchedulePatchItem[] = [];
    for (const item of p.schedulePatch) {
      if (!item || typeof item !== 'object') continue;
      const x = item as Record<string, unknown>;
      const id = typeof x.id === 'string' && x.id.trim() ? x.id.trim() : undefined;
      const name = typeof x.name === 'string' && x.name.trim() ? x.name.trim() : undefined;
      if (!id && !name) continue;
      const pi: SchedulePatchItem = { ...(id ? { id } : {}), ...(name ? { name } : {}) };
      for (const f of ['time', 'duration', 'note', 'rename'] as const) {
        const v = x[f];
        if (v === null || v === '') {
          (pi as Record<string, unknown>)[f] = null; /* 明确清空 */
        } else if (typeof v === 'string' && v.trim()) {
          const s = v.trim().slice(0, f === 'note' ? 60 : 20);
          (pi as Record<string, unknown>)[f] = s;
        }
        /* undefined → 不写入该字段 = 保持原值 */
      }
      if (Object.keys(pi).length > Object.keys({ ...(id ? { id } : {}), ...(name ? { name } : {}) }).length) list.push(pi);
    }
    if (list.length > 0) out.schedulePatch = list;
  }
  if (Array.isArray(p.scheduleAdd)) {
    const list = p.scheduleAdd
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && typeof (x as Record<string, unknown>).name === 'string' && String((x as Record<string, unknown>).name).trim() !== '')
      .map((x) => ({
        name: String(x.name).trim().slice(0, 20),
        time: typeof x.time === 'string' ? x.time.trim().slice(0, 8) : '',
        duration: typeof x.duration === 'string' ? x.duration.trim().slice(0, 16) : '',
        note: typeof x.note === 'string' ? x.note.trim().slice(0, 60) : '',
      }));
    if (list.length > 0) out.scheduleAdd = list;
  }
  const srn = strArr(p.scheduleRemoveNames, 20);
  if (srn) out.scheduleRemoveNames = srn;
  if (Array.isArray(p.budgetAdd)) {
    const list = p.budgetAdd
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && typeof (x as Record<string, unknown>).name === 'string' && String((x as Record<string, unknown>).name).trim() !== '' && String((x as Record<string, unknown>).name).length <= 20)
      .map((x) => ({
        name: String(x.name).trim(),
        qty: Number(x.qty) || 1,
        /* null=待询价（不编造数字）；0=明确免费；数字=明确单价 */
        unitPrice: x.unitPrice == null ? null : Number(x.unitPrice) || 0,
      }));
    if (list.length > 0) out.budgetAdd = list;
  }
  const rn = strArr(p.budgetRemoveNames, 20);
  if (rn) out.budgetRemoveNames = rn;
  if (Array.isArray(p.materialsAdd)) {
    const list = p.materialsAdd
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && typeof (x as Record<string, unknown>).name === 'string' && String((x as Record<string, unknown>).name).trim() !== '' && String((x as Record<string, unknown>).name).length <= 20)
      .map((x) => ({
        category: typeof x.category === 'string' && x.category.trim() ? x.category.trim().slice(0, 8) : '其他',
        name: String(x.name).trim(),
        qty: x.qty == null ? '' : String(x.qty).slice(0, 12),
      }));
    if (list.length > 0) out.materialsAdd = list;
  }
  const mn = strArr(p.materialsRemoveNames, 20);
  if (mn) out.materialsRemoveNames = mn;
  const st = strArr(p.sceneTags, 16);
  if (st) out.sceneTags = st;
  if (p.sceneStyle != null) {
    const s = shortField(p.sceneStyle, 20);
    if (s) out.sceneStyle = s;
  }
  if (typeof p.sceneExtra === 'string' && p.sceneExtra.trim()) {
    /* 长说明不半句硬截断：超长时在句读边界（。！；；，、）收口，截断必落在标点之后 */
    const raw = p.sceneExtra.trim().replace(/\s*\n\s*/g, ' ');
    let s = raw;
    if (raw.length > 160) {
      const head = raw.slice(0, 160);
      const cut = Math.max(head.lastIndexOf('。'), head.lastIndexOf('！'), head.lastIndexOf('；'), head.lastIndexOf('，'), head.lastIndexOf('、'));
      s = cut >= 60 ? head.slice(0, cut + 1) : head;
    }
    if (s) out.sceneExtra = s;
  }
  return out;
}

/** 从正文里剥离调整建议围栏块（卡片渲染代替原文） */
export function stripAdjustBlock(text: string): string {
  return text.replace(/```调整建议\s*\n[\s\S]*?```/g, '').trimEnd();
}


/** AI 调用错误分类：把 HTTP 状态/网关报文转成用户可理解的说法，并给出是否可重试的提示。
 * 限流（429/rate limit）不自动重试、不追加收费调用——只提示用户手动重试与等待时间 */
export interface AiErrorInfo {
  kind: 'rate-limit' | 'network' | 'other';
  userMessage: string;
  /** 明确的等待提示（限流返回 retry after 时提取，无则按经验值） */
  waitHint?: string;
}
export function classifyAiError(e: unknown): AiErrorInfo {
  /* 后端统一错误体：按状态码判断（429 带 retryAfter 秒数；502 structured_output_invalid 为模型输出格式问题） */
  if (e instanceof ApiError) {
    if (e.status === 429) {
      const ra = typeof e.body?.retryAfter === 'number' ? e.body.retryAfter : null;
      const wait = ra == null ? '约 1 分钟' : ra >= 120 ? `约 ${Math.ceil(ra / 60)} 分钟` : `${ra} 秒`;
      return {
        kind: 'rate-limit',
        userMessage: e.message || 'AI 调用过于频繁',
        waitHint: `建议等待 ${wait} 后再点击重试；本次操作与输入已保留，不会自动重试`,
      };
    }
    if (e.body?.code === 'structured_output_invalid') {
      return { kind: 'other', userMessage: 'AI 返回的内容格式不正确', waitHint: '可点击重试本操作；本次操作与输入已保留' };
    }
  }
  const msg = e instanceof Error ? e.message : String(e ?? '');
  const rl = /(?:429|rate.?limit|tpm_|rpm_|qps|too many requests)/i.exec(msg);
  if (rl) {
    const ra = /retry.?after\s*[:=]?\s*(\d+)\s*(s|sec|seconds)?/i.exec(msg);
    const wait = ra ? `${ra[1]} 秒` : '约 1 分钟';
    return {
      kind: 'rate-limit',
      userMessage: 'AI 服务当前繁忙（请求限流）',
      waitHint: `建议等待 ${wait} 后再点击重试；本次操作与输入已保留，不会自动重试`,
    };
  }
  if (/HTTP|network|fetch|Failed to fetch|timeout|ECONN|网络/i.test(msg)) {
    return { kind: 'network', userMessage: '网络或 AI 服务连接失败', waitHint: '可稍后点击重试；本次操作与输入已保留' };
  }
  return { kind: 'other', userMessage: 'AI 服务返回异常', waitHint: '可点击重试本操作；本次操作与输入已保留' };
}
