import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, ImagePlus, Loader2, Maximize2, Send, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import CompareCanvas from '@/components/scene/CompareCanvas';
import { PendingImageBar } from '@/components/shared/PendingImageBar';
import { usePendingImage } from '@/hooks/usePendingImage';
import { VENUE_SAMPLES } from '@/data/venueSamples';
import { compressImage, createProject, understandImage, uploadImage } from '@/services/api';
import { useAuth } from '@/contexts/AuthContext';
import type {ChatMessage, ProjectData} from '@/types/types';
import { cn } from '@/lib/utils';
import ReturnBar from '@/components/shared/ReturnBar';

const GREETING = '你好呀！我是小灵，可以陪你一起想活动方向、把想法整理成完整方案、排流程管预算、写邀请函文案，也能根据场地照片生成布置效果图～';

export default function SceneStart() {
  const navigate = useNavigate();
  const { ready, userId, waitForReady } = useAuth();
  /** 用户自己的场地照片（四态状态机） */
  const venue = usePendingImage('venue');
  const [note, setNote] = useState('');
  const [creating, setCreating] = useState(false);
  /** 独立图像理解服务读取照片中（创建前置步骤） */
  const [visionWorking, setVisionWorking] = useState(false);
  /** 示例卡的「查看大图」预览对象（弹窗内完整前后对比） */
  const [preview, setPreview] = useState<(typeof VENUE_SAMPLES)[number] | null>(null);
  /** 下载原图 / 效果图：下载完整图片文件本身（非滑块截图、不重新生成） */
  const downloadImage = async (url: string, name: string) => {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    } catch {
      toast.error('下载失败，请重试');
    }
  };
  /** 示例需求可修改 / 可清空 */
  const [briefs, setBriefs] = useState<Record<string, string>>(
    Object.fromEntries(VENUE_SAMPLES.map((s) => [s.id, s.brief]))
  );
  const [trying, setTrying] = useState<string | null>(null);
  /** 标题旁轻量上传弹窗 */
  const [uploadOpen, setUploadOpen] = useState(false);
  const dialogFileRef = useRef<HTMLInputElement>(null);

  const imgBlocking = !!venue.img && venue.img.status !== 'ok';
  /* 任意非空文字即可开始（同策划页：短诉求也是有效输入，AI 会追问） */
  const canStartOwn = !creating && !imgBlocking && (!!venue.readyUrl || note.trim().length > 0);

  /* 用自己的场地开始：携图（或纯文字诉求）创建项目，直接进入场景布置页签 */
  const startOwn = async () => {
    if (!canStartOwn || creating) return;
    setCreating(true);
    try {
      /* 访客匿名会话建立中：自动等待（纯文字诉求与带图一视同仁，不再被迫传图等会话） */
      if (!ready || !userId) {
        const ok = await waitForReady(15000);
        if (!ok || !userId) {
          toast.error('会话准备中，请稍候再试');
          setCreating(false);
          return;
        }
      }
      const imgurl = venue.readyUrl;
      const text = note.trim() || (imgurl ? '这是我们的场地照片，想先看看布置建议' : '');
      if (!text) return;
      /* 携图即真实看图：失败中止创建不降级，用户可整页重试 */
      let vision: string | undefined;
      if (imgurl) {
        setVisionWorking(true);
        try {
          vision = await understandImage(imgurl);
        } catch (e) {
          console.error(e);
          toast.error(e instanceof Error ? e.message : '看图失败，请重试');
          return;
        } finally {
          setVisionWorking(false);
        }
      }
      /* 小灵招呼语是窗口初始化时 AI 发的消息（不是用户消息）；用户消息只带真实输入 */
      const greetMsg: ChatMessage = { id: `a-${Date.now()}`, role: 'assistant', content: GREETING, ts: Date.now() };
      const firstMsg: ChatMessage = {
        id: `u-${Date.now()}`,
        role: 'user',
        content: text,
        ts: Date.now(),
        ...(imgurl ? { imageUrl: imgurl, vision } : {}),
      };
      const payload: ProjectData = {
        description: text,
        requirements: { goal: text },
        chatLog: text ? [greetMsg, firstMsg] : [greetMsg],
        intent: 'venue',
        ...(imgurl ? { scene: { beforeUrl: imgurl } } : {}),
      };
      const ptitle = imgurl && !note.trim() ? '场地布置' : note.trim().slice(0, 12);
      const id = await createProject(ptitle, payload);
      toast.success('已创建，进入场景布置');
      sessionStorage.setItem('sf-fresh-workbench', id);
      /* 直通数据：免二次网络读取，进入即渲染（一次性，读取后即删） */
      try {
        sessionStorage.setItem('sf-fresh-data', JSON.stringify({ id, title: ptitle, data: payload }));
      } catch {
        /* 存储异常退回正常加载 */
      }
      navigate(`/workbench/${id}`);
    } catch (e) {
      console.error(e);
      toast.error('创建失败，请重试');
      setCreating(false);
    }
  };

  /* 用这个场地试一试：示例原图转存到项目存储后进入真实 AI 流程，不触发生图 */
  const trySample = async (s: (typeof VENUE_SAMPLES)[number]) => {
    if (trying) return;
    setTrying(s.id);
    try {
      /* 访客匿名会话建立中：自动等待 */
      if (!ready || !userId) {
        const ok = await waitForReady(15000);
        if (!ok || !userId) {
          toast.error('会话准备中，请稍候再试');
          setTrying(null);
          return;
        }
      }
      const res = await fetch(s.before);
      if (!res.ok) throw new Error('读取示例场地失败');
      const blob = await res.blob();
      const file = new File([blob], `sample-${s.id}.png`, { type: blob.type || 'image/png' });
      const processed = await compressImage(file, 1600);
      const url = await uploadImage(processed, 'venue');
      /* 用户清空默认诉求=不沿用示例主题，改用中性开场文案（仍携带照片进入共策） */
      const text = (briefs[s.id] ?? s.brief).trim() || '这是我们的场地照片，想先看看布置建议';
      /* 示例场地同样真实看图后再建项（AI 基于真实照片内容回答，不用示例预设文字冒充识图） */
      let vision: string;
      setVisionWorking(true);
      try {
        vision = await understandImage(url);
      } catch (e) {
        console.error(e);
        toast.error(e instanceof Error ? e.message : '看图失败，请重试');
        return;
      } finally {
        setVisionWorking(false);
      }
      /* 小灵招呼语是窗口初始化时 AI 发的消息（示例场地入口同）；用户消息只带真实输入 */
      const greetMsg: ChatMessage = { id: `a-${Date.now()}`, role: 'assistant', content: GREETING, ts: Date.now() };
      const firstMsg: ChatMessage = {
        id: `u-${Date.now()}`,
        role: 'user',
        content: text,
        ts: Date.now(),
        imageUrl: url,
        vision,
      };
      const payload: ProjectData = {
        description: text,
        requirements: { goal: text },
        chatLog: text ? [greetMsg, firstMsg] : [greetMsg],
        intent: 'venue',
        scene: { beforeUrl: url },
      };
      const id = await createProject(s.title, payload);
      toast.success('已带入示例场地，可在工作台继续调整');
      sessionStorage.setItem('sf-fresh-workbench', id);
      /* 直通数据：免二次网络读取，进入即渲染（一次性，读取后即删） */
      try {
        sessionStorage.setItem('sf-fresh-data', JSON.stringify({ id, title: s.title, data: payload }));
      } catch {
        /* 存储异常退回正常加载 */
      }
      navigate(`/workbench/${id}`);
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : '带入失败，请重试');
      setTrying(s.id ? null : null);
      setTrying(null);
    }
  };

  return (
    <div className="sf-page-body mx-auto w-full max-w-6xl px-4 py-16 md:px-8 md:py-24">
      <ReturnBar />      <div className="sf-deco" aria-hidden="true">
        <span className="sf-blob sf-paper-purple-faint" style={{top: '-8%', left: '-18%', width: '26vw', height: '26vw', minWidth: 220, minHeight: 220}} />
        <span className="sf-blob sf-paper-cream-faint" style={{top: '6%', right: '-16%', width: '22vw', height: '22vw', minWidth: 180, minHeight: 180}} />
      </div>

      <div className="mb-8 flex flex-col items-center gap-4 text-center md:flex-row md:items-end md:justify-between md:text-left">
        <div className="min-w-0">
          <span className="mb-4 inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            无需注册 · 上传即用
          </span>
          <h1 className="text-3xl font-bold tracking-tight text-balance md:text-4xl">场景布置</h1>
          <p className="mt-3 max-w-xl text-pretty text-sm leading-relaxed text-muted-foreground md:text-base">
            上传你的场地照片，告诉 AI 想要的感觉——AI 会保留原有空间结构，给出布置方向与效果预览
          </p>
        </div>
        {/* 标题旁显眼主入口：轻量上传弹窗，不必向下寻找 */}
        <Button
          size="lg"
          className="h-12 shrink-0 rounded-full px-6 shadow-lg"
          onClick={() => setUploadOpen(true)}
        >
          <ImagePlus className="h-5 w-5" />
          {venue.readyUrl ? '查看/更换我的场地' : '上传我的场地'}
        </Button>
      </div>

      {/* 轻量上传弹窗：选择即上传并预览；完成后引导填写想法开始（不自动 AI、不自动生图） */}
      <Dialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md">
          <DialogHeader>
            <DialogTitle>上传我的场地</DialogTitle>
            <DialogDescription>
              拍一张场地照片：墙体、门窗、柱子等原有结构会被保留，布置只添加可移动装饰，不改建筑不堵门。
            </DialogDescription>
          </DialogHeader>
          <input
            ref={dialogFileRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              void venue.pick(f);
            }}
          />
          {venue.img ? (
            <div className="flex flex-col gap-3">
              <PendingImageBar
                img={venue.img}
                onRetry={venue.retry}
                onRemove={venue.clear}
                okHint="照片已就绪，可随第一条消息发给 AI"
              />
              {venue.img.status === 'ok' && venue.img.url && (
                <img
                  src={venue.img.url}
                  alt="场地原图预览"
                  className="aspect-[3/2] w-full rounded-xl border object-cover"
                />
              )}
            </div>
          ) : (
            <button
              type="button"
              onClick={() => dialogFileRef.current?.click()}
              className="flex min-h-32 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed p-6 text-center transition-colors hover:border-primary/40"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10 text-primary">
                <ImagePlus className="h-5 w-5" />
              </span>
              <span className="text-sm font-medium">点击选择场地照片</span>
              <span className="text-xs text-muted-foreground">支持 JPG / PNG / WEBP，超限自动压缩</span>
            </button>
          )}
          {/* 布置诉求（可不填）：文字+照片作为同一条用户消息绑定同一活动；只写文字=先聊聊，不自动生图 */}
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="想布置成什么感觉？比如：生日会要温馨一点，入口有签到台…（可不填）"
            className="min-h-20 resize-none"
          />
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => {
                /* 取消：关闭弹窗不创建活动，已选照片与文字保留 */
                setUploadOpen(false);
              }}
            >
              取消
            </Button>
            <Button
              disabled={!canStartOwn || creating || imgBlocking}
              onClick={() => void startOwn()}
            >
              {creating || venue.busy || visionWorking ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {creating ? '正在创建…' : venue.busy ? '图片上传中…' : visionWorking ? 'AI 正在看图…' : venue.img ? '带上照片开始' : '开始创建场地'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 选择场地：场地布置参考（前后对比与快速开始，首屏可见，缩略图入口不藏在下方） */}
      <section className="mb-12">
        <div className="mb-4">
          <h2 className="text-lg font-semibold">场地布置参考</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            拖动卡片图中的分割线，查看同一场地的布置前后对比；看中可「以这个场地开始」，也可以点击标题旁「上传我的场地」用自己的照片
          </p>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          {VENUE_SAMPLES.map((s) => (
            <div key={s.id} className="flex h-full flex-col rounded-2xl border bg-card p-3 shadow-sm md:p-4">
              {/* 卡片内直接拖拽前后对比（默认分割线居中；拖拽在对比组件内部，不触发其他操作） */}
              <CompareCanvas
                beforeUrl={s.before}
                afterUrl={s.after}
                className="aspect-[3/2] w-full rounded-xl border"
                labels={['原场地', '布置效果']}
              />
              <div className="mt-3 min-w-0 flex-1">
                {/* 场地名称强调空间类型；副标题为示例主题仅供参考 */}
                <div className="flex items-baseline gap-2">
                  <h3 className="text-sm font-semibold">{s.name}</h3>
                  <span className="truncate text-xs text-muted-foreground">{s.subtitle}</span>
                </div>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{s.desc}</p>
                {/* 参考物料：卡片只取前几项保持紧凑，完整清单在大图弹窗查看 */}
                <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-relaxed text-muted-foreground">
                  <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-primary" />
                  <span className="min-w-0">
                    <span className="font-medium text-foreground/75">参考物料：</span>
                    {s.materials.slice(0, 3).join(' · ')}
                    {s.materials.length > 3 ? ` 等 ${s.materials.length} 项` : ''}
                  </span>
                </p>
                <div className="mt-3">
                  <label className="mb-1 block text-[11px] font-medium text-muted-foreground">
                    布置诉求（可直接修改）
                  </label>
                  <Textarea
                    value={briefs[s.id] ?? ''}
                    onChange={(e) => setBriefs((prev) => ({ ...prev, [s.id]: e.target.value }))}
                    placeholder="可修改或清空默认诉求"
                    className="min-h-16 resize-none border-border/80 bg-muted/20 text-xs focus-visible:bg-background"
                  />
                </div>
              </div>
              <div className="mt-3 flex flex-col gap-2">
                {/* 卡片仅保留查看大图入口；下载统一在弹窗内 */}
                <Button variant="outline" size="sm" className="w-full" onClick={() => setPreview(s)}>
                  <Maximize2 className="h-4 w-4" />
                  查看大图
                </Button>
                <Button
                  size="sm"
                  disabled={trying !== null}
                  onClick={() => void trySample(s)}
                >
                  {trying === s.id ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Sparkles className="h-4 w-4" />
                  )}
                  {trying === s.id ? '正在带入…' : '以这个场地开始'}
                </Button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 查看大图：大尺寸前后对比（完整查看 + 拖拽分割线 + 完整参考物料清单） */}
      <Dialog open={preview !== null} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-5xl">
          <DialogHeader>
            <DialogTitle className="text-left">
              {preview?.name} · 布置前后
            </DialogTitle>
            <DialogDescription className="text-left">
              拖动分割线查看同一空间的布置前后变化，底部可分别下载原图与效果图
            </DialogDescription>
          </DialogHeader>
          {preview && (
            <CompareCanvas
              beforeUrl={preview.before}
              afterUrl={preview.after}
              className={cn('aspect-[3/2] w-full max-h-[50vh] rounded-xl object-contain')}
              labels={['原场地', '布置效果']}
            />
          )}
          {/* 完整参考物料清单：卡片只展示前几项，此处为全部 */}
          {preview && (
            <div className="rounded-xl bg-muted/50 p-3.5 text-xs">
              <div className="mb-2 font-medium text-foreground">参考物料清单：</div>
              <div className="flex flex-wrap gap-1.5">
                {preview.materials.map((m) => (
                  <span
                    key={m}
                    className="inline-flex items-center rounded-md border bg-card px-2.5 py-1 text-xs text-foreground/80"
                  >
                    {m}
                  </span>
                ))}
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                物料仅作布置参考，不会自动写入已确认物料或预算；主题与诉求可在开始策划时自由调整。
              </p>
            </div>
          )}
          {/* 底部并排下载：原始完整图片文件（原图/效果图各自 URL），非滑块截图 */}
          {preview && (
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void downloadImage(preview.before, `${preview.name}-原场地.png`)}
              >
                <Download className="h-4 w-4" />
                下载原图
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => void downloadImage(preview.after, `${preview.name}-布置效果图.png`)}
              >
                <Download className="h-4 w-4" />
                下载效果图
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
