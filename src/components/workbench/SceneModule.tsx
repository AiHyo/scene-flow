import { ArrowRight, Download, ExternalLink, Eye, History, ImagePlus, Loader2, MapPin, Plus, RefreshCw, Sparkles, Tag, Trash2, Upload, Users, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDropzone } from 'react-dropzone';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import CompareCanvas from '@/components/scene/CompareCanvas';
import { PendingImageBar } from '@/components/shared/PendingImageBar';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import CollapsibleSection from '@/components/workbench/CollapsibleSection';
import { PARTNER_CATALOG } from '@/data/partnerCatalog';
import { MATERIAL_RESOURCES } from '@/data/resources';
import { VENUE_SAMPLES, type VenueSample } from '@/data/venueSamples';
import { usePendingImage } from '@/hooks/usePendingImage';
import { supabase } from '@/lib/supabase';
import { cn } from '@/lib/utils';
import { compressImage, uploadImage } from '@/services/api';
import { normalizeTags } from '@/services/sceneTags';
import { fromQuery } from '@/services/returnContext';
import type { ProjectData, SceneState } from '@/types/types';

const DECOR_TAGS = ['灯光', '舞台', '桌椅', '装饰', '签到区', '氛围', '绿植', '照片墙'];

interface SceneModuleProps {
  data: ProjectData;
  /** 关键场景变更（滑块/生图快照/原图绑定/布置输入防抖到期）立即落库版本 */
  patchNow: (partial: Partial<ProjectData>) => void;
  /** 外部请求打开生成要求预览（对话区「生成布置效果」入口；用户确认才真正生图） */
  genSignal?: number;
  /** 上传/更换场地照片后：直达 AI 对话发送图文消息开启深度对话（独立场景页流程） */
  onUploadAndChat?: (imageUrl: string, note?: string) => void;
  /** 工作区内上传/更换照片：仅更新当前活动场地原图与布置说明，不发送 AI 消息、不导航（由用户另行主动触发生成/对话） */
  onUploadOnly?: (imageUrl: string, note?: string) => void;
  /** 共用生图流程（与对话内触发同源；按钮/对话/轮询统一走这里，含全局任务锁检查） */
  onGenerate?: (opts?: { density?: 'simple' | 'medium' | 'rich'; tags?: string[]; extra?: string }) => Promise<{ ok: boolean; message?: string; needsBefore?: boolean; busy?: boolean }>;
  /** 按钮触发生图前，先在会话流插入自然用户请求（与对话触发同一流程） */
  onUserRequest?: (msg: string) => void;
  /** 生图任务状态消息进会话（失败反馈等，携带成果标签） */
  onTaskLog?: (msg: string, actionTag?: { label: string; module: 'plan' | 'scene' | 'budget' }) => void;
  /** 全局任务锁：任一 AI 任务进行中禁用生图入口 */
  taskLocked?: boolean;

  /** 全部收起 */
  allCollapsed?: boolean;
  /** 新内容红点提示 */
  fresh?: boolean;
}

interface QueryResp {
  task_status: string;
  task_status_msg?: string;
  images?: Array<{ url?: string; file?: string }>;
}

