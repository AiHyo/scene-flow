/**
 * 用户明确条件的程序化提取（PlanStart 创建与对话追问共用）。
 * 规则：按子句独立判断——「城市日期还没定」只影响该子句，不再全文误杀其他子句里的 20 人/3000 元；
 * 说未定/还没想好的字段保持未知不擅定；「不要/避免」类约束进入其他需求；
 * 只提取用户明确表达的事实，AI 建议与估算不在此提取、不冒称用户确认。
 */

const CLAUSE_SPLIT_RE = /[。！？\n；;，,：:]/;
const UNDECIDED_RE = /未定|还没|没想好|不确定|再说|待定/;

export interface ExplicitFacts {
  headcount: string | null;
  budgetLimit: number | null;
  /**
   * 预算语义：'hard' = 用户明确硬上限（上限/以内/不超过/最多…），可写入预算上限字段；
   * 'reference' = 参考估价（大概/左右/约/参考…），只记录为预算参考值，不当硬上限。
   */
  budgetKind: 'hard' | 'reference' | null;
  otherNeeds: string | null;
  /** 所在城市（用户明确提到的城市名；未定子句不提取） */
  region: string | null;
  /** 时间表述（「下周」「月底」等相对时间保留原文，不静默确定具体日期） */
  date: string | null;
  /** 明确活动时长（「活动2小时」「时长90分钟」等，原文保留；后续生成与校验携带，不静默丢弃） */
  duration: string | null;
}

/** 硬上限限定词：出现才把数字当作预算上限字段写入 */
const BUDGET_HARD_RE = /上限|以内|不超过|最多|封顶|别?超过|不高于|不超出/;
/** 参考估价限定词：明确不是硬上限，仅作参考记录 */
const BUDGET_REF_RE = /大概|左右|约|参考|差不多|可能|预计|估计|浮动/;

/** 子句内人数：如「给 20 人的团队」「人数改成 18 人」 */
const HEADCOUNT_RE = /(\d{1,5})\s*(?:位|名|个)?\s*人/;
/** 子句内预算：如「总预算 3000 元以内」「预算上限 2500」「花费 5000」「预算大概 3000」「3000 元的预算」；
 * 限定词（大概/约/参考等）可出现在金额前，由 budgetKind 区分硬上限与参考估价 */
const BUDGET_RE =
  /(?:预算上限|总预算|预算|花费上限|花费|上限)(?:大概|大约|左右|约|参考|差不多|预计|估计|改为?|设为?|调整?到?|是|为|:：)?\s*([\d,，.]+)\s*万?元?/;
const BUDGET_RE2 = /([\d,，.]+)\s*万?元?\s*(?:以内的?)?\s*(?:总)?预算/;
/** 其他需求约束子句：如「不要让个人上台表演」「避免高强度体能项目」 */
const OTHER_NEED_RE = /^(?:请?不要|别让?|避免|不希望|不能|不允许|无需增加)\s*\S.{1,28}$/;
/** 肯定式真实约束（子句内「需要/要求/必须」+ 具体设施/服务/人员词）：如「需要无障碍通道」「要求配手语翻译」；
 * 词表限定真实活动安排，避免把「需要你生成方案」这类请求混进活动条件 */
const NEED_ADD_RE = /(?:需要|要求|必须|希望(?:有|配)?|要(?:有|配)|得(?:有|配))[^。！？\n；;，,：:]{0,20}(?:无障碍|通道|坡道|轮椅|电梯|扶手|盲道|盲文|手语|翻译|陪护|协助|引导员|志愿者|安保|保险|医疗|急救|停车|接送|班车|茶歇|餐|饮水|母婴|儿童|老人|静音|隔音|空调|暖气|电源|音响|麦克风|投影|屏幕|灯光|摄影|摄像|主持|道具|物料|礼品|纪念品)/;
/** 本次操作限制类否定（生成目标类）：属于「这条消息里先别做某生成」的指令，不是活动的其他需求；
 * 与 OTHER_NEED_RE 形似（都含「不要」）但语义完全不同，单独排除、不写入 otherNeeds */
