import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowLeft, X } from 'lucide-react';
import { clearReturnContext, getReturnContext } from '@/services/returnContext';

/** 「返回当前活动」条：离开工作区后，子页面顶部提供明显返回入口（恢复页签/滚动/草稿） */
export default function ReturnBar() {
  const [params] = useSearchParams();
  /* 本次跳转来源优先（from 参数）：随链接而来，准确代表本次入口；无 from 才退回全局上下文 */
  const fromId = params.get('from');
  const fromTab = params.get('fromTab');
  const globalCtx = getReturnContext();
  /* fromTab 缺失时只允许同活动全局上下文兜底（不被其他活动的旧来源污染）；页签校验后兜底 plan */
  const ctx = fromId
    ? { projectId: fromId, projectTitle: globalCtx?.projectId === fromId ? (globalCtx.projectTitle ?? '') : '', tab: fromTab ?? (globalCtx?.projectId === fromId ? globalCtx.tab : null) }
    : globalCtx;
  const [hidden, setHidden] = useState(false);
  if (!ctx || hidden) return null;
  const tab = ctx.tab === 'scene' || ctx.tab === 'budget' ? ctx.tab : 'plan';
  const tabLabel = tab === 'budget' ? '预算与准备' : tab === 'scene' ? '场景布置' : '活动方案';
  return (
    <div className="sticky top-14 z-30 mx-auto mb-4 flex w-full max-w-6xl items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-sm backdrop-blur md:px-4">
      <ArrowLeft className="h-4 w-4 shrink-0 text-primary" />
      <Link
        to={`/workbench/${ctx.projectId}?tab=${tab}&restore=1`}
        className="min-w-0 flex-1 truncate font-medium text-primary hover:underline"
      >
        返回当前活动{ctx.projectTitle ? `《${ctx.projectTitle}》` : ''} · 回到{tabLabel}
      </Link>
      <button
        type="button"
        aria-label="关闭返回提示"
        className="shrink-0 rounded-full p-1 text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
        onClick={() => {
          if (fromId) setHidden(true);
          else clearReturnContext();
          setHidden(true);
        }}
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
