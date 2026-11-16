import type { AdjustCard, ProjectData, ScheduleItem, SchedulePatchItem } from '@/types/types';

/**
 * 调整补丁应用层：字段级合并（绝不整套替换）。
 * - schedulePatch 按 id / 精确名称定位条目，只写明确提供的字段（undefined=不动；null/空=明确清空）；
 * - 同名多条 → 拒绝定位（不凭位置猜测）；未命中 → 记失败待用户确认；
 * - 应用前 orig 快照比对：等待期间用户手工改过目标 → 拒绝应用，不用旧建议覆盖新编辑。
 */

export interface PatchResult {
  next: ScheduleItem[];
  /** 每条补丁的实际落点说明（确认卡「实际将写入」清单来源） */
  lines: string[];
  failures: string[];
}

/** HH:mm 补零规整（9:3 → 09:03；非法值原样保留） */
export function normTime(t: string | null | undefined): string {
  if (t == null) return '';
  const m = String(t).match(/^(\d{1,2}):(\d{1,2})$/);
  if (!m) return String(t);
  return `${m[1].padStart(2, '0')}:${m[2].padStart(2, '0')}`;
}

const FIELD_LABEL: Record<string, string> = {
  time: '时间',
  duration: '时长',
  note: '备注',
  rename: '名称',
};

