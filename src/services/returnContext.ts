/** 跨页返回上下文：离开工作区时保存，子页面（合作伙伴/灵感库等）据此提供「返回当前活动」入口 */

export interface ReturnContext {
  projectId: string;
  projectTitle: string;
  /** 离开时的成果栏页签（plan/scene/budget） */
  tab?: string | null;
  /** 离开时的主区滚动位置 */
  scrollY?: number;
  savedAt: number;
}

const KEY = 'sf-return-context';
/** 30 分钟内有效，避免陈旧上下文误导 */
const TTL = 30 * 60 * 1000;

export function saveReturnContext(ctx: Omit<ReturnContext, 'savedAt'>): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify({ ...ctx, savedAt: Date.now() }));
  } catch {
    /* sessionStorage 不可用时静默降级：子页面不显示返回条 */
  }
}

export function getReturnContext(): ReturnContext | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    const ctx = JSON.parse(raw) as ReturnContext;
    if (!ctx.projectId || Date.now() - (ctx.savedAt ?? 0) > TTL) {
      sessionStorage.removeItem(KEY);
      return null;
    }
    return ctx;
  } catch {
    return null;
  }
}

export function clearReturnContext(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}

/** 每次跳转都随链接携带本次来源（from 参数）：子页面优先用它提供「返回当前活动」，
 * 不再依赖离开工作区时保存的全局上下文（陈旧来源会误导返回目标） */
export function fromQuery(projectId: string, tab: 'plan' | 'scene' | 'budget'): string {
  return `from=${encodeURIComponent(projectId)}&fromTab=${tab}`;
}
