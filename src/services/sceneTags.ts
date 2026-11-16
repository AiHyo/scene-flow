import type { ProjectData } from '@/types/types';

/**
 * 布置元素列表归一化：AI 或旧数据可能把 tags 写成字符串（如「茶歇、桌椅」），
 * 统一转成 string[]；异常值安全降级为空数组，杜绝 tags.filter 崩溃。
 */
export function normalizeTags(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim());
  if (typeof v === 'string') {
    return v
      .split(/[、，,;；/\n]+/)
      .map((x) => x.trim())
      .filter(Boolean);
  }
  return [];
}

/**
 * 存量异常数据修复：只修 scene.tags / lastReq.tags 等已知会以错误格式写入的字段，
 * 保留其余全部内容（图片、历史、手改）不变；数据正常时原样返回（引用不变，不触发多余渲染）。
 */
export function repairSceneData<T extends ProjectData>(d: T): T {
  const sc = d.scene;
  if (!sc) return d;
  let changed = false;
  const next: typeof sc = { ...sc };
  if (typeof sc.tags === 'string' || (sc.tags != null && !Array.isArray(sc.tags))) {
    next.tags = normalizeTags(sc.tags);
    changed = true;
  } else if (Array.isArray(sc.tags) && sc.tags.some((t) => typeof t !== 'string')) {
    next.tags = normalizeTags(sc.tags);
    changed = true;
  }
  const lr = sc.lastReq;
  if (lr && (typeof lr.tags === 'string' || (lr.tags != null && !Array.isArray(lr.tags)))) {
    next.lastReq = { ...lr, tags: normalizeTags(lr.tags) };
    changed = true;
  }
  return changed ? { ...d, scene: next } : d;
}
