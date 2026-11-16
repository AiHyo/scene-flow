import { useCallback, useEffect, useRef, useState } from 'react';
import { Heart, Loader2, MessageCircle, Send, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import ConfirmDialog from '@/components/shared/ConfirmDialog';
import { PlazaAvatar } from '@/components/plaza/PlazaAvatar';
import {
  type PlazaComment,
  type PlazaPost,
  addPlazaComment,
  deletePlazaComment,
  deletePlazaPost,
  formatPlazaTime,
  listPlazaComments,
  plazaAuthorOf,
  plazaDisplayLikes,
  removePlazaImages,
} from '@/services/plazaApi';

interface PostDetailDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  post: PlazaPost | null;
  liked: boolean;
  isAccount: boolean;
  /** 当前登录用户 id：删除按钮仅对本人内容显示（不能删他人内容） */
  userId: string | null;
  /** 点击评论入口打开时定位到评论区 */
  focusComments?: boolean;
  /** 未登录点赞/评论时的登录引导入口（由列表页统一打开登录弹窗） */
  onRequestLogin?: () => void;
  /** 点赞/取消点赞（乐观更新由列表页统一管理） */
  onToggleLike: (post: PlazaPost) => void;
  /** 计数等字段变化同步回列表 */
  onPostChange: (id: string, patch: Partial<PlazaPost>) => void;
  onPostDeleted: (id: string) => void;
}

type ConfirmTarget = { kind: 'post' } | { kind: 'comment'; commentId: string };

