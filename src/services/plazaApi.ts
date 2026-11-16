import { supabase } from '@/lib/supabase';

/* ---------- 活动广场：类型 ---------- */

/* 作者信息：发文时刻的快照列（服务端触发器从 profiles 自动填充，客户端不可伪造；
 * 演示作者直接带快照 + 稳定内部 ID，无登录凭证） */
export type PlazaAuthor = { id: string; nickname: string | null; avatar_url: string | null };

export type PlazaPost = {
  id: string;
  title: string;
  content: string;
  images: string[];
  /* 真实用户点赞数（触发器维护） */
  like_count: number;
  /* 演示基础值：显示总数 = base_like_count + like_count */
  base_like_count: number;
  comment_count: number;
  created_at: string;
  is_demo: boolean;
  author_id: string | null;
  author_nickname: string | null;
  author_avatar_url: string | null;
};

export type PlazaComment = {
  id: string;
  post_id: string;
  content: string;
  created_at: string;
  is_demo: boolean;
  author_id: string | null;
  author_nickname: string | null;
  author_avatar_url: string | null;
};

/** 统一的作者展示字段（帖子与评论共用：快照列直读，匿名可读） */
export function plazaAuthorOf(row: { author_id: string | null; author_nickname: string | null; author_avatar_url: string | null }): PlazaAuthor {
  return { id: row.author_id ?? '', nickname: row.author_nickname, avatar_url: row.author_avatar_url };
}

/** 显示点赞总数 = 演示基础值 + 真实用户点赞数 */
export function plazaDisplayLikes(post: Pick<PlazaPost, 'base_like_count' | 'like_count'>): number {
  return post.base_like_count + post.like_count;
}

export const PLAZA_PAGE_SIZE = 12;
export const PLAZA_MAX_IMAGES = 9;

/** 相对时间（超过 7 天显示日期）；后端存 UTC，前端本地时区展示 */
export function formatPlazaTime(iso: string): string {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return '刚刚';
  if (m < 60) return `${m} 分钟前`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d <= 7) return `${d} 天前`;
  const dt = new Date(t);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

/* ---------- 列表 / 发布 / 删除 ---------- */

/** 动态列表（按发布时间倒序，分页）；作者信息经 FK 关联 profiles 左连接（历史数据缺 profiles 行也不丢帖子） */
export async function listPlazaPosts(page = 0): Promise<PlazaPost[]> {
  const { data, error } = await supabase
    .from('plaza_posts')
    .select(
      'id, title, content, images, like_count, base_like_count, comment_count, created_at, is_demo, author_id, author_nickname, author_avatar_url'
    )
    .order('created_at', { ascending: false })
    .range(page * PLAZA_PAGE_SIZE, (page + 1) * PLAZA_PAGE_SIZE - 1);
  if (error) throw error;
  return Array.isArray(data) ? (data as unknown as PlazaPost[]) : [];
}

/** 当前用户已点赞的动态 id 集合（轻量广场：一次拉取全量，避免逐帖子查询） */
export async function listMyLikedPostIds(userId: string): Promise<Set<string>> {
  const { data, error } = await supabase
    .from('plaza_likes')
    .select('post_id')
    .eq('user_id', userId)
    .limit(500);
  if (error) throw error;
  return new Set((Array.isArray(data) ? data : []).map((r) => (r as { post_id: string }).post_id));
}

export async function createPlazaPost(input: { title: string; content: string; images: string[] }): Promise<string> {
  const { data, error } = await supabase
    .from('plaza_posts')
    .insert({ title: input.title, content: input.content, images: input.images })
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data?.id) throw new Error('发布失败，请稍后重试');
  return data.id as string;
}

export async function deletePlazaPost(id: string): Promise<void> {
  const { error } = await supabase.from('plaza_posts').delete().eq('id', id);
  if (error) throw error;
  /* RLS 拦截越权删除时静默影响 0 行（无错误返回），补查确认确实删除，防止前端误报成功 */
  const { data } = await supabase.from('plaza_posts').select('id').eq('id', id).maybeSingle();
  if (data) throw new Error('无权删除这条动态');
}

/** 删除动态后清理对应 Storage 图片（尽力而为，清理失败不阻塞删除结果） */
export async function removePlazaImages(urls: string[]): Promise<void> {
  const marker = '/storage/v1/object/public/';
  const paths = urls
    .map((u) => {
      const i = u.indexOf(marker);
      if (i < 0) return null;
      const rest = u.slice(i + marker.length);
      const slash = rest.indexOf('/');
      return slash > 0 ? rest.slice(slash + 1) : null;
    })
    .filter((p): p is string => !!p);
  if (paths.length === 0) return;
  try {
    await supabase.storage.from('media').remove(paths);
  } catch {
    /* 图片清理失败不影响动态删除结果 */
  }
}

/** 列表缩略图：Supabase Storage 公开 URL 经 resize transform 渲染，避免整页加载原图；
 * 项目本地静态资源（/images/...，演示配图）直接返回原地址 */
/* ---------- 点赞（每人每帖一次，主键约束 + DO NOTHING 幂等） ---------- */

export async function likePlazaPost(postId: string): Promise<void> {
  const { error } = await supabase
    .from('plaza_likes')
    .upsert({ post_id: postId }, { onConflict: 'post_id,user_id', ignoreDuplicates: true });
  if (error) throw error;
}

export async function unlikePlazaPost(postId: string): Promise<void> {
  const { error } = await supabase.from('plaza_likes').delete().eq('post_id', postId);
  if (error) throw error;
}

/* ---------- 评论（单级，不做楼中楼） ---------- */

export async function listPlazaComments(postId: string): Promise<PlazaComment[]> {
  const { data, error } = await supabase
    .from('plaza_comments')
    /* plaza_comments 的作者列是 user_id（非 posts.author_id），其余为快照列 */
    .select('id, post_id, content, created_at, is_demo, user_id, author_nickname, author_avatar_url')
    .eq('post_id', postId)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) throw error;
  /* 行内 user_id 映射到 PlazaComment.author_id，保持消费端字段一致 */
  type Row = Omit<PlazaComment, 'author_id'> & { user_id: string | null };
  return Array.isArray(data)
    ? (data as unknown as Row[]).map((r) => ({
        id: r.id,
        post_id: r.post_id,
        content: r.content,
        created_at: r.created_at,
        is_demo: r.is_demo,
        author_id: r.user_id,
        author_nickname: r.author_nickname,
        author_avatar_url: r.author_avatar_url,
      }))
    : [];
}

export async function addPlazaComment(postId: string, content: string): Promise<void> {
  const { error } = await supabase.from('plaza_comments').insert({ post_id: postId, content });
  if (error) throw error;
}

export async function deletePlazaComment(id: string): Promise<void> {
  const { error } = await supabase.from('plaza_comments').delete().eq('id', id);
  if (error) throw error;
  /* RLS 越权拦截时影响 0 行且不报错，补查防止前端误报成功 */
  const { data } = await supabase.from('plaza_comments').select('id').eq('id', id).maybeSingle();
  if (data) throw new Error('无权删除这条评论');
}
