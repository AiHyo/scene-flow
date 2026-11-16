import { useEffect, useState } from 'react';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Sparkles, User as UserIcon } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { ASSETS } from '@/data/assets';

/**
 * 头像预加载守卫：新图真正加载完成前继续展示旧头像，加载失败也保留旧头像——
 * 杜绝 radix Avatar 在新图加载间隙退回兜底层而闪出无关头像的问题。
 * 首次加载即失败时返回原值，交给 AvatarFallback 统一兜底。
 */
export function usePreloadedSrc(src: string): string {
  const [shown, setShown] = useState(src);
  useEffect(() => {
    if (src === shown) return;
    let alive = true;
    const img = new Image();
    img.onload = () => {
      if (alive) setShown(src);
    };
    img.onerror = () => {
      /* 新图不可用：保留当前头像，不换 */
    };
    img.src = src;
    return () => {
      alive = false;
    };
  }, [src, shown]);
  return shown;
}

/** 统一兜底：默认头像图 →（图缺失时）昵称首字 → 通用图标，任何环境都有中性占位 */
function DefaultAvatarFallback({ nickname }: { nickname?: string | null }) {
  const [imgBroken, setImgBroken] = useState(false);
  if (imgBroken) {
    const initial = nickname?.trim().slice(0, 1);
    return initial ? (
      <span className="text-xs font-semibold">{initial}</span>
    ) : (
      <UserIcon className="h-1/2 w-1/2 text-muted-foreground" />
    );
  }
  return (
    <img
      src={ASSETS.userCat}
      alt="默认头像"
      className="h-full w-full object-cover"
      onError={() => setImgBroken(true)}
    />
  );
}

/**
 * 用户头像：优先使用资料头像（登录账号 = 云端档案，访客 = 本机资料）；
 * 未设置或加载失败统一回退默认头像（素材缺失再退首字/图标）。
 * 新头像加载期间保留当前头像，不出现无关头像闪现。
 */
export function UserAvatar({ className }: { className?: string }) {
  const { profile } = useAuth();
  const src = usePreloadedSrc(profile?.avatarUrl ?? ASSETS.userCat);
  return (
    <Avatar className={className}>
      <AvatarImage src={src} alt="用户头像" className="object-cover" />
      <AvatarFallback className="bg-muted">
        <DefaultAvatarFallback nickname={profile?.nickname} />
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * AI 伙伴头像：橙白小猫·紫色围巾，与欢迎页形象同一图片，圆形容器内裁切。
 */
export function AiAvatar({ className }: { className?: string }) {
  return (
    <Avatar className={className}>
      <AvatarImage
        src={ASSETS.aiCat.face}
        alt="AI 伙伴"
        className="object-cover"
      />
      <AvatarFallback>
        <Sparkles className="h-1/2 w-1/2 text-primary" />
      </AvatarFallback>
    </Avatar>
  );
}