const GEN_LIMIT_RE = /^(?:请?不要|别|先别|先不|暂不|暂时不|不需要|不用|避免)\s*(?:重新?|再)?\s*(?:生成|制作|画|写|做|出)\S{0,10}(?:方案|图片|图|效果图|布置图|文案|主题|海报|邀请函)?/;
/** 城市词表（用户消息中出现即视为所在地区候选；子句含「未定」时不提取） */
const CITY_WORDS = ['北京', '上海', '广州', '深圳', '杭州', '成都', '南京', '武汉', '西安', '长沙', '重庆', '天津', '苏州', '郑州', '青岛', '厦门', '昆明', '沈阳', '大连', '福州', '合肥', '宁波', '无锡', '佛山', '东莞', '珠海', '济南', '哈尔滨', '长春', '石家庄', '太原', '南昌', '贵阳', '南宁', '兰州', '海口', '银川', '西宁', '呼和浩特', '乌鲁木齐'];
/** 时间表述（相对时间保留原文：下周/本周末/月底/10 月 20 日等；不转换成具体日期） */
const DATE_RE = /(下(?:周|个月|月|季度|学期)|本(?:周|月|周末)|这(?:周|周末|个月)|[0-9一二三四五六七八九十]{1,3}\s*月\s*[0-9一二三四五六七八九十]{1,3}\s*[日号]|\d{1,2}\s*月\s*\d{1,2}\s*日|周[一二三四五六日末]|月[底中]|年[底中]|国庆|中秋|五一|端午|元旦|春节|暑假|寒假)/;

export function extractExplicitFacts(text: string): ExplicitFacts {
  const clauses = (text ?? '')
    .split(CLAUSE_SPLIT_RE)
    .map((s) => s.trim())
    .filter(Boolean);
  let headcount: string | null = null;
  let budgetLimit: number | null = null;
  let budgetKind: 'hard' | 'reference' | null = null;
  let region: string | null = null;
  let date: string | null = null;
  let duration: string | null = null;
  const otherNeeds: string[] = [];
  for (const c of clauses) {
    const undecided = UNDECIDED_RE.test(c);
    if (!undecided) {
      if (!region) {
        const hit = CITY_WORDS.find((w) => c.includes(w));
        if (hit) region = hit;
      }
      if (!date) {
        const dm = c.match(DATE_RE);
        if (dm) date = dm[0];
      }
      if (!headcount) {
        const m = c.match(HEADCOUNT_RE);
        if (m) headcount = `${m[1]} 人`;
      }
      /* 明确时长：就近无「还没定」类否定（「时长还没定」不提取） */
      if (!duration && !undecided) {
        const dm = /(?:活动|时长|全程|整场)[^。；，\n]{0,6}?(\d+(?:\.\d+)?)\s*(?:个?小时|分钟)/.exec(c);
        if (dm) duration = dm[0];
      }
      if (budgetLimit == null) {
        const b = c.match(BUDGET_RE) ?? c.match(BUDGET_RE2);
        if (b) {
          const n = Number(b[1].replace(/[,,]/g, ''));
          if (Number.isFinite(n) && n > 0) {
            budgetLimit = b[0].includes('万') ? n * 10000 : n;
            budgetKind = BUDGET_HARD_RE.test(c) ? 'hard' : BUDGET_REF_RE.test(c) ? 'reference' : 'hard';
          }
        }
      }
    }
    /* 本次操作限制类否定（「不要生成完整方案/图片/文案」）≠ 活动的其他需求：
     * 不写入 otherNeeds 摘要（否则会作为活动条件长期存在）；真正的无障碍/避雨等约束照常提取，也不回溯清洗旧数据 */
    /* 肯定式真实约束不受 GEN_LIMIT 影响（那是「这条消息别做生成」的指令，与设施需求无关） */
    if ((OTHER_NEED_RE.test(c) || NEED_ADD_RE.test(c)) && !UNDECIDED_RE.test(c) && !GEN_LIMIT_RE.test(c)) otherNeeds.push(c);
  }
  return {
    headcount,
    budgetLimit,
    budgetKind,
    otherNeeds: otherNeeds.length > 0 ? otherNeeds.join('；') : null,
    region,
    date,
    duration,
  };
}

/* ---------------- 调整范围提取：确认卡范围校验用 ---------------- */

/** 模块键（与 AdjustPlan 的字段分组一一对应） */
export type ScopeModule =
  | 'schedule'
  | 'budget'
  | 'materials'
  | 'scene'
  | 'theme'
  | 'visualTheme'
  | 'conditions'
  | 'copies'
  | 'tasks';

export interface AdjustScope {
  /** 用户是否明确了「只改 X、其余不变」式限定 */
  restricted: boolean;
  /** 允许写入的模块；restricted=false 时为全量允许（仍受字段级 sanitize 约束） */
  allowed: ScopeModule[];
}

