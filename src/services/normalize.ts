import { genId } from '@/services/api';
import type { ProjectData } from '@/types/types';

/**
 * 列表条目进入系统时保证稳定唯一 id（预算/物料/任务/流程/方向通用）。
 * AI 生成结果不保证 id 唯一甚至缺失；历史上已存在的缺失/重复 id 记录在此补齐——
 * 保留全部有效旧 id（字段、顺序、关联不动），仅对缺失或与其他行重复的条目生成新 id。
 * 只在数据写入/加载边界执行，绝不每次渲染重新生成，避免编辑串行（改一行变全部）。
 */
export function ensureIds<T extends { id?: string }>(items: T[] | undefined | null): T[] {
  const seen = new Set<string>();
  return (items ?? []).map((it) => {
    if (typeof it.id === 'string' && it.id.trim() !== '' && !seen.has(it.id)) {
      seen.add(it.id);
      return it;
    }
    const id = genId();
    seen.add(id);
    return { ...it, id };
  });
}

/** 项目数据加载/生成写入边界统一规整：仅补列表 id，不改任何字段值与顺序 */
export function normalizeListIds(d: ProjectData): ProjectData {
  return {
    ...d,
    directions: ensureIds(d.directions),
    schedule: ensureIds(d.schedule),
    budget: d.budget ? { ...d.budget, items: ensureIds(d.budget.items) } : d.budget,
    materials: ensureIds(d.materials),
    tasks: ensureIds(d.tasks),
  };
}