/** 动态详情弹窗：完整图集 + 正文 + 点赞 + 单级评论；本人可删动态与评论（均二次确认） */
export default function PostDetailDialog({
  open,
  onOpenChange,
  post,
  liked,
  isAccount,
  userId,
  focusComments = false,
  onRequestLogin,
  onToggleLike,
  onPostChange,
  onPostDeleted,
}: PostDetailDialogProps) {
  const [comments, setComments] = useState<PlazaComment[] | null>(null);
  const [commentsError, setCommentsError] = useState<string | null>(null);
  const [commentText, setCommentText] = useState('');
  const [sending, setSending] = useState(false);
  const [confirm, setConfirm] = useState<{ open: boolean; target: ConfirmTarget | null }>({ open: false, target: null });

  const postId = post?.id ?? '';

  const loadComments = useCallback(async (pid: string) => {
    setComments(null);
    setCommentsError(null);
    try {
      setComments(await listPlazaComments(pid));
    } catch (e) {
      console.error(e);
      setCommentsError('评论加载失败');
    }
  }, []);

  useEffect(() => {
    if (open && postId) void loadComments(postId);
    else if (!open) {
      setComments(null);
      setCommentsError(null);
      setCommentText('');
    }
  }, [open, postId, loadComments]);

  /* 点击评论入口打开时，评论加载完成后平滑定位到评论区 */
  const commentsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || !focusComments || comments === null) return;
    const t = window.setTimeout(() => {
      commentsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
    return () => window.clearTimeout(t);
  }, [open, focusComments, comments]);

  /* 仅本人内容显示删除入口（后端 RLS 同样仅允许本人删除，前后端双重校验；演示内容不可删） */
  const isMine = !!(isAccount && userId && !post?.is_demo && post?.author_id === userId);

  const closeConfirm = () => setConfirm({ open: false, target: null });

  const doDeletePost = async () => {
    if (!post) return;
    closeConfirm();
    try {
      await deletePlazaPost(post.id);
      toast.success('动态已删除');
      onOpenChange(false);
      onPostDeleted(post.id);
      void removePlazaImages(post.images);
    } catch (e) {
      console.error(e);
      toast.error('删除失败，请重试');
    }
  };

  const doDeleteComment = async (commentId: string) => {
    if (!post) return;
    closeConfirm();
    try {
      await deletePlazaComment(commentId);
      setComments((arr) => (arr ? arr.filter((c) => c.id !== commentId) : arr));
      onPostChange(post.id, { comment_count: Math.max(0, post.comment_count - 1) });
      toast.success('评论已删除');
    } catch (e) {
      console.error(e);
      toast.error('删除失败，请重试');
    }
  };

  const handleConfirm = () => {
    const t = confirm.target;
    if (!t) return;
    if (t.kind === 'post') void doDeletePost();
    else void doDeleteComment(t.commentId);
  };

  const submitComment = async () => {
    if (!post) return;
    const text = commentText.trim();
    if (text.length === 0) {
      toast.error('评论内容不能为空');
      return;
    }
    if (sending) return;
    setSending(true);
    try {
      await addPlazaComment(post.id, text);
      setCommentText('');
      await loadComments(post.id);
      onPostChange(post.id, { comment_count: post.comment_count + 1 });
    } catch (e) {
      console.error(e);
      toast.error('评论发送失败，内容已保留，请重试');
    } finally {
      setSending(false);
    }
  };

  if (!post) return null;

  const author = plazaAuthorOf(post);
  const authorName = author.nickname?.trim() || '活动伙伴';

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90dvh] max-w-[calc(100%-2rem)] overflow-y-auto md:max-w-2xl">
          <DialogHeader>
            <div className="flex items-start justify-between gap-3 pr-6">
              <DialogTitle className="text-left text-balance text-lg md:text-xl">{post.title}</DialogTitle>
            </div>
            <DialogDescription asChild>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <PlazaAvatar author={author} className="h-6 w-6" />
                <span className="font-medium text-foreground/80">{authorName}</span>
                <span>{formatPlazaTime(post.created_at)} 发布</span>
                {isMine && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 gap-1 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setConfirm({ open: true, target: { kind: 'post' } })}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    删除动态
                  </Button>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>

          {/* 完整图集 */}
          {post.images.length > 0 && (
            post.images.length === 1 ? (
              <div className="flex w-full justify-center overflow-hidden rounded-lg bg-muted">
                <img
                  src={post.images[0]}
                  alt={`${post.title} 配图`}
                  className="max-h-[60vh] w-auto max-w-full object-contain"
                  loading="lazy"
                />
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
                {post.images.map((url, i) => (
                  <div key={url} className="flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-muted">
                    <img
                      src={url}
                      alt={`${post.title} 配图 ${i + 1}`}
                      className="h-full w-full object-contain"
                      loading="lazy"
                    />
                  </div>
                ))}
              </div>
            )
          )}

          {/* 正文 */}
          {post.content && (
            <p className="whitespace-pre-wrap text-pretty text-sm leading-relaxed text-foreground/90">{post.content}</p>
          )}

          {/* 点赞 */}
          <div className="flex items-center gap-3 border-t pt-3">
            <Button
              variant={liked ? 'default' : 'outline'}
              size="sm"
              className="gap-1.5"
              onClick={() => onToggleLike(post)}
              aria-pressed={liked}
            >
              <Heart className={liked ? 'h-4 w-4 fill-current' : 'h-4 w-4'} />
              {liked ? '已赞' : '点赞'} {plazaDisplayLikes(post)}
            </Button>
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <MessageCircle className="h-3.5 w-3.5" />
              {post.comment_count} 条评论
            </span>
          </div>

          {/* 评论区 */}
          <div ref={commentsRef} className="flex scroll-mt-4 flex-col gap-3">
            {comments === null && commentsError === null && (
              <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                正在加载评论…
              </div>
            )}
            {commentsError !== null && (
              <div className="flex flex-col items-center gap-2 py-4 text-sm text-muted-foreground">
                <span>{commentsError}</span>
                <Button variant="outline" size="sm" onClick={() => void loadComments(postId)}>
                  重试
                </Button>
              </div>
            )}
            {comments !== null && comments.length === 0 && (
              <p className="py-2 text-center text-sm text-muted-foreground">还没有评论，来说点什么吧～</p>
            )}
            {comments?.map((c) => {
              const cAuthor = plazaAuthorOf(c);
              const cName = cAuthor.nickname?.trim() || '活动伙伴';
              const isMineComment = !!(isAccount && userId && !c.is_demo && c.author_id === userId);
              return (
                <div key={c.id} className="flex items-start gap-2.5 rounded-lg border bg-card p-3">
                  <PlazaAvatar author={cAuthor} className="mt-0.5 h-8 w-8 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-semibold text-foreground/90">{cName}</span>
                      <span className="text-[11px] text-muted-foreground">{formatPlazaTime(c.created_at)}</span>
                    </div>
                    <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed">{c.content}</p>
                  </div>
                  {isMineComment && (
                    <button
                      type="button"
                      aria-label="删除我的评论"
                      className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                      onClick={() => setConfirm({ open: true, target: { kind: 'comment', commentId: c.id } })}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {/* 评论输入 */}
          {isAccount ? (
            <div className="flex gap-2 border-t pt-3">
              <Input
                value={commentText}
                onChange={(e) => setCommentText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.nativeEvent.isComposing) void submitComment();
                }}
                placeholder="友善分享你的想法…"
                maxLength={1000}
              />
              <Button size="sm" className="shrink-0" onClick={() => void submitComment()} disabled={sending || commentText.trim().length === 0}>
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                发送
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => onRequestLogin?.()}
              className="w-full rounded-lg border border-dashed py-2.5 text-center text-sm text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary"
            >
              登录后即可点赞和评论
            </button>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirm.open}
        onOpenChange={(o) => setConfirm((s) => ({ ...s, open: o }))}
        title={confirm.target?.kind === 'post' ? '确认删除这条动态？' : '确认删除这条评论？'}
        description={
          confirm.target?.kind === 'post'
            ? '删除后动态及其图片、点赞和评论都会一并移除，且无法恢复。确定要删除吗？'
            : '删除后这条评论将无法恢复。确定要删除吗？'
        }
        confirmText="确认删除"
        destructive
        onConfirm={handleConfirm}
      />
    </>
  );
}
