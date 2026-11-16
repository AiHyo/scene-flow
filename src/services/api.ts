import { supabase } from '@/lib/supabase';
import type { ProjectData, ProjectListItem, ProjectRow } from '@/types/types';

/** 文件名 stem 转 hex（Supabase Storage 拒绝非 ASCII 对象键） */
const toHex = (s: string) =>
  Array.from(new TextEncoder().encode(s), (b) => b.toString(16).padStart(2, '0')).join('');

/* ---------- 未确认保存的本地草稿缓冲（按用户/项目隔离，防刷新丢最后编辑） ----------
 * 保存请求未确认成功前把最新编辑写入本地；刷新后与服务端 updated_at 比较，仅恢复更新的草稿，
 * 成功落库后清除。不跨账号/项目（key 含 userId），不无条件覆盖服务端较新版本。 */
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

/** 创建项目（客户端生成 id，insert 不返回） */
export async function createProject(
  title: string,
  data: ProjectData,
  coverUrl?: string | null
): Promise<string> {
  const id = genId();
  const { error } = await supabase.from('projects').insert({
    id,
    title,
    cover_url: coverUrl ?? null,
    data,
  });
  if (error) throw error;
  return id;
}

export async function getProject(id: string): Promise<ProjectRow | null> {
  const { data, error } = await supabase
    .from('projects')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as ProjectRow) ?? null;
}

export async function listProjects(limit = 24, offset = 0): Promise<ProjectListItem[]> {
  const { data, error } = await supabase
    .from('projects')
    .select('id,title,cover_url,created_at,updated_at,data')
    .order('updated_at', { ascending: false })
    .range(offset, offset + limit - 1);
  if (error) throw error;
  return Array.isArray(data) ? (data as ProjectListItem[]) : [];
}

export async function updateProject(
  id: string,
  patch: { title?: string; cover_url?: string | null; data?: ProjectData }
): Promise<void> {
  const { data, error } = await supabase.from('projects').update(patch).eq('id', id).select('id');
  if (error) throw error;
  /* RLS 未命中（会话切换/越权）时 PostgREST 静默返回 200 + 空数组：
   * 必须当失败处理，否则前端误判成功并清掉本地草稿，造成真实数据丢失 */
  if (!data || data.length === 0) {
    throw new Error('保存未生效：当前会话已切换或无权修改该项目，请刷新后重试');
  }
}

export async function deleteProject(id: string): Promise<void> {
  const { error } = await supabase.from('projects').delete().eq('id', id);
  if (error) throw error;
}

/** 上传图片到 media 桶（1MB 限制，hex 文件名），返回公开 URL */
export async function uploadImage(
  file: File,
  folder: string,
  maxBytes = 1024 * 1024
): Promise<string> {
  if (file.size > maxBytes) {
    throw new Error('图片大小请控制在 1MB 以内');
  }
  const dot = file.name.lastIndexOf('.');
  const stem = dot > 0 ? file.name.slice(0, dot) : file.name;
  const ext = dot > 0 ? file.name.slice(dot).toLowerCase() : '.jpg';
  const safeName = `${toHex(stem)}-${genId().slice(0, 8)}${ext}`;
  const path = `${folder}/${safeName}`;
  const { error } = await supabase.storage
    .from('media')
    .upload(path, file, { contentType: file.type, upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from('media').getPublicUrl(path);
  return data.publicUrl;
}

/* ---------- 图像理解（两步真实看图：提交 → 轮询，密钥仅在 EF 服务端） ---------- */

/** 提交图像理解任务，返回 task_id（question ≤100 字符，图片传公开 URL） */
export async function submitImageUnderstanding(
  question: string,
  imageUrl: string
): Promise<string> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const res = await fetch(`${supabaseUrl}/functions/v1/image-understanding-request`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: question.slice(0, 100), url: imageUrl }),
  });
  if (res.status === 429 || res.status === 402) {
    const err = await res.json().catch(() => null);
    throw new Error(
      res.status === 429 ? `识图配额已用尽：${err?.message ?? ''}` : `识图服务余额不足：${err?.message ?? ''}`
    );
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`识图请求失败（HTTP ${res.status}）${text ? `：${text.slice(0, 120)}` : ''}`);
  }
  const json = await res.json();
  const taskId = json?.result?.task_id;
  if (typeof taskId !== 'string' || taskId === '') {
    throw new Error('识图任务提交失败');
  }
  return taskId;
}

/** 单次查询图像理解结果：ret_code 0 成功 / 1 处理中，其他值抛错 */
export async function queryImageUnderstanding(
  taskId: string
): Promise<{ retCode: number; description: string }> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const res = await fetch(`${supabaseUrl}/functions/v1/image-understanding-result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ task_id: taskId }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`识图查询失败（HTTP ${res.status}）${text ? `：${text.slice(0, 120)}` : ''}`);
  }
  const json = await res.json();
  const retCode = json?.result?.ret_code;
  return {
    retCode: typeof retCode === 'number' ? retCode : -1,
    description: json?.result?.description ?? '',
  };
}

/**
 * 真实看图：提交任务并轮询直至获得图片描述。
 * 上限 3 分钟（间隔 3 秒）；失败抛错，调用方不得以纯文字降级发送。
 */
export async function understandImage(
  imageUrl: string,
  question = '请详细描述这张场地照片中的空间结构、墙面门窗、天花地面与可见物件。'
): Promise<string> {
  const taskId = await submitImageUnderstanding(question, imageUrl);
  const POLL_INTERVAL_MS = 3000;
  const TIMEOUT_MS = 3 * 60 * 1000;
  const deadline = Date.now() + TIMEOUT_MS;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const { retCode, description } = await queryImageUnderstanding(taskId);
    if (retCode === 0) {
      if (!description.trim()) throw new Error('识图服务未返回有效描述，请重试');
      return description.trim();
    }
    if (retCode !== 1) throw new Error(`识图任务失败（ret_code ${retCode}），请重试`);
  }
  throw new Error('识图超时（3 分钟），请重试');
}

/** 上传时先压缩为 1600px JPEG，保证 1MB 内可用 */
export async function compressImage(file: File, maxSide = 1600): Promise<File> {  if (file.type === 'image/svg+xml') return file;
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
