import type { ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface CollapsibleSectionProps {
  /** 锚点 id（如 scene-req-anchor 滚动定位） */
  id?: string;
  /** 持久化键（data.ui.collapsed[key]） */
  sectionKey: string;
  title: string;
  /** 收起态摘要（标题旁简短信息） */
  summary?: ReactNode;
  open: boolean;
  onToggle: (next: boolean) => void;
  /** 收起时的新内容红点提示 */
  fresh?: boolean;
  children: ReactNode;
  className?: string;
  /** 展开态内容容器额外类名 */
  bodyClassName?: string;
}

/**
 * 成果栏可收起卡片：收起时保留标题+摘要（不卸载内容，编辑状态不丢）；
 * 内容保持挂载仅隐藏，展开/收起瞬时响应。
 */
export default function CollapsibleSection({
  id,
  sectionKey,
  title,
  summary,
  open,
  onToggle,
  fresh,
  children,
  className,
  bodyClassName,
}: CollapsibleSectionProps) {
  return (
    <section
      /* 定位锚点：未显式传 id 时按 sectionKey 生成稳定锚点（sf-sec-*，成果定位滚动目标） */
      id={id ?? `sf-sec-${sectionKey}`}
      data-section={sectionKey}
      className={cn('rounded-2xl border bg-card shadow-sm', className)}
    >
      <button
        type="button"
        onClick={() => onToggle(!open)}
        aria-expanded={open}
        className="flex min-h-12 w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-muted/40 md:px-5"
      >
        <h2 className="shrink-0 text-base font-semibold">{title}</h2>
        {!open && summary != null && summary !== '' && (
          <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{summary}</span>
        )}
        {fresh && !open && (
          <span
            className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-primary"
            aria-label="有新内容更新"
          />
        )}
        <ChevronDown
          className={cn('h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200', open && 'rotate-180')}
        />
      </button>
      {/* 保持挂载仅隐藏：展开/收起不丢失输入与编辑状态 */}
      <div className={cn(!open && 'hidden', bodyClassName)}>{children}</div>
    </section>
  );
}