const SCOPE_ONLY_RE = /只(?:改|调整?|换|更新?|动|改一下|把)|仅(?:改|调整?|换|更新?)/;
const SCOPE_KEEP_RE = /(?:其余|其他|别的|剩下|别的都)[^，。；！？]{0,8}(?:不变|保持|不动|别动|保留)|(?:不要|别|不用)(?:动|改|碰|动到)/;
/** 「保持不变」清单段（含顿号/逗号并列与后续约束，如「，主题名称、口号…全部保持不变，不新增采购」）：
 *  从范围扫描文本中剥离，避免把「明确要求不动」的模块误判为本次允许修改的范围 */
const SCOPE_KEEP_CLAUSE_RE = /，[^，。]*?(?:(?:全部|都|均|一并)?(?:保持)?(?:不变|不动|别动|保留)|(?:不要|别|不用)(?:动|改|碰|动到|改到|碰))[^。；]*?(?=[。；]|$)/g;

const SCOPE_AREA_WORDS: Array<[ScopeModule, RegExp]> = [
  ['schedule', /时间|流程|环节|日程|签到|备注|时长|顺序|开场|闭幕|顺序/],
  ['visualTheme', /配色|颜色|色调|视觉主题|主色调|视觉风格/],
  ['theme', /主题名?称?|主题|亮点|口号|slogan/i],
  ['budget', /预算|费用|价格|金额|单价|花费|成本|取消|释放/],
  ['materials', /物料|物资|清单|采购/],
  ['tasks', /任务|待办|准备事项/],
  ['scene', /场景|布置|布置要求|装饰|风格|布置元素|补充要求/],
  ['copies', /文案|邀请函|主持词|现场指引/],
  ['conditions', /人数|日期|城市|地区|场地类型|风格偏好/],
];

/**
 * 从用户调整请求中提取允许修改的范围。
 * 「签到改成13:45，其余时间和备注不变」→ restricted=true, allowed=['schedule']；
 * 未出现限定表述时不限范围（靠字段级 sanitize 与确认卡兜底）。
 */
export function extractScope(text: string): AdjustScope {
  const t = text ?? '';
  const only = SCOPE_ONLY_RE.test(t);
  const keep = SCOPE_KEEP_RE.test(t);
  if (!only && !keep) return { restricted: false, allowed: [] };
  /* 范围扫描只针对「点名要改」的部分：先剥离保持不变清单段（其中提到的流程/预算/物料等
   * 是明确要求不动的模块，不是本次允许修改范围） */
  const tScoped = t.replace(SCOPE_KEEP_CLAUSE_RE, '');
  const allowed: ScopeModule[] = [];
  for (const [mod, re] of SCOPE_AREA_WORDS) {
    if (re.test(tScoped) && !allowed.includes(mod)) allowed.push(mod);
  }
  /* 提到「只改 X」但 X 无法识别时不做模块限定（避免误伤），交由字段校验与人工确认 */
  if (only && allowed.length === 0) return { restricted: false, allowed: [] };
  return { restricted: true, allowed };
}

/** 提交边界四态判定：空值（清空=按未知语义）/ 有效 0 / 合法数字 / 非法（负数、非有限数） */
export type NumInputState = 'empty' | 'zero' | 'valid' | 'invalid';
export function classifyNumInput(raw: string): { state: NumInputState; value: number | null } {
  const t = (raw ?? '').trim();
  if (t === '') return { state: 'empty', value: null };
  const n = Number(t);
  if (!Number.isFinite(n)) return { state: 'invalid', value: null };
  if (n < 0) return { state: 'invalid', value: null };
  return { state: n === 0 ? 'zero' : 'valid', value: n };
}

