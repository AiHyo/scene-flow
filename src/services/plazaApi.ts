import { apiRequest } from '@/lib/apiClient';

/* ---------- 活动广场：类型（对齐后端驼峰契约） ---------- */

export type PlazaAuthor = { id: string; nickname: string | null; avatarUrl: string | null };

export type PlazaPost = {
  id: string;
  title: string;
  content: string;
  imgList: string[];
  likeCount: number;
  likedByMe: boolean;
  createTime: string;
  updateTime: string;
  authorId: string;
  authorNickname: string | null;
  authorAvatarUrl: string | null;
};

export type PlazaComment = {
  id: string;
  postId: string;
  content: string;
  createTime: string;
  authorId: string;
  authorNickname: string | null;
  authorAvatarUrl: string | null;
};

export type PlazaPostDetail = PlazaPost & {
  commentList: PlazaComment[];
};

export function plazaAuthorOf(row: {
  authorId: string;
  authorNickname: string | null;
  authorAvatarUrl: string | null;
}): PlazaAuthor {
  return {
    id: row.authorId,
    nickname: row.authorNickname,
    avatarUrl: row.authorAvatarUrl,
  };
}

export function plazaDisplayLikes(post: Pick<PlazaPost, 'likeCount'>): number {
  return post.likeCount;
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

export async function listPlazaPosts(page = 0): Promise<PlazaPost[]> {
  const offset = page * PLAZA_PAGE_SIZE;
  return await apiRequest<PlazaPost[]>(`/api/v1/plaza-post?limit=${PLAZA_PAGE_SIZE}&offset=${offset}`);
}

export async function getPlazaPostDetail(id: string): Promise<PlazaPostDetail> {
  return await apiRequest<PlazaPostDetail>(`/api/v1/plaza-post/${encodeURIComponent(id)}`);
}

export async function createPlazaPost(input: {
  title: string;
  content: string;
  imgList: string[];
}): Promise<PlazaPost> {
  return await apiRequest<PlazaPost>('/api/v1/plaza-post', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export async function deletePlazaPost(id: string): Promise<void> {
  await apiRequest<void>(`/api/v1/plaza-post/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/* ---------- 点赞 ---------- */

export async function togglePlazaLike(postId: string): Promise<{ liked: boolean; likeCount: number }> {
  return await apiRequest<{ liked: boolean; likeCount: number }>(
    `/api/v1/plaza-post/${encodeURIComponent(postId)}/like`,
    { method: 'POST' }
  );
}

/* ---------- 评论 ---------- */

export async function addPlazaComment(postId: string, content: string): Promise<PlazaComment> {
  return await apiRequest<PlazaComment>(`/api/v1/plaza-post/${encodeURIComponent(postId)}/comment`, {
    method: 'POST',
    body: JSON.stringify({ content: content.trim() }),
  });
}

export async function deletePlazaComment(id: string): Promise<void> {
  await apiRequest<void>(`/api/v1/plaza-comment/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}
