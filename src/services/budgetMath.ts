import type { BudgetItem } from '@/types/types';

/**
 * 预算金额统一计算（全站唯一来源：工作区 / 预览 / PDF / AI 上下文共用）。
 * 未知与 0 严格区分：
 * - priceUnknown=true → 未知（待询价），小计为 null，不计入任何合计；
 * - unitPrice=0 且非未知 → 明确免费/自带，小计为 0，是有效金额；
 * - 空/非法数量 → 按 0 处理（防御历史脏数据），不抛错。
 */

export interface AmountLine {
  /** null = 未知（待询价）；数字 = 已知金额（0 为免费） */
  amount: number | null;
  unknown: boolean;
}

/** 单行金额：未知返回 null，已知按数量×单价（分累加回元，避免浮点尾差） */
export function lineAmount(it: Pick<BudgetItem, 'qty' | 'unitPrice' | 'priceUnknown'>): number | null {
  if (it.priceUnknown) return null;
  const q = Number(it.qty);
  const p = Number(it.unitPrice);
  if (!Number.isFinite(q) || !Number.isFinite(p)) return null;
  return Math.round(q * p * 100) / 100;
}

/** 已知金额合计：未知行不计入；分累加回元 */
export function knownTotal(items: Array<Pick<BudgetItem, 'qty' | 'unitPrice' | 'priceUnknown'>>): number {
  return items.reduce((sum, it) => {
    const a = lineAmount(it);
    return a == null ? sum : sum + Math.round(a * 100);
  }, 0) / 100;
}

/** 待询价（未知价格）行：单独列出，不计入合计（泛型保留调用方的完整条目类型） */
export function unpricedItems<T extends Pick<BudgetItem, 'qty' | 'unitPrice' | 'priceUnknown'>>(items: readonly T[]): T[] {
  return items.filter((it) => it.priceUnknown === true);
}

/** 预算剩余：上限 - 已知合计（负数为超出）；无上限返回 null */
export function remainingOf(
  limit: number | null | undefined,
  items: Array<Pick<BudgetItem, 'qty' | 'unitPrice' | 'priceUnknown'>>
): number | null {
  if (limit == null || !Number.isFinite(Number(limit))) return null;
  return Math.round((Number(limit) - knownTotal(items)) * 100) / 100;
}

/** 单价展示：未知 → '待询价'；0 → '¥0（免费）'；其他 → 金额 */
export function unitPriceLabel(it: Pick<BudgetItem, 'unitPrice' | 'priceUnknown'>): string {
  if (it.priceUnknown) return '待询价';
  const p = Number(it.unitPrice);
  if (!Number.isFinite(p)) return '待询价';
  return p === 0 ? '¥0（免费）' : `¥${p.toLocaleString('zh-CN')}`;
}

/** 小计展示：未知 → '待询价'；已知（含 0）→ 金额 */
export function subtotalLabel(it: Pick<BudgetItem, 'qty' | 'unitPrice' | 'priceUnknown'>): string {
  const a = lineAmount(it);
  return a == null ? '待询价' : `¥${a.toLocaleString('zh-CN')}`;
}