export default function SceneModule({ data, patchNow, genSignal, onUploadAndChat, onUploadOnly, onGenerate, onUserRequest, onTaskLog, taskLocked, allCollapsed, fresh }: SceneModuleProps) {
  const scene = data.scene ?? {};
  /* 卡片展开/收起：随项目持久化（data.ui.collapsed）；allCollapsed 为全局收起 */
  const uiC = data.ui?.collapsed ?? {};
  const secOpen = (k: string) => !(allCollapsed || uiC[k]);
  const toggleSec = (k: string, next: boolean) =>
    patchNow({ ui: { ...data.ui, collapsed: { ...uiC, [k]: !next } } });
  const [style, setStyle] = useState('');
  const [extra, setExtra] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [density, setDensity] = useState<'simple' | 'medium' | 'rich'>('medium');
  const [customTag, setCustomTag] = useState('');
  const [generating, setGenerating] = useState(false);
  /** 生成占用中：本地进行中或持久化任务查询中（防止重复提交/双轮询） */
  const busy = generating || scene.genTask?.status === 'querying';
  const [bigView, setBigView] = useState(false);
  /** 右上角上传弹窗状态 */
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  /** 弹窗内填写的场地布置诉求与说明 */
  const [uploadNote, setUploadNote] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /* 最新 scene/patchNow 存 ref：防抖合并后基于最新值立即落库，避免闭包快照覆盖并发更新 */
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const patchNowRef = useRef(patchNow);
  patchNowRef.current = patchNow;
  const inputDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingSceneRef = useRef<Partial<SceneState>>({});
  const posDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* 挂载时从项目恢复布置输入与分割位置（旧项目缺字段按空/默认，不覆盖已有数据） */
  useEffect(() => {
    setStyle(scene.style ?? scene.notes ?? '');
    setExtra(scene.extra ?? '');
    setTags(normalizeTags(scene.tags));
    setDensity(scene.density ?? 'medium');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /** 布置输入 → 合并防抖 600ms 后立即落库（不走 800ms 二级防抖，防刷新丢失） */
  const persistSceneInput = useCallback((p: Partial<SceneState>) => {
    pendingSceneRef.current = { ...pendingSceneRef.current, ...p };
    if (inputDebounceRef.current) clearTimeout(inputDebounceRef.current);
    inputDebounceRef.current = setTimeout(() => {
      const pending = pendingSceneRef.current;
      pendingSceneRef.current = {};
      patchNowRef.current({ scene: { ...sceneRef.current, ...pending } });
    }, 600);
  }, []);

  useEffect(
    () => () => {
      /* 切页签卸载时把未落盘输入立即写回；整页刷新由 Workbench 的 beforeunload 保存兜底 */
      if (inputDebounceRef.current) clearTimeout(inputDebounceRef.current);
      if (posDebounceRef.current) clearTimeout(posDebounceRef.current);
      if (Object.keys(pendingSceneRef.current).length > 0) {
        const pending = pendingSceneRef.current;
        pendingSceneRef.current = {};
        patchNowRef.current({ scene: { ...sceneRef.current, ...pending } });
      }
    },
    []
  );

  useEffect(
    () => () => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    },
    []
  );

  const setScene = useCallback(
    (p: Partial<SceneState>) => patchNow({ scene: { ...scene, ...p } }),
    [patchNow, scene]
  );

  /* ---------- 上传场地照片（统一四态状态机：失败保留文件可重试，成功才绑定场地） ---------- */
  const venue = usePendingImage('venue');
  const pickRef = useRef<HTMLInputElement>(null);

  const onDrop = useCallback(
    (files: File[]) => {
      void venue.pick(files[0]);
    },
    [venue]
  );

  /* 上传成功 → 绑定为原始场地；替换已有照片时旧效果图立即作废（保留布置输入与分割位置等已保存字段） */
  useEffect(() => {
    const pi = venue.img;
    if (pi?.status === 'ok' && pi.url) {
      if (scene.beforeUrl && scene.beforeUrl !== pi.url) {
        toast.info('已更换场地照片，原布置效果图不再对应，可重新生成');
      }
      setScene({ ...scene, beforeUrl: pi.url, isExample: false });
      venue.clear();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [venue.img?.status, venue.img?.url]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.jpeg', '.jpg', '.png', '.webp'] },
    maxFiles: 1,
    multiple: false,
    disabled: venue.busy || generating,
  });

  /* 现成场地选用：直接秒级选用预设高质量场地原图，无需前端重复二次转存与压缩，零卡顿 */
  const [previewSample, setPreviewSample] = useState<VenueSample | null>(null);
  /* 已有活动更换底图时先说明影响并确认；未选过场地则直接选用（历史图片与聊天全程保留） */
  const [confirmSample, setConfirmSample] = useState<VenueSample | null>(null);
  const applySample = useCallback(
    (s: VenueSample) => {
      if (generating) return;
      setScene({ ...scene, beforeUrl: s.before, isExample: false });
      toast.success(`已选用「${s.name}」作为新场地，历史效果图已在 AI 对话中为你保存`);
    },
    [generating, setScene]
  );
  const requestApplySample = useCallback(
    (s: VenueSample) => {
      if (generating) return;
      if (scene.beforeUrl && scene.beforeUrl !== s.before) {
        setConfirmSample(s);
      } else {
        applySample(s);
      }
    },
    [generating, scene.beforeUrl, applySample]
  );

  /* ---------- 生成布置效果图（可灵） ---------- */
  const buildPrompt = useCallback(() => {
    const visualTheme = (data.requirements?.visualTheme?.value as string) || '';
    const styleVal = (data.requirements?.style?.value as string) || style || '现代温馨';
    /* 完整当前条件进入生成请求：已确认主题/风格/人数/地区/其他需求/明确排除（不只拿一句主题名） */
    const r = data.requirements ?? {};
    const condParts: string[] = [];
    if (r.headcount?.value) condParts.push(`人数：${r.headcount.value}（桌椅与通道规模按此安排，不得堵门）`);
    if (r.region?.value) condParts.push(`地区：${r.region.value}`);
    if (r.budget?.value || data.budget?.limit != null)
      condParts.push(`预算范围：${data.budget?.limit != null ? `${data.budget.limit} 元以内` : ((r.budget?.value as string) ?? '')}（布置强度按预算取轻量方案）`);
    const otherNeeds = r.otherNeeds?.trim();
    if (otherNeeds) condParts.push(`其他要求：${otherNeeds}`);
    const avoid = r.avoid?.trim();
    if (avoid) condParts.push(`明确排除：${avoid}（相关元素不得出现）`);
    /* 可移动物料：已就绪物料优先复用 */
    const readyMats = (data.materials ?? []).filter((m) => m.ready).map((m) => `${m.name}${m.qty ? `×${m.qty}` : ''}`);
    if (readyMats.length > 0) condParts.push(`已有可复用物料：${readyMats.join('、')}（优先使用，不重复采购）`);
    const themePart = visualTheme
      ? `活动视觉主题：${visualTheme}，风格：${styleVal}（新增装饰与配色围绕该主题展开，不改变原有建筑结构）`
      : `主题风格：${styleVal}`;
    /* 结构保留约束：有原图时按参考图做局部装饰编辑并锁结构；无原图时明确为概念图 */
    const hasBefore = !!scene.beforeUrl;
    const structureRule = hasBefore
      ? '图像编辑任务：<<<image_1>>> 是真实场地照片，以它为唯一底图做局部编辑，输出必须与<<<image_1>>>是同一个房间、同一场地、同一张照片。保持相机机位、视角、透视、焦距与画幅裁切完全一致，视平线和灭点不得偏移。墙体、地面、天花、门窗的位置形状数量样式、窗外景色、梁柱及全部固定装修一律原样保留，不得移动、增删、缩放、重建、改色或改变透视与自然光照方向。只允许在原有空地上添加或调整可移动软装物件（桌椅、背板、帷幔、花艺、灯光道具、展架等），新物件需符合原图透视与比例，不得遮挡门口与主要通道。画面中不得出现任何人物、动物；不要在图片中生成任何文字'
      : '生成一张活动布置氛围概念图（无原始场地照片，仅为概念参考，不对应任何真实场地结构）';
    /* 布置范围：用户明确提供的物料清单为主，未选元素不自动添加（含舞台/投影幕等暗示性默认） */
    const extraText = extra.trim();
    let scopeRule: string;
    if (tags.length > 0 && extraText) {
      scopeRule = `布置范围仅限以下物件与说明：${tags.join('、')}；${extraText}。除清单与说明明确提到的物件外，任何其他物件（包括舞台、投影幕、LED屏、背景板、展架等）一律不得添加`;
    } else if (tags.length > 0) {
      scopeRule = `布置范围仅限以下物件：${tags.join('、')}。除清单明确选中的物件外，任何其他物件（包括舞台、投影幕、LED屏、背景板、展架等）一律不得添加`;
    } else if (extraText) {
      scopeRule = `布置范围以补充说明为准：${extraText}。说明未提到的物件（包括舞台、投影幕、背景板等）一律不得添加`;
    } else {
      scopeRule =
        '布置范围仅为少量轻量可移动装饰（气球、灯串、桌布等），不得添加舞台、投影幕、背景板等大型设施';
    }
    /* 布置程度：控制装饰密度与视觉层次；丰富不破预算、不改建筑结构 */
    const densityPart =
      density === 'simple'
        ? '布置程度：简约档（轻量点缀，仅在关键局部保留简约可移动软装，大面积保留原空间通透开阔，不作大面积密集遮盖）'
        : density === 'rich'
          ? '布置程度：丰富档（高密度视觉层次与饱满装饰，点缀丰满；但严禁突破现有预算，优先调整已有物品摆位和组合，严禁改动任何固定墙体、门窗、立柱、机位或基础结构；需新增物料时按极高性价比安排）'
          : '布置程度：适中档（标准活动氛围，主次分明，视觉饱满和谐）';

    const parts = [
      structureRule,
      densityPart,
      themePart,
      condParts.length > 0 ? `当前条件：${condParts.join('；')}` : '',
      scopeRule,
      '装饰物件大小与空间比例可信，不遮挡门口与通道；不要在图片中生成任何文字',
    ];
    return parts.filter(Boolean).join('。');
  }, [data.requirements, data.materials, data.budget, style, tags, extra, scene.beforeUrl, density]);

  /** 轮询生成任务（查询已提交任务，不重发请求）；结果/失败随项目写入 genTask，切页回来由恢复 effect 继续查询 */
  const startPolling = useCallback(
    (taskId: string, snap: NonNullable<SceneState['genTask']>) => {
      if (pollRef.current) clearInterval(pollRef.current);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      const startedAt = Date.now();
      let pollFails = 0; /* 连续失败计数：偶发网络错误容忍，连续失败才明确报错（不再永久静默） */
      pollRef.current = setInterval(async () => {
        try {
          const { data: q, error: qErr } = await supabase.functions.invoke<QueryResp>(
            'kling-omni-image-query',
            { body: { task_id: taskId } }
          );
          if (qErr) throw new Error(qErr.message);
          pollFails = 0;
          if (!q) return;

          if (q.task_status === 'succeed' && q.images?.[0]?.url) {
            if (pollRef.current) clearInterval(pollRef.current);
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            /* 空白/占位图兜底：上游 succeed 但返回不可渲染图（如 1px 透明占位或损坏文件）时，
             * 视为生图失败明确报错，绝不把空白图写入 afterUrl 冒充有效效果图 */
            let originBlob: Blob;
            try {
              const checkRes = await fetch(q.images[0].url as string);
              if (!checkRes.ok) throw new Error(`HTTP ${checkRes.status}`);
              originBlob = await checkRes.blob();
              const sizeOk = originBlob.size > 2048;
              let dimOk = true;
              try {
                const bitmap = await createImageBitmap(originBlob);
                dimOk = bitmap.width >= 64 && bitmap.height >= 64;
                bitmap.close();
              } catch {
                dimOk = true; /* 解码失败不据此判空，交由后续渲染错误提示 */
              }
              if (!sizeOk || !dimOk) throw new Error('blank or placeholder image');
            } catch (blankErr) {
              console.warn('生图结果为空或占位图，按失败处理', blankErr);
              patchNowRef.current({
                scene: { ...sceneRef.current, genTask: { ...snap, status: 'failed', error: '生成结果为空或不可用，请重试' } },
              });
              toast.error('生图结果为空，请重试');
              setGenerating(false);
              return;
            }
            /* 晚到结果保护：用户在生成期间更换了场地原图 → 本结果属旧任务，不再写入 afterUrl
             * 冒充新场地效果；仅清任务状态并明确提示（历史卡片由 chatLog 持久化保留） */
            const beforeChanged = !!snap.beforeUrl && sceneRef.current.beforeUrl !== snap.beforeUrl;
            if (beforeChanged) {
              patchNowRef.current({
                scene: { ...sceneRef.current, genTask: undefined },
              });
              toast.info('本次结果基于生成时的旧场地原图（期间已更换原图），已不作数；请用新原图重新生成');
              setGenerating(false);
              return;
            }
            /* 上游临时 URL 会过期：先转存到项目存储，失败才降级用临时链接并明确提示 */
            /* 复用上方校验时下载的图片数据，避免重复请求上游临时链接 */
            let finalUrl = q.images[0].url as string;
            try {
              const f = new File([originBlob], `scene-effect-${Date.now()}.jpg`, {
                type: originBlob.type || 'image/jpeg',
              });
              const processed = await compressImage(f, 1600);
              finalUrl = await uploadImage(processed, 'venue');
            } catch (e) {
              console.warn('效果图转存失败，暂用上游临时链接', e);
              toast.warning('效果图已生成；持久保存暂未完成，临时链接约 30 天内有效');
            }
            /* 结果与本次任务的要求快照绑定写入（用 ref 取当前 scene，不覆盖期间的新输入） */
            patchNowRef.current({
              scene: {
                ...sceneRef.current,
                afterUrl: finalUrl,
                isExample: false,
                stale: false,
                lastReq: {
                  beforeUrl: snap.beforeUrl,
                  style: snap.style,
                  tags: snap.tags,
                  extra: snap.extra,
                  prompt: snap.prompt,
                  at: Date.now(),
                },
                genTask: undefined,
              },
            });
            toast.success('布置效果图已生成');
            setGenerating(false);
          } else if (q.task_status === 'failed') {
            if (pollRef.current) clearInterval(pollRef.current);
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
            const msg = q.task_status_msg ?? '请稍后重试';
            patchNowRef.current({
              scene: { ...sceneRef.current, genTask: { ...snap, status: 'failed', error: msg } },
            });
            toast.error(`生成失败：${msg}`);
            setGenerating(false);
          }
        } catch (e) {
          /* 连续 3 次查询失败：明确报错（含真实错误信息），单次失败静默重试 */
          pollFails += 1;
          console.error(e);
          if (pollFails >= 3) {
            pollFails = 0;
            const msg = e instanceof Error && e.message ? e.message : '查询生成进度失败';
            toast.error(`查询布置效果图进度连续失败：${msg.slice(0, 80)}；任务可能仍在后台进行，稍后回到本页会自动恢复查询`);
          }
        }
        if (Date.now() - startedAt > 10 * 60 * 1000) {
          if (pollRef.current) clearInterval(pollRef.current);
          patchNowRef.current({
            scene: {
              ...sceneRef.current,
              genTask: { ...snap, status: 'failed', error: '生成超时，请重试' },
            },
          });
          toast.error('生成超时，请稍后重试');
          setGenerating(false);
        }
      }, 7000);

      timeoutRef.current = setTimeout(() => {
        if (pollRef.current) clearInterval(pollRef.current);
        patchNowRef.current({
          scene: {
            ...sceneRef.current,
            genTask: { ...snap, status: 'failed', error: '生成超时，请重试' },
          },
        });
        setGenerating(false);
        toast.error('生成超时，请稍后重试');
      }, 10 * 60 * 1000);
    },
    []
  );

  /* 恢复进行中的生成任务：切页/刷新回来继续查询（仅查询不重发）；超龄任务如实标失败待重试 */
  useEffect(() => {
    const t = scene.genTask;
    if (!t || t.status !== 'querying') return;
    if (Date.now() - t.submittedAt > 11 * 60 * 1000) {
      patchNowRef.current({
        scene: {
          ...sceneRef.current,
          genTask: { ...t, status: 'failed', error: '任务时间过长，状态待确认；可重试生成' },
        },
      });
      return;
    }
    setGenerating(true);
    startPolling(t.taskId, t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene.genTask?.taskId]);

  const generate = useCallback(async () => {
    if (generating || scene.genTask?.status === 'querying') return;
    /* 全局任务锁：任一 AI 任务（对话/方向/方案/文案）进行中不允许同时生图 */
    if (taskLocked) {
      toast.info('当前有 AI 任务进行中，请稍候再生成布置效果图');
      return;
    }
    if (!scene.beforeUrl) {
      toast.info('请先上传或选择一张场地照片作为底图');
      return;
    }
    /* 共用生图流程：与对话内触发同源（triggerSceneFromAi），提交+任务快照+恢复查询统一 */
    if (!onGenerate) return;
    setGenerating(true);
    /* 按钮即对话：生图请求也进入会话流（成功后 sceneCard 消息由通用 effect 沉淀，失败由 Workbench 反馈） */
    onUserRequest?.(
      `请基于当前场地照片生成布置效果图（${density === 'simple' ? '简约' : density === 'rich' ? '丰富' : '适中'}布置${tags.length > 0 ? `，加入${tags.join('、')}` : ''}${extra.trim() ? `；${extra.trim()}` : ''}）。`
    );
    try {
      const res = await onGenerate({ density, tags: tags.length > 0 ? [...tags] : undefined, extra: extra.trim() || undefined });
      if (!res.ok) {
        onTaskLog?.(res.message || '提交生成失败，请重试');
        toast.error(res.message || '提交生成失败，请重试');
        setGenerating(false);
        return;
      }
      /* 成功提交：genTask 已写入项目，恢复 effect 会接手轮询；本地 generating 保持到轮询结束 */
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : '生成失败，请重试');
      setGenerating(false);
    }
  }, [generating, scene.beforeUrl, scene.genTask, setScene, taskLocked, onGenerate, density, tags, extra]);

  /* 下载已生成的布置效果图：下载原始图片文件（非画布截图），失败可见提示 */
  const downloadAfter = async (url: string) => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      const theme = (data.requirements?.visualTheme?.value as string) || data.theme?.name || '布置效果图';
      a.download = `布置效果图-${theme.slice(0, 12)}-${new Date().toISOString().slice(0, 10)}.jpg`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
      toast.success('已开始下载布置图');
    } catch (e) {
      console.error(e);
      toast.error('下载失败，可长按或右键图片另存');
    }
  };

  /* 对话区「生成布置效果」入口：切换到本页签并滚动到布置要求区（用户确认才生图，入口不自动调用） */
  useEffect(() => {
    if (!genSignal) return;
    document.getElementById('scene-req-anchor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [genSignal]);

  const toggleTag = (t: string) => {
    const next = tags.includes(t) ? tags.filter((x) => x !== t) : [...tags, t];
    setTags(next);
    persistSceneInput({ tags: next });
  };

  /** 添加用户自定义元素标签 */
  const addCustomTag = () => {
    const val = customTag.trim();
    if (!val) return;
    if (tags.includes(val)) {
      toast.info('该布置元素已在列表中');
      setCustomTag('');
      return;
    }
    const next = [...tags, val];
    setTags(next);
    persistSceneInput({ tags: next });
    setCustomTag('');
    toast.success(`已添加布置元素：${val}`);
  };

  /** 计算本次布置实际用到的材料数据与对应的轻量合作商 Badge 标签 */
  const sceneMaterials = useMemo(() => {
    const activeTags = scene.lastReq?.tags ?? (tags.length > 0 ? tags : DECOR_TAGS.slice(0, 3));
    const items: Array<{
      name: string;
      category?: string;
      partner?: { name: string; url: string; platform: string };
    }> = [];

    for (const t of activeTags) {
      const matched = PARTNER_CATALOG.find(
        (p) => p.category === 'online' && p.keywords.some((k) => t.includes(k) || k.includes(t))
      );
      /* 对齐原则：推广链接只来自合作伙伴目录；未命中则不挂推广标签，不回退到泛品类条目 */
      items.push({
        name: t.length <= 3 ? `${t}饰品/组合` : t,
        partner: matched ? { name: matched.name, url: matched.url, platform: matched.urlLabel } : undefined,
      });
    }

    // 结合项目已有物料补充
    for (const m of (data.materials ?? []).slice(0, 4)) {
      if (!items.some((it) => it.name.includes(m.name))) {
        const matched = PARTNER_CATALOG.find(
          (p) => p.category === 'online' && p.keywords.some((k) => m.name.includes(k))
        );
        items.push({
          name: m.name,
          category: m.category,
          partner: matched ? { name: matched.name, url: matched.url, platform: matched.urlLabel } : undefined,
        });
      }
    }
    return items;
  }, [scene.lastReq?.tags, tags, data.materials]);

  /** 对比分割位置变化：防抖 500ms 合并连续拖动后立即落库，刷新重开后停留在原位置 */
  const onComparePos = useCallback(
    (p: number) => {
      if (posDebounceRef.current) clearTimeout(posDebounceRef.current);
      posDebounceRef.current = setTimeout(() => {
        patchNowRef.current({ scene: { ...sceneRef.current, comparePos: Math.round(p) } });
      }, 500);
    },
    []
  );

  return (
    /* 窄成果栏：左列与右列上下排列（照片在上、效果在下）；宽成果视图恢复两列对比 */
    <div className="grid gap-6 @4xl:grid-cols-2">
      {/* 左列 */}
      <div className="flex flex-col gap-6">
        {/* 场地照片 */}
        <CollapsibleSection
          sectionKey="venue"
          title="场地照片"
          summary={scene.beforeUrl ? '已绑定场地照片' : '未上传'}
          open={secOpen('venue')}
          onToggle={(v) => toggleSec('venue', v)}
          fresh={fresh}
          className=""
          bodyClassName="p-4 pt-0 md:p-5 md:pt-0"
        >
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <div>
              
              <p className="text-xs text-muted-foreground">真实拍摄场地或直接选用预设场地</p>
            </div>
            {/* 主操作置顶：上传弹窗一键直达，弹窗内填写诉求并直跳 AI 对话 */}
            <Button
              size="sm"
              onClick={() => {
                setUploadNote(scene.notes || '');
                setUploadDialogOpen(true);
              }}
              disabled={venue.busy}
            >
              <Upload className="h-4 w-4" />
              {scene.beforeUrl ? '更换场地照片' : '上传我的场地'}
            </Button>
          </div>

          {/* 上传中 / 失败：保留预览与重试入口 */}
          {venue.img && (
            <div className="mb-3">
              <PendingImageBar
                img={venue.img}
                onRetry={venue.retry}
                onRemove={venue.clear}
                okHint="照片已就绪…"
              />
            </div>
          )}

          {scene.beforeUrl ? (
            <div className="flex items-center gap-3 rounded-xl border bg-muted/20 p-2.5">
              <div className="overflow-hidden rounded-lg border max-w-36 shrink-0">
                <img src={scene.beforeUrl} alt="当前场地" className="aspect-[3/2] w-full object-cover" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate">当前生效场地照片</p>
                <p
                  className="mt-0.5 line-clamp-2 whitespace-pre-wrap break-words text-[11px] text-muted-foreground"
                  title={scene.notes ? `布置想法：${scene.notes}` : undefined}
                >
                  {scene.notes ? `布置想法：${scene.notes}` : '上传照片并写布置想法，生成效果图时小灵会参考'}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 px-2 text-xs"
                    onClick={() => {
                      setUploadNote(scene.notes || '');
                      setUploadDialogOpen(true);
                    }}
                  >
                    更换
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive"
                    onClick={() => {
                      setScene({ beforeUrl: undefined, afterUrl: undefined, isExample: false });
                      toast.info('已移除当前场地照片');
                    }}
                  >
                    移除
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-dashed bg-muted/30 p-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-2">
                <Upload className="h-4 w-4 text-primary" />
                还没有场地照片？点击右上角上传，或直接选用下方现成场地
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 shrink-0 text-xs"
                onClick={() => {
                  setUploadNote(scene.notes || '');
                  setUploadDialogOpen(true);
                }}
              >
                去上传
              </Button>
            </div>
          )}

          {/* 还没选场地？示例场地推荐区（最多 3 张，紧凑展示，不挤压上传与布置操作） */}
          <div className="mt-3 border-t pt-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-muted-foreground">
                {scene.beforeUrl ? '换个示例场地再试：' : '还没选场地？先用示例场地图试试：'}
              </p>
              <Link
                to={`/resources?tab=local&${fromQuery(data.id ?? '', 'scene')}`}
                className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
              >
                更多场地与服务
                <ArrowRight className="h-3 w-3" />
              </Link>
            </div>
            <div className="mt-2 grid grid-cols-3 gap-2">
              {VENUE_SAMPLES.map((s) => (
                <div
                  key={s.id}
                  className="flex flex-col overflow-hidden rounded-xl border transition-colors hover:border-primary/40"
                >
                  <button
                    type="button"
                    disabled={generating || venue.busy}
                    onClick={() => requestApplySample(s)}
                    className="block w-full disabled:cursor-not-allowed disabled:opacity-50"
                    aria-label={`选用 ${s.name} 的场地图`}
                  >
                    <img
                      src={s.before}
                      alt={`${s.name}照片`}
                      loading="lazy"
                      className="aspect-[3/2] w-full object-cover"
                    />
                  </button>
                  <div className="min-w-0 px-2 pt-1.5">
                    <p className="truncate text-xs font-medium">{s.name}</p>
                    <p className="mt-0.5 flex items-center gap-1 truncate text-[10px] text-muted-foreground">
                      <MapPin className="h-2.5 w-2.5 shrink-0" />
                      {s.region}
                      <Users className="ml-1 h-2.5 w-2.5 shrink-0" />
                      {s.capacity}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPreviewSample(s)}
                    className="mt-1.5 flex w-full items-center justify-center gap-1 border-t px-2 py-1.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/5"
                  >
                    <Eye className="h-3 w-3" />
                    查看场地
                  </button>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
              示例场地仅用于快速体验布置（选用只更换底图，不会自动生成效果图）；真实场地可从「更多场地与服务」按地区查找。
            </p>
          </div>
        </CollapsibleSection>

        {/* 现成场地布置效果查看（静态前后对比，不调用生图） */}
        <Dialog open={previewSample !== null} onOpenChange={(o) => !o && setPreviewSample(null)}>
          <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-3xl">
            <DialogHeader>
              <DialogTitle className="text-left">{previewSample?.name}</DialogTitle>
              <DialogDescription className="text-left">
                {previewSample?.desc}（{previewSample?.region} · 参考 {previewSample?.capacity}）；拖动分割线查看同一空间的布置前后变化
              </DialogDescription>
            </DialogHeader>
            {previewSample && (
              <CompareCanvas
                beforeUrl={previewSample.before}
                afterUrl={previewSample.after}
                className="aspect-[3/2] w-full rounded-xl"
              />
            )}
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">
                选用只更换场地底图，不会自动生成效果图；历史图片与聊天完整保留。
              </p>
              <Button
                size="sm"
                className="shrink-0"
                disabled={generating}
                onClick={() => {
                  const s = previewSample;
                  setPreviewSample(null);
                  if (s) requestApplySample(s);
                }}
              >
                <ImagePlus className="h-4 w-4" />
                选用这张场地图
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* 已有活动更换场地底图：说明影响并确认（历史图片与聊天保留；选图不代表预订成功） */}
        <AlertDialog open={confirmSample !== null} onOpenChange={(o) => !o && setConfirmSample(null)}>
          <AlertDialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
            <AlertDialogHeader>
              <AlertDialogTitle>更换场地照片？</AlertDialogTitle>
              <AlertDialogDescription>
                将把场地底图更换为「{confirmSample?.name}」。原有效果图与新场地不再对应；历史图片和聊天记录会完整保留，选图不代表预订成功，也不会自动加入场租费用。
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>先不换</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => {
                  if (confirmSample) applySample(confirmSample);
                  setConfirmSample(null);
                }}
              >
                确认更换
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* 布置要求 */}
        <CollapsibleSection
          sectionKey="reqs"
          title="布置要求"
          summary={`${tags.length} 个布置项`}
          open={secOpen('reqs')}
          onToggle={(v) => toggleSec('reqs', v)}
          fresh={fresh}
          className="scroll-mt-20 overflow-hidden"
          bodyClassName="p-4 pt-0 md:p-5 md:pt-0"
        >
          
          <div className="flex flex-col gap-4">
            {/* 布置程度：控制装饰密度与视觉层次，默认适中 */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">布置程度（装饰密度）</span>
                <span className="text-[11px] text-muted-foreground">
                  {density === 'simple' && '简约档：轻量点缀，留白通透，仅核心氛围物料'}
                  {density === 'medium' && '适中档（默认）：标准适度，主视觉与重点区域饱满'}
                  {density === 'rich' && '丰富档：高密度视觉层次（不超预算、不改建筑结构）'}
                </span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { key: 'simple', label: '简约', tip: '核心氛围轻量点缀' },
                  { key: 'medium', label: '适中（默认）', tip: '标准适度层次饱满' },
                  { key: 'rich', label: '丰富', tip: '高密度视觉氛围' },
                ].map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => {
                      setDensity(opt.key as 'simple' | 'medium' | 'rich');
                      persistSceneInput({ density: opt.key as 'simple' | 'medium' | 'rich' });
                    }}
                    className={cn(
                      'flex flex-col items-center justify-center rounded-xl border p-2 text-center transition-all',
                      density === opt.key
                        ? 'border-primary bg-primary/10 font-medium text-primary ring-1 ring-primary'
                        : 'border-border/60 text-muted-foreground hover:bg-muted/40'
                    )}
                  >
                    <span className="text-xs">{opt.label}</span>
                    <span className="mt-0.5 text-[10px] opacity-75">{opt.tip}</span>
                  </button>
                ))}
              </div>
              {density === 'rich' && (
                <p className="rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-700 dark:text-amber-400">
                  💡 丰富档规则：仅提升活动装饰密度与陈列层次；不突破现有预算，优先调整已有物品摆位和组合；严格保留原有墙体、门窗、柱梁等建筑结构。
                </p>
              )}
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">主题风格</span>
              <Input
                value={style}
                onChange={(e) => {
                  const v = e.target.value;
                  setStyle(v);
                  persistSceneInput({ style: v });
                }}
                placeholder={data.theme?.name ?? '如：温暖晚宴风'}
              />
            </div>

            {/* 布置元素（预设 + 自定义输入） */}
            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">布置元素（可多选或自定义输入）</span>
              <div className="flex flex-wrap gap-2">
                {DECOR_TAGS.map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => toggleTag(t)}
                    className={cn(
                      'rounded-full border px-3 py-1.5 text-xs font-medium transition-colors',
                      tags.includes(t)
                        ? 'border-primary bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:border-primary/40 hover:text-foreground'
                    )}
                  >
                    {t}
                  </button>
                ))}
                {tags
                  .filter((t) => !DECOR_TAGS.includes(t))
                  .map((t) => (
                    <span
                      key={t}
                      className="inline-flex items-center gap-1 rounded-full border border-primary bg-primary/15 px-3 py-1 text-xs font-medium text-primary"
                    >
                      {t}
                      <button
                        type="button"
                        onClick={() => toggleTag(t)}
                        className="opacity-60 hover:opacity-100"
                        aria-label={`移除${t}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
              </div>

              {/* 自定义元素输入区 */}
              <div className="mt-1 flex items-center gap-2">
                <Input
                  value={customTag}
                  onChange={(e) => setCustomTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addCustomTag();
                    }
                  }}
                  placeholder="输入自定义元素标签（如：复古黑胶留声机、多巴胺气球拱门）"
                  className="h-8 flex-1 text-xs"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 gap-1 text-xs"
                  onClick={addCustomTag}
                  disabled={!customTag.trim()}
                >
                  <Plus className="h-3.5 w-3.5" />
                  添加元素
                </Button>
              </div>
            </div>

            <div className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">补充说明</span>
              <Textarea
                value={extra}
                onChange={(e) => {
                  const v = e.target.value;
                  setExtra(v);
                  persistSceneInput({ extra: v });
                }}
                rows={3}
                placeholder="其他要求，比如：入口要有签到台、主色调偏蓝紫…"
              />
            </div>
            <Button size="lg" disabled={busy || taskLocked} onClick={generate}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
              {generating
                ? '生成中，约需 1–2 分钟…'
                : scene.beforeUrl
                  ? '生成布置效果图'
                  : '生成氛围概念图（无场地照片时）'}
            </Button>
            {/* 生成中离开本页任务不取消：状态与结果随项目保存，回来可见（见右列任务状态卡） */}
            {/* 已有结果可直接下载，无需重新生成 */}
            {scene.afterUrl && !scene.isExample && (
              <Button variant="outline" size="sm" onClick={() => downloadAfter(scene.afterUrl as string)}>
                <Download className="h-4 w-4" />
                下载布置图
              </Button>
            )}
            <p className="text-xs leading-relaxed text-muted-foreground">
              AI 将<b>参考原场地照片生成布置效果</b>；会尽量保持门窗、墙体与机位不变，但生成模型无法保证与原图严格像素对齐，如效果不理想可调整要求后重新生成。生成约需 1–2 分钟，请勿关闭页面。
            </p>
          </div>
        </CollapsibleSection>
      </div>

      {/* 右列：效果展示 */}
      <CollapsibleSection
        sectionKey="effect"
        title="布置效果"
        summary={scene.genTask?.status === 'querying' ? '生成中…' : scene.afterUrl ? (scene.stale ? '已生成（对应旧要求）' : '已生成布置效果') : '尚未生成效果'}
        open={secOpen('effect')}
        onToggle={(v) => toggleSec('effect', v)}
        fresh={fresh}
        className=""
        bodyClassName="p-4 pt-0 md:p-5 md:pt-0"
      >
        {/* 旧图对应旧要求的独立标注：基于已保存的生成快照（lastReq）与当前要求逐项比对派生，
         * 不混入可编辑的布置说明字段；显式 stale 标志（调整写入）或要求实质变化都触发 */}
        {(() => {
          if (!scene.afterUrl) return null;
          const lr = scene.lastReq;
          const curStyle = (scene.style ?? '').trim();
          const curTags = normalizeTags(scene.tags).join('、'); /* 已保存要求为准，输入草稿不触发 */
          const lrStyle = lr?.style ?? '';
          const lrTags = (lr?.tags ?? []).join('、');
          const lrExtra = (lr?.extra ?? '').trim();
          const curExtra = (scene.extra ?? '').trim();
          const reqChanged =
            !!lr && (lrStyle !== curStyle || (lrTags !== '' && lrTags !== curTags) || (lrExtra !== '' && lrExtra !== curExtra));
          if (!scene.stale && !reqChanged) return null;
          const curBrief = [curStyle ? `风格「${curStyle}」` : '', curTags ? `元素「${curTags}」` : ''].filter(Boolean).join('，');
          const oldReqBrief = [
            lrStyle ? `风格「${lrStyle}」` : '',
            lrTags ? `元素「${lrTags}」` : '',
            lr?.extra ? `说明「${lr.extra.length > 40 ? `${lr.extra.slice(0, 40)}…` : lr.extra}」` : '',
          ]
            .filter(Boolean)
            .join('，');
          return (
            <div className="mb-4 rounded-lg border border-chart-5/40 bg-chart-5/5 px-3 py-2.5">
              <p className="flex items-center gap-1.5 text-xs font-semibold text-chart-5">
                <History className="h-3.5 w-3.5 shrink-0" /> 这张效果图对应旧布置要求
              </p>
              {oldReqBrief && <p className="mt-1 text-[11px] leading-relaxed text-foreground/75">按当时要求生成：{oldReqBrief}</p>}
              <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                当前要求已变化{curBrief ? `（${curBrief}）` : ''}，本图不代表最新要求的效果。
              </p>
              <Button variant="outline" size="sm" className="mt-2 h-7 border-chart-5/50 text-chart-5 hover:bg-chart-5/10" disabled={busy || taskLocked} onClick={generate}>
                <RefreshCw className="h-3.5 w-3.5" />
                按当前要求生成
              </Button>
            </div>
          );
        })()}
        {scene.afterUrl && scene.lastReq?.beforeUrl && scene.lastReq.beforeUrl !== scene.beforeUrl && (
          <div className="mb-3 rounded-lg border border-chart-5/40 bg-chart-5/5 px-3 py-2">
            <span className="text-xs leading-relaxed text-chart-5">这张效果图基于生成时的另一张场地原图（当前原图已更换）；如需基于新原图请重新生成</span>
          </div>
        )}
        {scene.afterUrl && (
          <p className="mb-3 text-[11px] leading-relaxed text-muted-foreground">
            效果图由 AI 基于场地原图做局部编辑生成：会尽量保持墙体、门窗与透视一致，仅添加可移动布置；复杂空间仍可能出现结构偏差，请以实际场地为准。
          </p>
        )}
        <div className="mb-4 flex items-center justify-between gap-2">
          
          {scene.afterUrl && !scene.isExample && (
            <Button variant="outline" size="sm" disabled={busy || taskLocked} onClick={generate}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              重新生成
            </Button>
          )}
        </div>

        {scene.beforeUrl && scene.afterUrl ? (
          <div className="flex flex-col gap-3">
            <CompareCanvas
              /* 对比绑定生成时实际使用的原图（lastReq.beforeUrl）：当前原图已更换时不拿旧房间效果冒充新原图对比 */
              beforeUrl={scene.lastReq?.beforeUrl ?? scene.beforeUrl}
              afterUrl={scene.afterUrl}
              className="aspect-[3/2] w-full rounded-xl"
              initial={scene.comparePos ?? 50}
              onPosChange={onComparePos}
            />
            <Button variant="outline" size="sm" className="self-start" onClick={() => setBigView(true)}>
              <ImagePlus className="h-4 w-4" />
              查看大图
            </Button>
          </div>
        ) : scene.afterUrl ? (
          <div className="overflow-hidden rounded-xl border">
            <img src={scene.afterUrl} alt="布置效果图" className="aspect-[3/2] w-full object-cover" />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-4 rounded-xl border border-dashed py-16 text-center">
            <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 text-primary">
              <Sparkles className="h-6 w-6" />
            </span>
            <div>
              <p className="text-sm font-medium">还没有布置效果图</p>
              <p className="mt-1 max-w-56 text-xs leading-relaxed text-muted-foreground">
                上传场地照片、选好布置要求后，点击「生成布置效果图」
              </p>
            </div>
          </div>
        )}

        {scene.notes && (
          <p className="mt-4 rounded-lg bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
            布置说明：{scene.notes}
          </p>
        )}

        {/* 生成任务状态卡：任务随项目保存（切页不取消）；失败如实标因并保留重试入口 */}
        {scene.genTask && (
          <div
            className={cn(
              'mt-4 rounded-lg border p-3 text-xs leading-relaxed',
              scene.genTask.status === 'querying'
                ? 'border-primary/40 bg-primary/5'
                : 'border-destructive/40 bg-destructive/5'
            )}
          >
            <p className={cn('mb-1 font-medium', scene.genTask.status === 'querying' ? 'text-primary' : 'text-destructive')}>
              {scene.genTask.status === 'querying'
                ? '正在生成布置效果图…'
                : `上次生成未完成：${scene.genTask.error ?? '未知原因'}`}
            </p>
            <p className="text-muted-foreground">
              {scene.genTask.status === 'querying'
                ? '任务已随项目保存，切页或刷新不会取消；回到本页会自动继续查询结果，不会重复提交。'
                : '可点击下方重试重新生成（将重新提交一次生成请求）。'}
            </p>
            {scene.genTask.status === 'failed' && (
              <Button size="sm" variant="outline" className="mt-2" disabled={busy || taskLocked} onClick={generate}>
                <RefreshCw className="h-3.5 w-3.5" />
                重试生成
              </Button>
            )}
          </div>
        )}

        {/* 本次生图实际采用的要求快照：仅在有真实结果时显示（无结果不冒充完成记录） */}
        {scene.lastReq && !scene.isExample && scene.afterUrl && (
          <div className="mt-4 rounded-lg bg-muted/60 p-3 text-xs leading-relaxed text-muted-foreground">
            <p className="mb-1 font-medium text-foreground/80">
              本次生成采用的要求{scene.lastReq.at ? `（${new Date(scene.lastReq.at).toLocaleString('zh-CN')}）` : ''}
            </p>
            <p>主题风格：{scene.lastReq.style || '默认'}</p>
            {scene.lastReq.density && (
              <p>
                布置程度：
                {scene.lastReq.density === 'simple'
                  ? '简约档'
                  : scene.lastReq.density === 'rich'
                    ? '丰富档（不改建筑结构）'
                    : '适中档'}
              </p>
            )}
            {scene.lastReq.tags && scene.lastReq.tags.length > 0 && <p>布置元素：{scene.lastReq.tags.join('、')}</p>}
            {scene.lastReq.extra && <p>补充说明：{scene.lastReq.extra}</p>}
          </div>
        )}

        {/* 本次布置采用材料清单与轻量合作商推荐 Badge 标签（点击跳转外链，不采用大图干扰） */}
        {(scene.afterUrl || (scene.lastReq?.tags && scene.lastReq.tags.length > 0)) && (
          <div className="mt-4 rounded-xl border bg-card p-3.5 shadow-2xs">
            <div className="mb-2.5 flex items-center justify-between">
              <h3 className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                本次布置采用材料清单与采购推荐
              </h3>
              <span className="text-[11px] text-muted-foreground">共 {sceneMaterials.length} 项关键物料</span>
            </div>
            <div className="flex flex-col gap-2">
              {sceneMaterials.map((item, idx) => (
                <div
                  key={idx}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-muted/40 px-2.5 py-1.5 text-xs"
                >
                  <span className="font-medium text-foreground">{item.name}</span>
                  {item.partner && (
                    <a
                      href={item.partner.url}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/20"
                      title={`查看合作物料：${item.partner.name}`}
                    >
                      <Tag className="h-2.5 w-2.5" />
                      合作推荐：{item.partner.name}
                      <ExternalLink className="ml-0.5 h-2.5 w-2.5" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 待生成时的当前布置要求（明确表示将用于下次生成，非完成记录） */}
        {!scene.afterUrl && !scene.genTask && !scene.isExample && (style.trim() || tags.length > 0 || extra.trim()) && (
          <div className="mt-4 rounded-lg border border-dashed p-3 text-xs leading-relaxed text-muted-foreground">
            <p className="mb-1 font-medium text-foreground/80">当前布置要求（将用于下次生成）</p>
            {style.trim() && <p>主题风格：{style.trim()}</p>}
            {tags.length > 0 && <p>布置元素：{tags.join('、')}</p>}
            {extra.trim() && <p>补充说明：{extra.trim()}</p>}
          </div>
        )}
      </CollapsibleSection>

      {/* 大图查看 */}
      <Dialog open={bigView} onOpenChange={setBigView}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-4xl">
          {/* 标题行内嵌一行布局放下载按钮：保留 DialogHeader 默认纵向基类（避免 flex-col/row 覆盖顺序不确定），
              右侧 pr-10 与右上角关闭叉号留出间距，不重叠 */}
          <DialogHeader className="pr-10">
            <div className="flex items-center gap-2 text-left">
              <div className="min-w-0 flex-1">
                <DialogTitle>布置效果对比</DialogTitle>
                <DialogDescription>拖动分割线对比布置前后</DialogDescription>
              </div>
              {!scene.isExample && scene.afterUrl && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 shrink-0 gap-1.5"
                  title="下载当前布置效果图到本地"
                  onClick={() => downloadAfter(scene.afterUrl as string)}
                >
                  <Download className="h-4 w-4" />
                  下载布置效果图
                </Button>
              )}
            </div>
          </DialogHeader>
          {scene.beforeUrl && scene.afterUrl && (
            <CompareCanvas
              beforeUrl={scene.beforeUrl}
              afterUrl={scene.afterUrl}
              className="aspect-[3/2] w-full rounded-xl"
              initial={scene.comparePos ?? 50}
              onPosChange={onComparePos}
            />
          )}
          {!scene.isExample && scene.afterUrl && (
            <Button variant="outline" size="sm" className="mx-auto mt-2" onClick={() => downloadAfter(scene.afterUrl as string)}>
              <Download className="h-4 w-4" />
              下载布置图
            </Button>
          )}
        </DialogContent>
      </Dialog>

      {/* 场景布置：右上角上传场地照片弹窗（嵌套诉求说明，确认后一键直跳 AI 对话以用户身份发送图文） */}
      <Dialog open={uploadDialogOpen} onOpenChange={setUploadDialogOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-lg">
          <DialogHeader>
            <DialogTitle className="text-left">
              {onUploadOnly ? '上传 / 更换场地照片' : '上传我的场地照片并开启对话'}
            </DialogTitle>
            <DialogDescription className="text-left">
              {onUploadOnly
                ? '照片仅更新当前活动的场地原图与布置说明，不会发送给 AI，也不会创建新活动；需要生成布置效果时请再点击「生成布置效果图」。'
                : '上传真实拍摄的场地照片，并填写初步的想法或诉求，确认后将直接进入 AI 对话开启多轮深度策划。'}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2">
            {/* 照片上传/选取区 */}
            <div>
              <label className="text-xs font-medium text-foreground mb-1.5 block">场地照片</label>
              {venue.img?.url || scene.beforeUrl ? (
                <div className="flex items-center gap-3 rounded-xl border bg-muted/20 p-2.5">
                  <div className="overflow-hidden rounded-lg border max-w-28 shrink-0">
                    <img
                      src={venue.img?.url || scene.beforeUrl}
                      alt="场地预览"
                      className="aspect-[3/2] w-full object-cover"
                    />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-foreground truncate">
                      {venue.busy ? '正在上传中…' : '照片已就绪'}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-2 h-7 px-2 text-xs"
                      onClick={() => pickRef.current?.click()}
                      disabled={venue.busy}
                    >
                      重新选择
                    </Button>
                  </div>
                </div>
              ) : (
                <div
                  {...getRootProps()}
                  className={cn(
                    'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors',
                    isDragActive ? 'border-primary bg-primary/5' : 'hover:border-primary/40',
                    venue.busy && 'pointer-events-none opacity-60'
                  )}
                >
                  <input {...getInputProps()} />
                  {venue.busy ? (
                    <Loader2 className="h-6 w-6 animate-spin text-primary" />
                  ) : (
                    <span className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                      <Upload className="h-4 w-4" />
                    </span>
                  )}
                  <div>
                    <p className="text-xs font-medium">{venue.busy ? '正在上传…' : '点击或拖拽上传场地照片'}</p>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">支持 JPG / PNG / WEBP，最大 1MB</p>
                  </div>
                </div>
              )}
            </div>

            {/* 无照片时的轻提示：示例场地的唯一入口在面板「换个示例场地」（避免与弹窗重复） */}
            {!venue.img?.url && !scene.beforeUrl && (
              <button
                type="button"
                onClick={() => setUploadDialogOpen(false)}
                className="w-full rounded-lg border border-dashed px-3 py-2 text-left text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
              >
                没有场地照片？关闭本窗口，在下方「换个示例场地」直接选用系统预设空场景 →
              </button>
            )}

            {/* 场地布置想法或诉求（工作区内为「布置说明」，仅保存不发送）：保留简单一行 */}
            <div>
              <label className="text-xs font-medium text-foreground mb-1.5 block">
                {onUploadOnly ? '布置说明（选填，仅保存到当前活动）' : '布置想法或诉求（选填）'}
              </label>
              <Input
                placeholder="一句话说说布置想法，如：入口签到、主舞台风格、气球色系…"
                value={uploadNote}
                onChange={(e) => setUploadNote(e.target.value)}
                className="text-xs"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setUploadDialogOpen(false)}
            >
              取消
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={venue.busy || (!venue.img?.url && !scene.beforeUrl)}
              onClick={() => {
                const targetUrl = venue.img?.url || scene.beforeUrl;
                if (!targetUrl) {
                  toast.error('请先上传场地照片');
                  return;
                }
                setUploadDialogOpen(false);
                if (onUploadOnly) {
                  /* 工作区：仅更新场地原图与布置说明，不发 AI 消息、不导航 */
                  onUploadOnly(targetUrl, uploadNote);
                } else if (onUploadAndChat) {
                  onUploadAndChat(targetUrl, uploadNote);
                } else {
                  setScene({ ...scene, beforeUrl: targetUrl, notes: uploadNote, isExample: false });
                  toast.success('场地已绑定');
                }
              }}
            >
              {onUploadOnly ? (
                <>
                  <Upload className="h-3.5 w-3.5 mr-1" />
                  保存照片
                </>
              ) : (
                <>
                  <Sparkles className="h-3.5 w-3.5 mr-1" />
                  确认并发送给 AI 伙伴
                </>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
