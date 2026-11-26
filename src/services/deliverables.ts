import type { ProjectData, ProjectRequirements, RequirementValue } from '@/types/types';

/** 待完善事项：指向工作区对应成果页签（plan/scene/budget），不触发 AI 请求 */
export interface PendingItem {
  text: string;
  tab: 'plan' | 'scene' | 'budget';
  /** 字段级定位：'requirements' = 打开需求摘要编辑位置（未知条件入口） */
  field?: 'requirements';
}

/** 需求摘要中「值 + 来源」型字段（区分已确认 / AI 建议 / 未定） */
/** 需求字段的「未知占位值」：值本身是还没想好/待定类占位串（历史活动兼容）或空——
 * 即使 source 标 confirmed 也不是已确认事实；预览与 PDF 打印共用此判定，不在展示层重复猜 */
const UNKNOWN_REQ_VALUE_RE = /^(?:还没想好|还没定|没有想好|待定|日期待定|人数待定|预算待定|未定|不确定|暂未确定|暂不定|再想想|待确认|待补充|—|-|无|暂无)\s*$/;
/** 纯文本版（输入框值等场景共用）：空串或未知占位串 */
export function isUnknownReqText(raw: string | null | undefined): boolean {
  if (raw == null || String(raw).trim() === '') return true;
  return UNKNOWN_REQ_VALUE_RE.test(String(raw).trim());
}
export function isUnknownReqValue(v: { value?: string | number | null; source?: string } | null | undefined): boolean {
  if (v == null) return true;
  return isUnknownReqText(v.value == null ? '' : String(v.value));
}

export const REQ_VAL_FIELDS: Array<{
  key: 'visualTheme' | 'headcount' | 'budget' | 'region' | 'date' | 'venueType' | 'style';
  label: string;
}> = [
  { key: 'visualTheme', label: '视觉主题' },
  { key: 'headcount', label: '人数' },
  { key: 'budget', label: '预算' },
  { key: 'region', label: '地区' },
  { key: 'date', label: '日期' },
  { key: 'venueType', label: '场地类型' },
  { key: 'style', label: '风格偏好' },
];

export function reqVal(req: ProjectRequirements, key: (typeof REQ_VAL_FIELDS)[number]['key']): RequirementValue | undefined {
  return req[key];
}

/** 按当前真实数据构建待完善清单（未知条件允许留空，仅作核对提示不强制补齐） */
export function buildPendings(d: ProjectData): PendingItem[] {
  const out: PendingItem[] = [];
  if (!d.theme) out.push({ text: '活动方案尚未生成（主题、流程与文案）', tab: 'plan' });
  else if ((d.schedule ?? []).length === 0) out.push({ text: '活动流程还是空的', tab: 'plan' });
  if (!d.scene?.beforeUrl) out.push({ text: '还没有上传场地原图', tab: 'scene' });
  else if (!d.scene?.afterUrl) out.push({ text: '布置效果图还没生成', tab: 'scene' });
  else if (d.scene.stale) out.push({ text: '布置要求已调整，当前效果图对应旧要求（重新生成由你主动触发）', tab: 'scene' });
  if (d.budget?.limit == null) out.push({ text: '预算上限未设定（允许保持未知）', tab: 'budget' });
  const items = d.budget?.items ?? [];
  if (items.some((it) => it.priceUnknown === true)) out.push({ text: '有费用项价格待询（未计入合计）', tab: 'budget' });
  if ((d.materials ?? []).some((m) => !m.ready)) out.push({ text: '部分物料还没标记就绪', tab: 'budget' });
  if ((d.directions ?? []).length > 0 && !d.selectedDirectionId) out.push({ text: '候选方向还没选定', tab: 'plan' });
  /* 与预览/PDF 同一 isUnknownReqValue 判定：「还没想好/日期待定」等占位串也是未知，不因非空而漏报 */
  const missing = REQ_VAL_FIELDS.filter((f) => isUnknownReqValue(d.requirements?.[f.key])).map((f) => f.label);
  if (missing.length > 0) out.push({ text: `以下条件还是未知（允许留空）：${missing.join('、')}`, tab: 'plan', field: 'requirements' });
  return out;
}