/** 名称规整：去掉「#id」后缀与空白/分隔符（全半角斜杠、顿号、竖线、逗号），用于确定性匹配（非模糊猜测） */
export function normName(s: string | null | undefined): string {
  return String(s ?? '')
    .replace(/#[A-Za-z0-9_-]+\s*$/, '')
    .replace(/[\s/／、・·|｜，,]+/g, '')
    .toLowerCase();
}

/** 从补丁条目解析定位键：优先显式 id；名称尾部的「#id」视为 id；否则用规整后名称 */
export function locateKey(p: { name?: string; id?: string | number }): { id?: string; name: string } {
  let id = p.id != null ? String(p.id) : undefined;
  let name = p.name ?? '';
  if (!id) {
    const m = name.match(/#([A-Za-z0-9_-]+)\s*$/);
    if (m) {
      id = m[1];
      name = name.slice(0, m.index).trim();
    }
  }
  return { id, name };
}

/** 对现有流程应用字段级补丁：只改明确列出的字段，其余条目与字段原样保留 */
export function applySchedulePatch(schedule: ScheduleItem[], patch: SchedulePatchItem[]): PatchResult {
  const next = schedule.map((x) => ({ ...x }));
  const lines: string[] = [];
  const failures: string[] = [];
  let dirty = false;
  for (const p of patch) {
    const { id, name } = locateKey(p);
    /* 定位：优先稳定 id；否则规整名称精确匹配（去空白/分隔符后全等，不做模糊相似猜测）；同名多条拒绝猜测 */
    let targets: number[] = [];
    if (id) {
      targets = next.map((x, i) => (x.id === id ? i : -1)).filter((i) => i >= 0);
      if (targets.length === 0 && name) targets = next.map((x, i) => (normName(x.name) === normName(name) ? i : -1)).filter((i) => i >= 0);
    } else if (name) {
      targets = next.map((x, i) => (normName(x.name) === normName(name) ? i : -1)).filter((i) => i >= 0);
    }
    if (targets.length === 0) {
      failures.push(`未找到环节「${name || id}」，该条未改。当前流程环节：${schedule.map((x) => x.name).join('、')}`);
      continue;
    }
    if (targets.length > 1) {
      failures.push(`有 ${targets.length} 个环节都对应「${name}」，未改动，请说明要改哪一条`);
      continue;
    }
    const idx = targets[0];
    const item = next[idx];
    const changed: string[] = [];
    if (p.time !== undefined) {
      const v = p.time == null ? '' : normTime(p.time);
      if (item.time !== v) { item.time = v; changed.push('时间'); }
    }
    if (p.duration !== undefined) {
      const v = p.duration == null ? '' : String(p.duration);
      if (item.duration !== v) { item.duration = v; changed.push('时长'); }
    }
    if (p.note !== undefined) {
      const v = p.note == null ? '' : String(p.note);
      if (item.note !== v) { item.note = v; changed.push('备注'); }
    }
    if (p.rename !== undefined) {
      const v = p.rename == null ? '' : String(p.rename).trim();
      if (v && item.name !== v) { item.name = v; changed.push('名称'); }
    }
    if (changed.length > 0) {
      dirty = true;
      lines.push(`「${item.name}」更新${changed.join('、')}，其余字段保持原样`);
    } else {
      lines.push(`「${item.name}」与当前一致，无实际变更`);
    }
  }
  /* 只有真实字段变更才返回新数组（无变更返回原引用，调用方据此不误标「已应用」） */
  return { next: dirty ? next : schedule, lines, failures };
}

/** 从补丁派生「实际将写入」清单（确认卡展示与真实数据同源，不另写承诺文本） */
export function planChangeLines(plan: AdjustCard['plan']): string[] {
  const out: string[] = [];
  if (plan.visualTheme !== undefined) out.push(`视觉主题改为「${plan.visualTheme}」（仅配色词）`);
  if (plan.theme) {
    const t: string[] = [];
    if (plan.theme.name) t.push(`主题名「${plan.theme.name}」`);
    if (plan.theme.slogan !== undefined) t.push(`口号「${plan.theme.slogan || '（清空）'}」`);
    if (plan.theme.highlights) t.push(`亮点（${plan.theme.highlights.length} 条，逐条见下方）`);
    if (t.length > 0) out.push(`活动主题更新：${t.join('；')}（流程/费用/物料不动）`);
  }
  if (plan.theme?.highlights && plan.theme.highlights.length > 0) {
    for (const h of plan.theme.highlights) out.push(`新亮点：${h}`);
  }
  if (plan.schedulePatch && plan.schedulePatch.length > 0) {
    for (const p of plan.schedulePatch) {
      const fields = (['time', 'duration', 'note', 'rename'] as const)
        .filter((f) => (p as Record<string, unknown>)[f] !== undefined)
        .map((f) => FIELD_LABEL[f]);
      /* 名称展示：去掉「#id」定位后缀（UUID 不该出现在用户可见文案里） */
      const lk = locateKey(p);
      const dispName = (lk.name || '').trim() || '（未命名环节）';
      out.push(`环节「${dispName}」只改${fields.join('、')}，未列出的字段与其它环节保持原样`);
    }
  }
  if (plan.scheduleAdd) for (const s of plan.scheduleAdd) out.push(`新增环节「${s.name}」`);
  if (plan.scheduleRemoveNames) for (const n of plan.scheduleRemoveNames) out.push(`删除环节「${n}」`);
  if (plan.budgetAdd)
    for (const b of plan.budgetAdd)
      out.push(
        `新增费用「${b.name}」× ${b.qty}（${b.unitPrice == null ? '价格待询，不计入合计' : b.unitPrice === 0 ? '免费/自带' : `单价 ${b.unitPrice} 元`}）`
      );
  if (plan.budgetRemoveNames) for (const n of plan.budgetRemoveNames) out.push(`取消费用「${n}」`);
  if (plan.materialsAdd) for (const m of plan.materialsAdd) out.push(`新增物料「${m.name}」（${m.qty || '数量待定'}）`);
  if (plan.materialsRemoveNames) for (const n of plan.materialsRemoveNames) out.push(`移除物料「${n}」`);
  if (plan.sceneTags || plan.sceneStyle !== undefined || plan.sceneExtra !== undefined)
    out.push('布置要求更新（旧效果图保留并标记对应旧要求，是否重新生成由你决定）');
  return out;
}

/** 创建确认卡时的目标原值快照：应用前比对，防旧建议覆盖等待期间的手工编辑 */
export function snapshotOrig(plan: AdjustCard['plan'], data: ProjectData): AdjustCard['orig'] {
  const orig: AdjustCard['orig'] = {};
  if (plan.schedulePatch && plan.schedulePatch.length > 0) {
    const schedule = data.schedule ?? [];
    orig.schedule = plan.schedulePatch
      .map((p) => {
        const item =
          (p.id ? schedule.find((x) => x.id === p.id) : undefined) ??
          (p.name ? schedule.find((x) => normName(x.name) === normName(p.name)) : undefined);
        return item ? { id: item.id, name: item.name, time: item.time, duration: item.duration, note: item.note } : undefined;
      })
      .filter((x): x is NonNullable<typeof x> => !!x);
  }
  if (plan.budgetRemoveNames) orig.budget = [...plan.budgetRemoveNames];
  if (plan.materialsRemoveNames) orig.materials = [...plan.materialsRemoveNames];
  if (plan.visualTheme !== undefined) orig.visualTheme = String(data.requirements?.visualTheme?.value ?? '');
  if (plan.sceneStyle !== undefined) orig.sceneStyle = data.scene?.style ?? '';
  if (plan.sceneExtra !== undefined) orig.sceneExtra = data.scene?.extra ?? '';
  if (plan.theme?.name) orig.themeName = data.theme?.name ?? '';
  return orig;
}

/** 应用前校验：等待期间目标被手工改动 → 返回失败说明（拒绝应用，不覆盖新编辑） */
export function checkOrig(card: AdjustCard, data: ProjectData): string[] {
  const orig = card.orig;
  if (!orig) return [];
  const failures: string[] = [];
  const plan = card.plan ?? {};
  /* 重试只校验未完成项：已成功落地的字段不再是「等待期间被改」，而是「第一次应用已写入的新值」，
   * 若仍拿创建卡时的旧基线比对，会把成功结果误判为外部冲突导致永远无法重试 */
  const undone = new Set(card.undoneFields ?? []);
  const checking = (k: string) => undone.size === 0 || undone.has(k);
  /* 三值判定（恢复链路核心）：当前值==建议的目标新值 → 该字段已完成（放行，不重复应用、不误报冲突）；
   * 当前值==旧基线 → 未应用（正常应用）；第三种值才是等待期间被真正修改 → 报冲突拒绝覆盖。
   * 恢复判定先于旧值冲突守卫挡住已完成分支——写入自己的结果不再是「外部修改」 */
  if (orig.schedule && orig.schedule.length > 0) {
    const schedule = data.schedule ?? [];
    orig.schedule.forEach((o, i) => {
      const p = plan.schedulePatch?.[i];
      const item =
        (o.id ? schedule.find((x) => x.id === o.id) : undefined) ??
        (o.name ? schedule.find((x) => normName(x.name) === normName(o.name)) : undefined);
      if (!item) {
        if (checking('schedule')) failures.push(`环节「${o.name}」已被删除，无法按原建议应用`);
      } else if (
        checking('schedule') &&
        ((o.time !== undefined && item.time !== o.time && item.time !== p?.time) ||
          (o.duration !== undefined && item.duration !== o.duration && item.duration !== p?.duration) ||
          (o.note !== undefined && item.note !== o.note && (p?.note !== undefined ? item.note !== p.note : true)))
      ) {
        failures.push(`等待确认期间「${item.name}」已被修改，为避免覆盖你的编辑，请重新发起该调整`);
      }
    });
  }
  if (plan.visualTheme !== undefined && orig.visualTheme !== undefined && checking('visualTheme')) {
    const cur = data.requirements?.visualTheme?.value ?? '';
    const target = plan.visualTheme.trim();
    if (cur !== orig.visualTheme && cur !== target) failures.push('视觉主题在等待期间已被修改，请重新发起配色调整');
  }
  if (plan.sceneStyle !== undefined && orig.sceneStyle !== undefined && checking('scene')) {
    const cur = data.scene?.style ?? '';
    const target = plan.sceneStyle;
    if (cur !== orig.sceneStyle && (typeof target !== 'string' || cur !== target)) {
      failures.push('布置风格在等待期间已被修改，请重新发起调整');
    }
  }
  if (plan.sceneExtra !== undefined && orig.sceneExtra !== undefined && checking('scene')) {
    const cur = data.scene?.extra ?? '';
    const target = plan.sceneExtra;
    if (cur !== orig.sceneExtra && (typeof target !== 'string' || cur !== target)) {
      failures.push('布置说明在等待期间已被修改，请重新发起调整');
    }
  }
  if (plan.theme?.name && orig.themeName !== undefined && checking('theme')) {
    const cur = data.theme?.name ?? '';
    const target = plan.theme.name.trim();
    if (cur !== orig.themeName && cur !== target) failures.push('主题名在等待期间已被修改，请重新发起主题调整');
  }
  return failures;
}
