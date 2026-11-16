/** 方案时长一致性程序化校验：在提交结果前用结构化流程核对总时长，
 * 而不是仅靠提示词约束。原则：
 * - 用户明确时长（如「活动2小时」）存在 → 流程环节总时长不得超过；
 * - 超出时优先均匀压缩环节时长（不编造、不静默延长、不动名称/备注），
 *   压缩后仍超（存在无法压缩的刚性环节）→ 返回 needAsk=true 由用户取舍；
 * - 起止时间从首环节开始时间起按时长顺序推导，末环节结束=首环节开始+总时长；
 * - 个人时长类亮点/说明的口径由调用方对人数与流程统一（本模块只管流程）。 */

export interface ScheduleDurItem {
  name?: string;
  time?: string;
  duration?: string;
}

/** 「30 分钟」「1 小时」「1.5 小时」「90分钟」「2h」→ 分钟数 */
export function parseDurToMin(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const s = String(raw).trim();
  let m = /(\d+(?:\.\d+)?)\s*(?:个?小时|小时|h|H)/.exec(s);
  if (m) {
    const h = Number(m[1]);
    let total = h * 60;
    const rest = s.slice(m.index + m[0].length);
    const mm = /(\d+)\s*分/.exec(rest);
    if (mm) total += Number(mm[1]);
    return Number.isFinite(total) ? total : null;
  }
  m = /(\d+(?:\.\d+)?)\s*分/.exec(s);
  if (m) return Number(m[1]);
  if (/^(?:半天|一?个下午|一?个晚上)/.test(s)) return null; /* 粗略表述不硬算 */
  return null;
}

/** 「14:00」→ 分钟数 */
function hhmmToMin(t: string | null | undefined): number | null {
  if (!t) return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return h * 60 + mi;
}

