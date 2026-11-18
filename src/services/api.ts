import { ApiError, apiRequest } from '@/lib/apiClient';
import type { ProjectData, ProjectListItem, ProjectRow } from '@/types/types';

/* ---------- 未确认保存的本地草稿缓冲（按用户/项目隔离，防刷新丢最后编辑） ---------- */
export interface ProjectDraft {
  title: string;
  data: ProjectData;
  ts: number;
}

const draftKey = (userId: string, projectId: string) => `sf-draft:${userId}:${projectId}`;

export function saveDraft(userId: string, projectId: string, title: string, data: ProjectData): void {
  try {
    localStorage.setItem(
      draftKey(userId, projectId),
      JSON.stringify({ title, data, ts: Date.now() } satisfies ProjectDraft)
    );
  } catch {
    /* 存储满等异常时静默放弃草稿（不影响主流程） */
  }
}

export function getDraft(userId: string, projectId: string): ProjectDraft | null {
  try {
    const raw = localStorage.getItem(draftKey(userId, projectId));
    if (!raw) return null;
    const d = JSON.parse(raw) as ProjectDraft;
    return d && typeof d.ts === 'number' && d.data ? d : null;
  } catch {
    return null;
  }
}

export function clearDraft(userId: string, projectId: string): void {
  try {
    localStorage.removeItem(draftKey(userId, projectId));
  } catch {
    /* 忽略 */
  }
}

export const genId = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

export async function createProject(
  title: string,
  data: ProjectData,
  coverUrl?: string | null
): Promise<string> {
  const id = genId();
  const res = await apiRequest<{ id: string }>('/api/v1/project', {
    method: 'POST',
    body: JSON.stringify({
      id,
      title,
      coverUrl: coverUrl ?? null,
      data,
    }),
  });
  return res.id;
}

export async function getProject(id: string): Promise<ProjectRow | null> {
  try {
    return await apiRequest<ProjectRow>(`/api/v1/project/${encodeURIComponent(id)}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export async function listProjects(limit = 24, offset = 0): Promise<ProjectListItem[]> {
  return await apiRequest<ProjectListItem[]>(`/api/v1/project?limit=${limit}&offset=${offset}`);
}

export async function updateProject(
  id: string,
  patch: { title?: string; coverUrl?: string | null; data?: ProjectData }
): Promise<void> {
  await apiRequest<void>(`/api/v1/project/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export async function deleteProject(id: string): Promise<void> {
  await apiRequest<void>(`/api/v1/project/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
}

/** 上传图片到后端对象存储，返回公开 URL */
export async function uploadImage(
  file: File,
  folder: string,
  maxBytes = 1024 * 1024
): Promise<string> {
  if (file.size > maxBytes) {
    throw new Error('图片大小请控制在 1MB 以内');
  }
  const form = new FormData();
  form.append('file', file);
  form.append('folder', folder);
  const res = await apiRequest<{ url: string }>('/api/v1/media/upload', {
    method: 'POST',
    body: form,
  });
  return res.url;
}

/* ---------- 图像理解（两步真实看图：提交 → 轮询） ---------- */

export async function submitImageUnderstanding(
  question: string,
  imageUrl: string
): Promise<string> {
  const res = await apiRequest<{ taskId: string }>('/api/v1/ai/vision/request', {
    method: 'POST',
    body: JSON.stringify({ question: question.slice(0, 100), url: imageUrl }),
  });
  if (!res.taskId) throw new Error('识图任务提交失败');
  return res.taskId;
}

export async function queryImageUnderstanding(
  taskId: string
): Promise<{ retCode: number; description: string }> {
  return await apiRequest<{ retCode: number; description: string }>('/api/v1/ai/vision/result', {
    method: 'POST',
    body: JSON.stringify({ taskId }),
  });
}

/** 真实看图：提交任务并轮询直至获得图片描述 */
export async function understandImage(
  imageUrl: string,
  question = '请详细描述这张场地照片中的空间结构、墙面门窗、天花地面与可见物件。'
): Promise<string> {
  const taskId = await submitImageUnderstanding(question, imageUrl);
  const deadline = Date.now() + 24000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1200));
    const { retCode, description } = await queryImageUnderstanding(taskId);
    if (retCode === 0) {
      if (!description.trim()) throw new Error('识图返回空结果');
      return description.trim();
    }
    if (retCode !== 1) {
      throw new Error(description || `识图处理失败（状态码 ${retCode}）`);
    }
  }
  throw new Error('识图超时，请重试');
}

/** 上传时先压缩为 1600px JPEG，保证 1MB 内可用 */
export async function compressImage(file: File, maxSide = 1600): Promise<File> {
  if (file.type === 'image/svg+xml') return file;
  const bitmap = await createImageBitmap(file).catch(() => null);
  if (!bitmap) return file;
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  if (scale >= 1 && file.size <= 1024 * 1024) return file;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.82)
  );
  bitmap.close();
  if (!blob || blob.size >= file.size) return file;
  return new File([blob], `${file.name.replace(/\.[^.]+$/, '')}.jpg`, {
    type: 'image/jpeg',
  });
}