/** 数量/单价输入解析：负值与非有限数不写入（保持旧值）；空串为临时输入态也不写入 */
export function parseNonNegativeNum(raw: string): number | null {
  const s = (raw ?? '').trim();
  if (s === '') return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/** 合计防御：历史数据若已含负值/NaN，计算时归零，不产生非法总计 */
export function safeAmount(qty: unknown, price: unknown): number {
  const q = Number(qty);
  const p = Number(price);
  return (Number.isFinite(q) && q > 0 ? q : 0) * (Number.isFinite(p) && p > 0 ? p : 0);
}


/** 本次用户请求的动作边界：按动作分别识别允许/禁止项（子句级就近否定），而非全局布尔——
 * 「重新生成完整方案…不生成图片」= 允许方案、禁止图片；「只记条件，不生成方案/图片」= 两者都禁止。
 * 供三处使用：① 生成分发（allowScheme/allowScene/allowCopies 决定是否进入真实成果流程）；
 * ② AI 提示词注入【本次指令边界】；③ 回复解析守卫（allowSuggest 决定建议主题/方向是否写入候选） */
export interface UserIntent {
  /** 允许生成/重新生成完整方案（主题、流程、预算、物料、任务、文案） */
  allowScheme: boolean;
  /** 允许生成布置效果图（生图） */
  allowScene: boolean;
  /** 允许单独生成/重写文案（不重写方案其余部分） */
  allowCopies: boolean;
  /** 允许单独重新生成活动主题（走主题草稿确认链路，不进普通回复；建议类措辞不算） */
  allowTheme: boolean;
  /** 允许把建议主题/建议方向写入候选区（无明确生成请求的普通聊天语境） */
  allowSuggest: boolean;
  /** 只记条件/只解释/只讨论：不做任何生成、不写入任何成果 */
  memOnly: boolean;
  /** 本次明确禁止生成图片/效果图（回落对话时提示词继续遵守） */
  sceneNegated: boolean;
}

/** 否定标记（就近窗口匹配：目标词前 8 字内出现即视为否定该目标，支持「生成文案但不要重新生成方案」中部转折） */
const NEG_MARK_RE = /(?:不要|不用|无需|无须|先不|暂不|暂时不|不需要|别|不|勿|莫)/;
/** 各动作的生成目标词（多同义词逐一就近判定） */
const SCHEME_TARGETS = ['完整方案', '整个方案', '方案', '计划'];
const SCENE_TARGETS = ['效果图', '布置图', '场景图', '现场图', '图片', '生图', '配图', '插图'];
const COPIES_TARGETS = ['文案', '邀请函', '主持词', '现场指引'];
const THEME_TARGETS = ['活动主题', '主题名', '主题词', '新主题', '主题'];
/** 建议/参考类措辞（多候选讨论语境）：只保持建议展示，不进入替换类草稿链路 */
const SUGGEST_HINT_RE = /建议|推荐|备选|参考|几个|一些|哪些/;
/** 精确字段修改动作（「把X改为Y/换成Y」）：明确的修改请求，走对话回复中的调整建议确认卡，
 * 不被「其余字段保持不变」的保留措辞误判成「只记条件」 */
const ADJUST_ACT_RE = /改为|改成|换成|调整为|修改为|替换为/;
/** 保留约束词：其后列举的字段是明确保留项（「主题名称、口号…全部保持不变」），
 * 压过其他子句的正向关键词命中——不靠正向词盖过明确保留条件 */
const PRESERVE_MARK_RE = /保持不变|保持原样|保持不动|全部保持|都?保持|不要动|都?不要改|不要修改|原样保留|一律不动/;
/** 保留子句中的具体字段名 → 对应动作被保留约束压住 */
const PRESERVE_THEME_RE = /主题名称|主题名|口号|标语/;
const PRESERVE_SCHEME_RE = /流程|预算|费用|物料|任务|方案|计划/;
/** 生成动作词 */
const GEN_ACT_RE = /(?:重新生成|生成|整理|制定|制作|渲染|做|给我|出|写|画(?!风|面|册|报)|配(?!色))/;
/** 选择/应用动作词：用户明确选用上文建议的主题并要求应用到活动主题（「我选择刚才的X…应用到活动主题」）
 * ——同样进入主题草稿确认链路（草稿=用户选中的那组内容，确认才替换），不要求用户记固定关键词 */
const APPLY_ACT_RE = /选择|选用|采用|就用|选定|套用|应用到|应用|替换|定稿|敲定/;
/** 目标词前 8 字窗口内是否有否定标记（否定就近修饰该目标；「但不要…」中部转折同样生效） */
function negBefore(clause: string, target: string): boolean {
  let i = clause.indexOf(target);
  while (i >= 0) {
    if (NEG_MARK_RE.test(clause.slice(Math.max(0, i - 8), i))) return true;
    i = clause.indexOf(target, i + 1);
  }
  return false;
}
/** 目标词出现且就近无否定、子句含生成动作 → 视为对该动作的明确请求 */
function reqHit(clause: string, targets: string[]): boolean {
  return targets.some((t) => clause.includes(t) && !negBefore(clause, t)) && GEN_ACT_RE.test(clause);
}
function negHit(clause: string, targets: string[]): boolean {
  return targets.some((t) => clause.includes(t) && negBefore(clause, t));
}
/** 「只记条件/只解释/只讨论」语义（无任何生成请求时成立） */
const MEM_ONLY_RE =
  /(?:只|仅|先|请?只)(?:简短|简明|简单|快速|逐条)?(?:地|的)?(?:记住|记下|记录|确认|说明|解释|回答|了解|知道|看一下|核对)|(?:暂不|先不|不用|无需)(?:修改|调整|变更|更新|动)|保持(?:现状|不变)|先记着|只登记/;
const DISCUSS_ONLY_RE = /(?:只|仅|先)?(?:讨论|聊聊|聊一聊|商量|问问|咨询)[^，。；;\n]{0,8}$|(?:先)?不(?:要)?(?:写入|保存|改动|修改)/;

export function classifyUserIntent(text: string): UserIntent {
  const clauses = (text ?? '')
    .split(CLAUSE_SPLIT_RE)
    .map((c) => c.trim())
    .filter(Boolean);
  let schemeReq = false;
  let sceneReq = false;
  let copiesReq = false;
  let themeReq = false;
  let themeNeg = false;
  let preserveTheme = false;
  let preserveScheme = false;
  let schemeNeg = false;
  let sceneNeg = false;
  let copiesNeg = false;
  for (const c of clauses) {
    /* 「不生成图片」= 否定就近修饰的图片目标；同句其他子句的「重新生成完整方案」不受影响 */
    if (reqHit(c, SCHEME_TARGETS)) schemeReq = true;
    if (reqHit(c, SCENE_TARGETS)) sceneReq = true;
    if (reqHit(c, COPIES_TARGETS)) copiesReq = true;
    /* 主题替换请求：就近无否定、含生成动作、且非建议讨论措辞（「给我几个主题建议」保持建议不进草稿链路）；
     * 「场景主题」是场景配色/风格语境（如「场景主题中的颜色」），不是活动主题目标，不参与主题命中 */
    const cForTheme = c.replace(/场景主题/g, '■');
    if ((reqHit(cForTheme, THEME_TARGETS) || (THEME_TARGETS.some((t) => cForTheme.includes(t)) && APPLY_ACT_RE.test(cForTheme))) && !SUGGEST_HINT_RE.test(c)) {
      themeReq = true;
    }
    if (negHit(cForTheme, THEME_TARGETS)) themeNeg = true;
    /* 保留约束：含保留词的子句里出现的具体字段是明确保留项，压过其他子句的正向命中 */
    if (PRESERVE_MARK_RE.test(c)) {
      if (PRESERVE_THEME_RE.test(c)) preserveTheme = true;
      if (PRESERVE_SCHEME_RE.test(c)) preserveScheme = true;
    }
    if (negHit(c, SCHEME_TARGETS)) schemeNeg = true;
    if (negHit(c, SCENE_TARGETS)) sceneNeg = true;
    if (negHit(c, COPIES_TARGETS)) copiesNeg = true;
  }
  /* 「生成完整方案」本身包含文案：有方案请求时不再单独分发文案 */
  /* 保留项压过正向命中：明确说「主题名称/口号保持不变」时即使别处出现「主题」字样也不进入主题重生成；
   * 精确字段修改（如配色调整）由此回落对话/补丁确认流程 */
  const allowScheme = schemeReq && !schemeNeg && !preserveScheme;
  const allowScene = sceneReq && !sceneNeg;
  /* 文案字段级保留（「邀请函保持不变」）不拦整链路：只改部分文案仍走文案草稿确认流程 */
  const allowCopies = copiesReq && !copiesNeg && !allowScheme;
  /* 主题请求与方案请求互斥（「按主题整理完整方案」属方案，主题随方案一起生成） */
  const allowTheme = themeReq && !themeNeg && !schemeReq && !preserveTheme;
  const memOnlyWords = MEM_ONLY_RE.test(text ?? '') || DISCUSS_ONLY_RE.test(text ?? '');
  /* 本次明确的生成请求优先于「只记/只讨论」措辞（历史限制不压过本次新操作）；
   * 「其余保持不变」是保留约束不是只记条件——句中有精确修改动作（改为/换成）时按修改请求走对话与调整确认卡 */
  const memOnly =
    memOnlyWords && !schemeReq && !sceneReq && !copiesReq && !themeReq && !ADJUST_ACT_RE.test(text ?? '');
  const allowSuggest = !memOnly && !schemeReq && !sceneReq && !copiesReq && !themeReq;
  return { allowScheme, allowScene, allowCopies, allowTheme, allowSuggest, memOnly, sceneNegated: sceneNeg };
}