/** 「14:05」格式化 */
function minToHHmm(min: number): string {
  const m = ((min % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * 把流程总时长收敛到目标时长（分钟）内。
 * - 未超（含未解析出任何时长/目标未知）→ 原样返回（unknown/缺失时长环节不动，不编造）；
 * - 超出 → 按各环节时长比例压缩（有解析时长的环节），重排 time 使起止连续一致；
 * - 单环节压到 5 分钟仍超 → needAsk（刚性内容过多，须用户取舍，不静默延长）。
 */
export function fitScheduleDur<T extends ScheduleDurItem>(items: T[], targetMin: number | null): { items: T[]; changed: boolean; needAsk: boolean; totalMin: number } {
  if (targetMin == null || targetMin <= 0 || items.length === 0) return { items, changed: false, needAsk: false, totalMin: NaN };
  const durs: Array<number | null> = items.map((it) => parseDurToMin(it.duration));
  const known = durs.filter((d): d is number => d != null && d > 0);
  if (known.length === 0) return { items, changed: false, needAsk: false, totalMin: NaN };
  let total = 0;
  for (const d of durs) total += d ?? 0;
  if (total <= targetMin) return { items, changed: false, needAsk: false, totalMin: total };
  /* 比例压缩：仅按已知时长环节按比例分摊目标时长（保底 5 分钟） */
  const scale = targetMin / total;
  const newDurs: Array<number | null> = durs.map((d) => (d == null ? null : Math.max(5, Math.round(d * scale))));
  let newTotal = 0;
  for (const d of newDurs) newTotal += d ?? 0;
  /* 保底抬升后仍超：从最长环节继续扣减（不低于5） */
  let guard = 0;
  while (newTotal > targetMin && guard < 100) {
    let maxI = -1;
    let maxV = 4;
    for (let i = 0; i < newDurs.length; i++) {
      if (newDurs[i] != null && newDurs[i]! > maxV) {
        maxV = newDurs[i]!;
        maxI = i;
      }
    }
    if (maxI < 0) break;
    newDurs[maxI] = Math.max(5, newDurs[maxI]! - 1);
    newTotal = 0;
    for (const d of newDurs) newTotal += d ?? 0;
    guard++;
  }
  if (newTotal > targetMin) return { items, changed: false, needAsk: true, totalMin: newTotal };
  /* 重排 time：保持首环节开始时间不变（无有效开始时间用 14:00 默认起点，不伪造具体日期） */
  let start = hhmmToMin(items.find((it) => it.time)?.time) ?? 14 * 60;
  const out = items.map((it, i) => {
    const d = newDurs[i];
    if (d == null) return { ...it, time: it.time ?? '' };
    const next = { ...it, time: minToHHmm(start), duration: d >= 60 ? `${d % 60 === 0 ? d / 60 : (d / 60).toFixed(1)} 小时` : `${d} 分钟` };
    start += d;
    return next;
  });
  return { items: out, changed: true, needAsk: false, totalMin: newTotal };
}

/** 文案中的起止时间与总时长同步：把「HH:mm–HH:mm」「HH:mm至HH:mm」「HH:mm—HH:mm」
 * 范围与「X小时/X分钟」总时长表述改写为结构化流程推导出的实际区间（同一数据源） */
export function syncCopiesTimes(text: string | null | undefined, startHHmm: string, endHHmm: string, totalMin: number): string {
  if (!text) return text ?? '';
  let out = text;
  /* 起止区间（含全角破折/波浪线） */
  out = out.replace(/(\d{1,2}:\d{2})\s*[–—~〜至到-]\s*(\d{1,2}:\d{2})/g, `${startHHmm}–${endHHmm}`);
  /* 总时长表述（仅当程序值可靠） */
  if (Number.isFinite(totalMin) && totalMin > 0) {
    const label = totalMin % 60 === 0 ? `${totalMin / 60} 小时` : `${totalMin} 分钟`;
    out = out.replace(/约?\s*(?:半天|[一二三四五六七八九十\d.]+\s*(?:个?小时|小时|分钟))\s*(?:的时长|左右)?/g, (m0) => (/(?:半天)/.test(m0) ? m0 : label));
    /* 个人时长口径同步（缺陷修复）：「每人 6 分钟」「5 人每人 6 分钟」等表述若与环节实际时长矛盾
     * （如环节 29 分钟却写每人 6 分钟），按环节时长/人数改写为一致口径，不保留编造数字 */
    out = out.replace(
      /(\d+)\s*人\s*(?:每人|各|每人人?手)?\s*(\d+)\s*分钟/g,
      (m0, nStr, perStr) => {
        const n = Number(nStr);
        const per = Number(perStr);
        if (!Number.isFinite(n) || !Number.isFinite(per) || n <= 0 || per <= 0) return m0;
        if (n * per === totalMin) return m0; /* 已一致，不动 */
        /* 以环节实际总时长为准重写：人数保留，每人时长=总时长/人数（保留 1 位小数去尾 0） */
        const newPer = totalMin / n;
        const perLabel = Number.isInteger(newPer) ? String(newPer) : newPer.toFixed(1).replace(/\.0$/, '');
        return `${nStr} 人每人 ${perLabel} 分钟`;
      }
    );
    out = out.replace(
      /每人\s*(\d+)\s*分钟/g,
      (m0, perStr) => {
        const per = Number(perStr);
        if (!Number.isFinite(per) || per <= 0) return m0;
        return m0; /* 单独「每人 X 分钟」无人数基准：不编造人数，保留原文（上条已覆盖 N人每人） */
      }
    );
  }
  return out;
}

/** 计算流程实际区间（首环节 time+duration 连续推到末环节结束），供文案/主题说明共用 */
export function scheduleRange<T extends ScheduleDurItem>(items: T[]): { start: string; end: string; totalMin: number } | null {
  const first = items.find((it) => it.time && hhmmToMin(it.time) != null);
  if (!first) return null;
  let cur = hhmmToMin(first.time) as number;
  const start = cur;
  let total = 0;
  for (const it of items) {
    const d = parseDurToMin(it.duration);
    if (d != null && d > 0) {
      total += d;
      cur += d;
    }
  }
  if (total <= 0) return null;
  return { start: minToHHmm(start), end: minToHHmm(cur), totalMin: total };
}