/** 从结构化流程表推导活动起止时间（文案与预览共用同一来源，不让模型猜结束时间）：
 * start=首项开始时间；end=末项开始时间+其时长（无时长按该项开始时间计）；
 * 结束时间跨过午夜即标记 crossDay（末项开始早于首项，或末项开始于当天但加上时长后过了 24 点）；
 * 任一环节缺时间则返回 null（时间未定） */
export function deriveTimeRange(
  schedule: Array<{ time?: string | null; duration?: string | null }> | null | undefined
): { start: string; end: string; crossDay: boolean } | null {
  const items = (schedule ?? []).filter((it) => it && it.time && /\d{1,2}:\d{2}/.test(it.time ?? ''));
  if (items.length === 0) return null;
  const toMin = (t: string) => {
    const m = t.match(/(\d{1,2}):(\d{2})/);
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };
  const first = items[0];
  const last = items[items.length - 1];
  const s = toMin(first.time ?? '');
  const l = toMin(last.time ?? '');
  if (s == null || l == null) return null;
  const dm = (last.duration ?? '').match(/(\d{1,3})\s*(?:小时|h|hour)/i);
  const mm = (last.duration ?? '').match(/(\d{1,3})\s*(?:分钟|min)/i);
  const dur = dm ? Number(dm[1]) * 60 : mm ? Number(mm[1]) : /半场|半小时/.test(last.duration ?? '') ? 30 : 0;
  let end = l + dur;
  let crossDay = false;
  if (end < s) {
    /* 末项早于首项：跨日流程（end 已按分钟计但跨过 24 点未标记），或数据异常——按跨日处理并修正到次日 */
    crossDay = true;
    end += 24 * 60;
  }
  /* 结束分钟数到达 24 点即为次日结束（如 23:30 开始的环节持续 90 分钟，结束于次日 01:00） */
  if (end >= 24 * 60) crossDay = true;
  const fmt = (min: number) => `${String(Math.floor((min % 1440) / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  return { start: fmt(s), end: fmt(end), crossDay };
}

/** 保存前可确定矛盾检查：文案里「HH:MM—HH:MM」区间若起点与流程推导起点一致而终点不一致（如流程末项
 * 16:00+10 分钟=16:10，邀请函却写 13:45—16:00），以流程推导结果修正终点；未匹配区间不改动 */
export function fixCopiesTimeRange(
  copies: { invite?: string | null; hosting?: string | null } | null | undefined,
  range: { start: string; end: string } | null
): { invite: string; hosting: string; fixed: boolean } {
  const invite = copies?.invite ?? '';
  const hosting = copies?.hosting ?? '';
  if (!range || (!invite && !hosting)) return { invite, hosting, fixed: false };
  const re = new RegExp(`(${range.start.replace(':', ':')})\\s*[—–~～至]+\\s*(\\d{1,2}:\\d{2})`, 'g');
  let fixed = false;
  const fix = (t: string) =>
    t.replace(re, (_m, a, b) => {
      if (b !== range.end) {
        fixed = true;
        return `${a}—${range.end}`;
      }
      return _m;
    });
  return { invite: fix(invite), hosting: fix(hosting), fixed };
}


/** 日期未定校验：需求摘要日期未知时，把文案里编造的相对日期（下周日/这周六/明天）
 * 与具体日期（X月X日）改为「日期待定」，不虚构确定日期；用户已定日期则原样保留。
 * dateUnknown=日期已明确时传 false 跳过。 */
export function sanitizeCopiesDates(
  copies: { invite?: string | null; hosting?: string | null; onsite?: string[] | null } | null | undefined,
  dateUnknown: boolean
): { invite: string; hosting: string; onsite: string[]; fixed: boolean } {
  const invite = copies?.invite ?? '';
  const hosting = copies?.hosting ?? '';
  const onsite = (copies?.onsite ?? []).map((l) => l ?? '');
  if (!dateUnknown || (!invite && !hosting && onsite.every((l) => !l))) {
    return { invite, hosting, onsite, fixed: false };
  }
  let fixed = false;
  /* 相对日期词（编造高频词）与具体月日，统一改待定 */
  const REL_DATE_RE = /(下?周[一二三四五六日末天]|明[天后晚]|[0-9]{1,2}\s*月\s*[0-9]{1,2}\s*[日号](?!\S*\d))/g;
  const fix = (t: string) =>
    t.replace(REL_DATE_RE, (m0) => {
      fixed = true;
      return '日期待定';
    });
  return { invite: fix(invite), hosting: fix(hosting), onsite: onsite.map(fix), fixed };
}

/** 文案事实校验上下文：只来自用户已确认的数据（场地照片/物料就绪勾选/需求其他要求），
 * 旧 AI 草稿与模型新草稿都不作为事实来源 */
export interface CopiesFactCtx {
  /** 用户已采纳/确认的布置位置表述（如「签到处在入口左侧」经用户确认）：
   * 场地照片只说明有参考图，不能自动确认具体位置安排——不在清单内的方位一律改建议/待确认 */
  confirmedSpots?: string[];
  /** 已勾选就绪的物料名清单（「已备好/已就位/随意取用」只有提到清单内且已就绪的物料才成立） */
  readyMaterialNames: string[];
  /** 当前物料清单全部名称（区分三态：不在清单→建议准备；在清单未就绪→备好后可取用；就绪→断言成立） */
  allMaterialNames?: string[];
  /** 需求摘要的其他要求（「需要无障碍通道」是选址要求，不是已落实的事实） */
  requirementNeeds: string;
}

const SENT_SPLIT_RE = /(?<=[。！？!?\n])/;

/** 生成后可核对状态校验：把无依据的事实断言改为待确认/建议措辞（不是删除创意内容）。
 * 规则逐句定点修正——只动命中句，其余创意文字原样保留；返回修正说明供概述使用 */
export function sanitizeCopiesFacts(
  copies: { invite?: string | null; hosting?: string | null; onsite?: string[] | null } | null | undefined,
  ctx: CopiesFactCtx
): { invite: string; hosting: string; onsite: string[]; fixes: string[] } {
  const fixes: string[] = [];
  const noteKinds = new Set<string>();
  const sanitizeText = (text: string): string => {
    if (!text) return text;
    const out = text
      .split(SENT_SPLIT_RE)
      .map((sent) => {
        let s2 = sent;
        /* ① 位置方位：照片存在≠位置已确认（只能说明有参考图）——未出现在已采纳布置位置清单里的
         * 「入口左侧/靠窗/角落」都是未确认布局 → 改「附近」并标注以实际场地为准 */
        if (
          /(左侧|右边|左边|右侧|靠窗|角落里?|墙边)/.test(s2) &&
          !ctx.confirmedSpots?.some((sp) => sp && s2.includes(sp))
        ) {
          s2 = s2.replace(/(入口|大门?|门|窗|舞台|签到处|茶歇区?|前台|墙面?)(的)?(左侧|右边|左边|右侧|靠窗处?|角落里?|墙边)/g, '$1附近');
          s2 = s2.replace(/(左侧|右边|左边|右侧|靠窗处?|角落里?|墙边)/g, '附近');
          s2 = s2.replace(/([。！？!?\n]?\s*)$/, '（位置以实际场地为准，待确认）$1');
          noteKinds.add('位置表述');
        }
        /* ② 就绪状态三态：活动安排建议 / 清单存在 / 实际备好 是三件事。
         * 断言动词（已备好/已就位…）与取用暗示（随意取用/尽享）都要求句中提到的物料在就绪清单里才成立；
         * 在清单但未就绪 → 待准备措辞（备好后可取用）；不在清单 → 同样改为建议准备（视需要采购）。
         * 位置待确认附注不能抵消就绪断言；用户采纳一份文案不等于物料已就位 */
        /* 命中就绪/取用断言时：先剥掉模型可能自加的「（状态待确认）」类尾注，
         * 避免与统一替换叠加成「准备状态待确认（状态待确认）」式重复；替换措辞本身自然成句 */
        const stripNote = (x: string) => x.replace(/（[^）]{0,8}(?:状态)?待确认[^）]{0,4}）/g, '');
        const readyHit = /(已)(备好|准备好|准备(?!好)|买好|购买|订好|到位|落实|就位|备齐|齐全|安排妥当)/.exec(s2);
        const grabHit = /(可)?(随意|自由|尽情)取用|尽享/.test(s2);
        if (readyHit || grabHit) {
          const mentioned = (ctx.allMaterialNames ?? []).filter((n) => n && s2.includes(n));
          const notReady = mentioned.some((n) => !ctx.readyMaterialNames.includes(n));
          /* 句中出现清单外物料（含小奖品/点心等类别词）→ 同样不是已落实事实 */
          const offList = /(茶歇|饮料|点心|小食|零食|水果|甜品|奖品|小奖品|礼品|伴手礼)/.test(s2) && !mentioned.some((n) => s2.includes(n) && ctx.readyMaterialNames.includes(n));
          if (notReady || offList) {
            s2 = stripNote(s2);
            if (readyHit) {
              const verb = readyHit[2];
              const replaceMap: Record<string, string> = { 备好: '准备状态待确认', 准备好: '准备状态待确认', 准备: '准备状态待确认', 买好: '采购状态待确认', 购买: '采购状态待确认', 订好: '预订状态待确认', 到位: '准备状态待确认', 落实: '落实状态待确认', 就位: '准备状态待确认', 备齐: '准备状态待确认', 齐全: '准备状态待确认', 安排妥当: '安排状态待确认' };
              s2 = s2.replace(`已${verb}`, replaceMap[verb] ?? '准备状态待确认');
            }
            if (grabHit) {
              /* 自然成句不加括号尾巴：「备好后」本身即表达待确认语义 */
              s2 = s2.replace(/(可)?(随意|自由|尽情)取用/g, '备好后可取用');
              s2 = s2.replace(/尽享/g, '备好后尽享');
            }
            noteKinds.add('物料就绪状态');
          }
        }
        /* ③ 距离/步行时间：无任何已确认来源 → 改待确认，保留话题本身 */
        if (/(步行|走路|车程)[^，。；;\n]{0,6}\d+\s*分钟/.test(s2)) {
          s2 = s2.replace(/(步行|走路|车程)([^，。；;\n]{0,6})\d+\s*分钟/g, '$1（距离待确认）');
          noteKinds.add('距离表述');
        }
        /* ④ 「保证有/确保有/已配备」设施：用户的要求是选址条件，不是已经落实的事实 */
        if (/(保证|确保|已)(有|配备|安排)/.test(s2) && /(无障碍|通道|坡道|轮椅|电梯|扶手|盲道|手语)/.test(s2)) {
          s2 = s2.replace(/(保证|确保|已)(有|配备了?|安排了?)/, '选址要求$2');
          noteKinds.add('无障碍等要求表述');
        }
        return s2;
      })
      .join('');
    return out;
  };
  const invite = sanitizeText(copies?.invite ?? '');
  const hosting = sanitizeText(copies?.hosting ?? '');
  const onsite = (copies?.onsite ?? []).map((l) => sanitizeText(l ?? ''));
  if (noteKinds.size > 0) {
    fixes.push(`已将${[...noteKinds].join('、')}中无依据的断言改为待确认措辞`);
  }
  return { invite, hosting, onsite, fixes };
}
