import { cn } from '@/lib/utils';
import type { PlazaAuthor } from '@/services/plazaApi';

/** 广场作者头像：有头像用图片，无头像用昵称首字符占位（支持任意作者，不依赖当前登录用户） */
export function PlazaAvatar({ author, className }: { author: PlazaAuthor | null; className?: string }) {
  const url = author?.avatar_url;
  const name = author?.nickname?.trim() || '活动伙伴';
  if (url) {
    return <img src={url} alt={`${name}的头像`} className={cn('rounded-full object-cover', className)} loading="lazy" />;
  }
  return (
    <div
      className={cn(
        'flex items-center justify-center rounded-full bg-primary/10 text-[11px] font-semibold text-primary',
        className
      )}
      aria-hidden="true"
    >
      {name.slice(0, 1).toUpperCase()}
    </div>
  );
}
