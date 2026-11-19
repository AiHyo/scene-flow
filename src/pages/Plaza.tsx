import { useCallback, useEffect, useRef, useState } from 'react';
import { Heart, MessageCircle, Plus, RefreshCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import ReturnBar from '@/components/shared/ReturnBar';
import ComposeDialog from '@/components/plaza/ComposeDialog';
import PostDetailDialog from '@/components/plaza/PostDetailDialog';
import { PlazaAvatar } from '@/components/plaza/PlazaAvatar';
import AuthDialog from '@/components/auth/AuthDialog';
import { useAuth } from '@/contexts/AuthContext';
import { usePageEntrance } from '@/hooks/usePageEntrance';
import { UserAvatar } from '@/components/auth/Avatars';
import { ASSETS } from '@/data/assets';
import { cn } from '@/lib/utils';
import {
  type PlazaPost,
  PLAZA_PAGE_SIZE,
  formatPlazaTime,
  listPlazaPosts,
  plazaAuthorOf,
  plazaDisplayLikes,
  togglePlazaLike,
} from '@/services/plazaApi';

/** 动态流单条：作者 → 标题 → 正文摘要（可展开） → 图片 → 点赞/评论 */
function FeedItem({
  post,
  liked,
  onOpenDetail,
  onToggleLike,
}: {
  post: PlazaPost;
  liked: boolean;
  onOpenDetail: (id: string, focusComments: boolean) => void;
  onToggleLike: (post: PlazaPost) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const author = plazaAuthorOf(post);
  const authorName = author.nickname?.trim() || '活动伙伴';
  const content = post.content ?? '';
  const isLong = content.length > 96 || content.split('\n').length > 3;
  const imgs = post.imgList ?? [];
  const likes = plazaDisplayLikes(post);

  return (
    <article className="py-7 first:pt-1 md:py-8">
      <header className="flex items-center gap-3">
        <PlazaAvatar author={author} className="h-10 w-10 shrink-0" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{authorName}</p>
          <p className="text-xs text-muted-foreground">{formatPlazaTime(post.createTime)}</p>
        </div>
      </header>

      <button type="button" onClick={() => onOpenDetail(post.id, false)} className="mt-3 block w-full text-left">
        <h2 className="text-balance text-lg font-semibold leading-snug transition-colors hover:text-primary md:text-xl">
          {post.title}
        </h2>
      </button>

      {content && (
        <div className="mt-2">
          <p
            className={cn(
              'whitespace-pre-wrap text-pretty text-[15px] leading-relaxed text-foreground/90',
              !expanded && 'line-clamp-3'
            )}
          >
            {content}
          </p>
          {isLong && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="mt-1 text-sm font-medium text-primary hover:underline"
            >
              {expanded ? '收起' : '展开全文'}
            </button>
          )}
        </div>
      )}

      {imgs.length === 1 ? (
        <button
          type="button"
          onClick={() => onOpenDetail(post.id, false)}
          className="mt-3 block max-w-full cursor-zoom-in"
          aria-label={`查看 ${post.title} 完整图片`}
        >
          <img
            src={imgs[0]}
            alt={`${post.title} 配图`}
            className="max-h-[440px] w-auto max-w-full rounded-lg bg-muted object-contain"
            loading="lazy"
          />
        </button>
      ) : imgs.length > 1 ? (
        <div
          className={cn(
            'mt-3 grid gap-1.5 overflow-hidden rounded-lg',
            imgs.length === 2 ? 'grid-cols-2' : 'grid-cols-3'
          )}
        >
          {imgs.map((img, i) => (
            <button
              key={`${post.id}-img-${i}`}
              type="button"
              onClick={() => onOpenDetail(post.id, false)}
              className="aspect-square cursor-zoom-in overflow-hidden bg-muted"
              aria-label={`查看 ${post.title} 第 ${i + 1} 张图片`}
            >
              <img
                src={img}
                alt={`${post.title} 配图 ${i + 1}`}
                className="h-full w-full object-cover transition-transform duration-300 hover:scale-[1.02]"
                loading="lazy"
              />
            </button>
          ))}
        </div>
      ) : null}

      <div className="mt-3 flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => onToggleLike(post)}
          aria-pressed={liked}
          className={cn(
            'flex h-9 items-center gap-1.5 rounded-full px-3 text-sm transition-colors',
            liked ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
          )}
        >
          <Heart className={cn('h-4 w-4', liked && 'fill-primary')} />
          <span>{likes > 0 ? likes : '点赞'}</span>
        </button>
        <button
          type="button"
          onClick={() => onOpenDetail(post.id, true)}
          className="flex h-9 items-center gap-1.5 rounded-full px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <MessageCircle className="h-4 w-4" />
          <span>评论</span>
        </button>
      </div>
    </article>
  );
}

/** 活动广场：社区动态流（浏览免登录；发布/点赞/评论需登录；数据后端存储） */
export default function Plaza() {
  const pageRef = useRef<HTMLDivElement>(null);
  usePageEntrance(pageRef);
  const { ready, userId, isAccount } = useAuth();
  const [posts, setPosts] = useState<PlazaPost[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [likedIds, setLikedIds] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [composeOpen, setComposeOpen] = useState(false);
  /* 登录引导：未登录点击发布 → 打开登录弹窗，登录成功后续发（所有入口共用同一状态） */
  const [authOpen, setAuthOpen] = useState(false);
  const [pendingCompose, setPendingCompose] = useState(false);
  /* 详情打开时是否定位到评论区（点击评论入口时为 true） */
  const [focusComments, setFocusComments] = useState(false);

  const activePost = posts?.find((p) => p.id === activeId) ?? null;

  const loadFirst = useCallback(async () => {
    setPosts(null);
    setLoadError(null);
    setPage(0);
    try {
      const rows = await listPlazaPosts(0);
      setPosts(rows);
      setLikedIds(new Set(rows.filter((r) => r.likedByMe).map((r) => r.id)));
      setHasMore(rows.length >= PLAZA_PAGE_SIZE);
    } catch (e) {
      console.error(e);
      setLoadError('动态加载失败，请检查网络后重试');
    }
  }, []);

  useEffect(() => {
    void loadFirst();
  }, [loadFirst, isAccount, userId]);

  const handlePostChange = useCallback((id: string, patch: Partial<PlazaPost>) => {
    setPosts((arr) => (arr ? arr.map((p) => (p.id === id ? { ...p, ...patch } : p)) : arr));
  }, []);

  const toggleLike = async (post: PlazaPost) => {
    if (!ready) {
      toast.info('账号信息加载中，请稍候再试');
      return;
    }
    if (!isAccount) {
      setAuthOpen(true);
      toast.info('登录后即可点赞');
      return;
    }
    const wasLiked = likedIds.has(post.id);
    /* 乐观更新，失败回滚 */
    setLikedIds((prev) => {
      const next = new Set(prev);
      if (wasLiked) next.delete(post.id);
      else next.add(post.id);
      return next;
    });
    handlePostChange(post.id, { likeCount: Math.max(0, post.likeCount + (wasLiked ? -1 : 1)) });
    try {
      const res = await togglePlazaLike(post.id);
      handlePostChange(post.id, { likeCount: res.likeCount, likedByMe: res.liked });
    } catch (e) {
      console.error(e);
      setLikedIds((prev) => {
        const next = new Set(prev);
        if (wasLiked) next.add(post.id);
        else next.delete(post.id);
        return next;
      });
      handlePostChange(post.id, { likeCount: post.likeCount });
      toast.error('点赞操作失败，请重试');
    }
  };

  const loadMore = async () => {
    if (loadingMore || !posts) return;
    setLoadingMore(true);
    const next = page + 1;
    try {
      const rows = await listPlazaPosts(next);
      setPosts((arr) => [...(arr ?? []), ...rows.filter((r) => !arr?.some((p) => p.id === r.id))]);
      setPage(next);
      setHasMore(rows.length >= PLAZA_PAGE_SIZE);
    } catch (e) {
      console.error(e);
      toast.error('加载更多失败，请重试');
    } finally {
      setLoadingMore(false);
    }
  };

  /* 所有发布入口共用：已登录直接打开发布弹窗；未登录打开登录引导，成功后自动继续发布 */
  const openCompose = () => {
    if (!ready) {
      toast.info('账号信息加载中，请稍候再试');
      return;
    }
    if (!isAccount) {
      setPendingCompose(true);
      setAuthOpen(true);
      toast.info('登录后即可发布动态');
      return;
    }
    setComposeOpen(true);
  };

  /* 登录成功后继续发布：关闭登录弹窗并打开发布弹窗。
   * 不依赖关闭回调清标记（登录成功的同一批次里闭包中 isAccount 可能仍是旧值，会误清标记导致续发丢失） */
  useEffect(() => {
    if (isAccount && pendingCompose) {
      setPendingCompose(false);
      setAuthOpen(false);
      setComposeOpen(true);
    }
  }, [isAccount, pendingCompose]);

  /* 用户放弃登录（登录弹窗已关且仍未登录）：清掉待发布标记，避免下次登录时误开弹窗 */
  useEffect(() => {
    if (!authOpen && !isAccount && pendingCompose) setPendingCompose(false);
  }, [authOpen, isAccount, pendingCompose]);

  const handleAuthOpenChange = (o: boolean) => setAuthOpen(o);

  /* 打开详情（focusComments=true 时定位到评论区）；关闭后 activeId 置空，列表位置不变 */
  const openDetail = (id: string, focus: boolean) => {
    setFocusComments(focus);
    setActiveId(id);
  };

  const handlePostDeleted = (id: string) => {
    setActiveId(null);
    setPosts((arr) => (arr ? arr.filter((p) => p.id !== id) : arr));
    setLikedIds((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  };

  return (
    <div ref={pageRef} className="sf-page-body @container mx-auto w-full max-w-6xl px-4 py-8 md:px-6 md:py-12">
      <div className="sf-deco" aria-hidden="true">
        <span className="sf-blob sf-paper-purple" style={{ top: '-10%', left: '-18%', width: '30vw', height: '30vw', minWidth: 240, minHeight: 240 }} />
        <span className="sf-blob sf-paper-cream" style={{ top: '2%', right: '-16%', width: '26vw', height: '26vw', minWidth: 210, minHeight: 210 }} />
      </div>
      <ReturnBar />

      {/* 现代波普页头 */}
      <div className="sf-reveal-hero flex flex-wrap items-end justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1.5">
          <span className="sf-pill-amber inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-0.5 text-xs font-bold">
            真实活动社区
          </span>
          <h1 className="font-display text-3xl font-black tracking-tight md:text-4xl">
            活动广场<span className="text-primary">。</span>
          </h1>
          <p className="text-sm text-muted-foreground md:text-base">大家的活动策划、场景布置与现场照片</p>
        </div>
        {(posts === null || posts.length > 0) && (
          <Button
            onClick={openCompose}
            className="sf-pill-cobalt shrink-0 rounded-full border-0 px-5 font-semibold transition-all duration-200 hover:-translate-y-0.5 hover:opacity-95 active:translate-y-0 active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" />
            发布动态
          </Button>
        )}
      </div>

      {/* 移动端/中屏提示条：补全右侧引导信息 */}
      <div className="mt-4 rounded-xl border bg-card/80 px-3.5 py-2.5 text-xs text-muted-foreground @5xl:hidden">
        浏览免登录；发布动态（标题 + 正文 + 图片）、点赞与评论需先登录账号。
      </div>

      {/* 主体：居中单列动态流；宽屏右侧轻量分享引导（空间不足时隐藏，不挤压主内容） */}
      <div className="mt-6 flex flex-col items-stretch gap-10 @5xl:flex-row @5xl:justify-center">
        <section className="w-full min-w-0 @5xl:max-w-[720px]" aria-label="活动动态列表">
          {/* 加载中 */}
          {posts === null && loadError === null && (
            <div className="divide-y divide-border">
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="py-7 first:pt-1 md:py-8">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 animate-pulse rounded-full bg-muted" />
                    <div className="flex flex-col gap-1.5">
                      <div className="h-3.5 w-24 animate-pulse rounded bg-muted" />
                      <div className="h-3 w-16 animate-pulse rounded bg-muted" />
                    </div>
                  </div>
                  <div className="mt-3.5 h-5 w-3/4 animate-pulse rounded bg-muted" />
                  <div className="mt-2.5 h-4 w-full animate-pulse rounded bg-muted" />
                  <div className="mt-1.5 h-4 w-2/3 animate-pulse rounded bg-muted" />
                  <div className="mt-3.5 h-44 w-full animate-pulse rounded-lg bg-muted" />
                </div>
              ))}
            </div>
          )}

          {/* 加载失败 */}
          {loadError !== null && (
            <div className="flex flex-col items-center gap-3 py-16 text-center">
              <p className="text-sm text-muted-foreground">{loadError}</p>
              <Button variant="outline" size="sm" onClick={() => void loadFirst()}>
                <RefreshCcw className="h-4 w-4" />
                重新加载
              </Button>
            </div>
          )}

          {/* 空状态 */}
          {posts !== null && posts.length === 0 && (
            <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed bg-card/60 px-6 py-16 text-center">
              <p className="text-base font-medium">广场还没有动态</p>
              <p className="max-w-sm text-sm text-muted-foreground">分享你的活动策划、场景布置或现场照片，成为第一条动态吧</p>
              <Button size="sm" onClick={openCompose}>
                <Plus className="h-4 w-4" />
                发布第一条动态
              </Button>
            </div>
          )}

          {/* 动态流：细分隔线 + 留白区分（最新发布在前；详情关闭后回到原浏览位置） */}
          {posts !== null && posts.length > 0 && (
            <>
              <div className="divide-y divide-border">
                {posts.map((p) => (
                  <FeedItem
                    key={p.id}
                    post={p}
                    liked={likedIds.has(p.id)}
                    onOpenDetail={openDetail}
                    onToggleLike={(post) => void toggleLike(post)}
                  />
                ))}
              </div>
              {hasMore && (
                <div className="mt-8 flex justify-center">
                  <Button variant="outline" onClick={() => void loadMore()} disabled={loadingMore}>
                    {loadingMore ? '加载中…' : '加载更多'}
                  </Button>
                </div>
              )}
            </>
          )}
        </section>

        {/* 宽屏右侧：统一 3D 蓝白小灵氛围卡 */}
        <aside className="hidden w-[260px] shrink-0 @5xl:block">
          <div className="sf-card sticky top-24 flex flex-col items-center gap-4 overflow-hidden rounded-2xl p-5 text-center">
            <div className="flex h-32 w-full items-center justify-center rounded-2xl bg-gradient-to-br from-[#F4F3FF] via-[#FAF7FF] to-[#FEF8E6]">
              <img
                src={ASSETS.aiCat.full}
                alt="小灵 · 活动广场策划伙伴"
                width={112}
                height={112}
                loading="lazy"
                className="ai-cat-idle h-24 w-24 select-none object-contain"
              />
            </div>
            <p className="font-display text-base font-bold tracking-tight">把活动现场分享出来</p>
            <div className="flex w-full flex-col gap-2 border-t border-border/60 pt-4 text-left text-xs leading-relaxed text-muted-foreground">
              <p>· 每条动态需包含标题、正文与配图</p>
              <p>· 支持多张图片上传，可预览与移除</p>
              <p>· 浏览免登录，点赞与评论需先登录</p>
            </div>
          </div>
        </aside>
      </div>
      {/* 发布弹窗：全页唯一实例，所有入口共用同一状态 */}
      <ComposeDialog open={composeOpen} onOpenChange={setComposeOpen} onPublished={() => void loadFirst()} />
      {/* 登录引导：未登录发布/点赞/评论时打开，登录成功后自动继续 */}
      <AuthDialog open={authOpen} onOpenChange={handleAuthOpenChange} initialMode="login" />
      <PostDetailDialog
        open={!!activePost}
        onOpenChange={(o) => {
          if (!o) {
            setActiveId(null);
            setFocusComments(false);
          }
        }}
        post={activePost}
        liked={!!(activePost && likedIds.has(activePost.id))}
        isAccount={isAccount}
        userId={userId}
        focusComments={focusComments}
        onRequestLogin={() => {
          setAuthOpen(true);
          toast.info('登录后即可点赞和评论');
        }}
        onToggleLike={(p) => void toggleLike(p)}
        onPostChange={handlePostChange}
        onPostDeleted={handlePostDeleted}
      />
    </div>
  );
}
