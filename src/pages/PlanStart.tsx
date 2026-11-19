import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ImagePlus, Loader2, Send, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { AiAvatar } from '@/components/auth/Avatars';
import { PendingImageBar } from '@/components/shared/PendingImageBar';
import { usePendingImage } from '@/hooks/usePendingImage';
import { createProject, understandImage } from '@/services/api';
import { extractExplicitFacts } from '@/services/facts';
import { useAuth } from '@/contexts/AuthContext';
import type { ChatMessage, ProjectData } from '@/types/types';

/** 从自由输入检测活动类型：用户明确写出的类型词（不编造、不代用户确认） */
const detectTypeWords = (text: string): string[] => {
  if (!text) return [];
  const COMMON = ['年会', '生日', '团建', '婚礼', '发布会', '周年庆', '庆功宴', '表彰会'];
  const found = new Set<string>();
  for (const w of COMMON) if (text.includes(w)) found.add(w);
  const phrases = text.match(/[\u4e00-\u9fa5A-Za-z0-9]{2,10}(?:活动|聚会|派对|交换会|市集|晚宴)/g) ?? [];
  for (const p of phrases) {
    let body = p.replace(/(?:活动|聚会|派对|交换会|市集|晚宴)$/, '');
    body = body.replace(/^(?:这是|一个|我们的|我的)/, '').replace(/(?:的|之)$/, '');
    if (body.length >= 2) found.add(body);
  }
  return [...found];
};

const GREETING = '你好呀！我是小灵，可以陪你一起想活动方向、把想法整理成完整方案、排流程管预算、写邀请函文案，也能根据场地照片生成布置效果图～';

export default function PlanStart() {
  const navigate = useNavigate();
  const location = useLocation();
  const [params] = useSearchParams();
  const { ready, userId, waitForReady } = useAuth();
  const [desc, setDesc] = useState('');
  /* 可跳过的补充已知条件（未填写一律保持未确定） */
  const [showExtra, setShowExtra] = useState(false);
  const [headcount, setHeadcount] = useState('');
  const [budgetText, setBudgetText] = useState('');
  const [city, setCity] = useState('');
  const [dateText, setDateText] = useState('');
  const [creating, setCreating] = useState(false);
  /** 独立图像理解服务读取照片中（创建前置步骤） */
  const [visionWorking, setVisionWorking] = useState(false);
  /** 待携带的场地照片：统一四态状态机（本地即时预览 → 上传中 → 成功/失败可重试） */
  const venue = usePendingImage('venue');
  const fileRef = useRef<HTMLInputElement>(null);

  /* 预填：?desc= 或 location.state.desc（外部入口带想法进入，不重复欢迎） */
  useEffect(() => {
    const state = location.state as { desc?: string } | null;
    if (state?.desc) setDesc(state.desc);
    else if (params.get('desc')) setDesc(params.get('desc') ?? '');
  }, [location.state, params]);

  /* 补充已知信息组装：只保留用户明确给出的条件，未填不写、不把未定当已确认 */
  const guidedText = () => {
    const known: string[] = [];
    if (headcount.trim()) known.push(`人数约 ${headcount.trim()}`);
    if (budgetText.trim()) known.push(`预算约 ${budgetText.trim()}`);
    if (city.trim()) known.push(`城市：${city.trim()}`);
    if (dateText.trim()) known.push(`日期：${dateText.trim()}`);
    return known.length > 0 ? `已知信息：${known.join('，')}（未填写的均未确定）` : '';
  };
  const hasExtra = () => guidedText().length > 0;

  /* 上传中或失败都阻止提交：避免读到空串丢图，也避免以纯文字发送掩盖丢图 */
  const imgBlocking = !!venue.img && venue.img.status !== 'ok';
  /* 任意非空文字即可开始：短消息（如「hi」）也是有效输入，AI 会自然追问；
   * 完全空输入仍用「还没想好」入口 */
  const canStart = !creating && !imgBlocking && (desc.trim().length > 0 || !!venue.readyUrl || hasExtra());

  const start = async (extraHint?: string) => {
    if (creating || imgBlocking) return;
    /* 全空点「还没想好」：extraHint 本身是有效的未知回答，绕过输入量校验；普通「开始」仍按 canStart 门控 */
    if (!canStart && !extraHint) return;
    setCreating(true);
    try {
      /* 访客匿名会话建立中（1~3 秒）：自动等待而非立即报错——纯文字与带图一视同仁，
       * 不再让用户被迫"先传一张图"来等会话就绪 */
      if (!ready || !userId) {
        const ok = await waitForReady(15000);
        if (!ok || !userId) {
          toast.error('会话准备中，请稍候再试');
          setCreating(false);
          return;
        }
      }
      const imgurl = venue.readyUrl;
      const hasImg = !!imgurl;
      /* 补充条件与自由输入合并为同一份首轮消息：未填字段不写入、保持未确定 */
      const finalText = [guidedText(), desc.trim(), extraHint].filter(Boolean).join('\n');
      /* 自由描述中用户明确给出的条件程序化落地（20 人 / 预算 3000 元以内）；未定保持未知不擅定 */
      const facts = extractExplicitFacts(desc.trim());
      const text = finalText || (hasImg ? '这是我们的场地照片，想先看看布置建议' : '');
      if (!text) {
        setCreating(false);
        return;
      }
      /* 携图即真实看图：独立图像理解服务读取照片，失败则中止创建（不降级纯文字、不假装看过）；输入全部保留 */
      let vision: string | undefined;
      if (hasImg) {
        setVisionWorking(true);
        try {
          vision = await understandImage(imgurl!);
        } catch (e) {
          console.error(e);
          toast.error(e instanceof Error ? e.message : '看图失败，请重试');
          setCreating(false);
          return;
        } finally {
          setVisionWorking(false);
        }
      }
      /* 活动名：取用户描述自然短语（12 字内），不把引导语截断成标题 */
      const shortTitle = (() => {
        if (hasImg && !finalText) return '场地布置';
        const t = desc.trim();
        if (!t) return finalText.slice(0, 12);
        const cleaned = t.replace(/^(?:我想|我们想|想要?|准备|打算|帮(?:我|我们)|希望|这是)/, '').trim();
        return (cleaned.split(/[。！？\n，,]/)[0] || cleaned).slice(0, 12) || '新的活动';
      })();
      /* 小灵招呼语是窗口初始化时 AI 发的消息（不是用户消息）；用户消息只带真实输入，避免多余信息 */
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
        /* 引导字段与自由描述明确条件双通道写入（显式填写优先）；未填或未定的字段不写入 */
        requirements: {
          goal: finalText || '基于场地照片看看布置建议',
          ...(headcount.trim() || facts.headcount
            ? { headcount: { value: headcount.trim() || (facts.headcount as string), source: 'confirmed' as const } }
            : {}),
          ...(budgetText.trim() || facts.budgetLimit
            ? {
                budget: {
                  value: budgetText.trim() || `${(facts.budgetLimit as number).toLocaleString('zh-CN')} 元以内`,
                  source: 'confirmed' as const,
                },
              }
            : {}),
          ...(city.trim() ? { region: { value: city.trim(), source: 'confirmed' as const } } : {}),
          ...(dateText.trim() ? { date: { value: dateText.trim(), source: 'confirmed' as const } } : {}),
          /* 自由描述中的明确约束（不要个人上台/避免高体能等）进入其他需求 */
          ...(facts.otherNeeds ? { otherNeeds: facts.otherNeeds } : {}),
        },
        /* 预算硬上限：用户明确预算数字即程序写入，后续生成与预算页一致 */
        budget: facts.budgetLimit ? { limit: facts.budgetLimit, items: [] } : undefined,
        chatLog: text ? [greetMsg, firstMsg] : [greetMsg],
        intent: hasImg ? 'venue' : 'plan',
        ...(imgurl ? { scene: { beforeUrl: imgurl } } : {}),
      };
      const id = await createProject(shortTitle, payload);
      toast.success('项目已创建，开始共同策划');
      /* 标记新建进入：工作台首条消息允许 AI 自动回应（仅一次，刷新/重开不自动） */
      sessionStorage.setItem('sf-fresh-workbench', id);
      /* 直通数据：刚写入的项目免二次网络读取，进入工作区即渲染（一次性，读取后即删） */
      try {
        sessionStorage.setItem('sf-fresh-data', JSON.stringify({ id, title: shortTitle, data: payload }));
      } catch {
        /* 存储满等异常时退回正常加载路径，不影响创建 */
      }
      navigate(`/workbench/${id}`);
    } catch (e) {
      console.error(e);
      toast.error('创建失败，输入已保留，请重试');
      setCreating(false);
    }
  };

  return (
    <div className="sf-page-body mx-auto flex w-full max-w-4xl flex-col items-center px-4 py-12 md:px-8 md:py-20">
      <div className="sf-deco" aria-hidden="true">
        <span className="sf-blob sf-paper-purple-faint" style={{top: '4%', left: '-14%', width: '24vw', height: '24vw', minWidth: 200, minHeight: 200}} />
        <span className="sf-blob sf-paper-cream-faint" style={{top: '12%', right: '-14%', width: '20vw', height: '20vw', minWidth: 160, minHeight: 160}} />
      </div>
      <span className="mb-5 inline-flex items-center gap-1.5 rounded-full border bg-card px-3 py-1 text-xs font-medium text-muted-foreground shadow-sm">
        <Sparkles className="h-3.5 w-3.5 text-primary" />
        无需注册 · 直接开始
      </span>

      <h1 className="mb-4 text-center text-3xl font-bold tracking-tight text-balance md:text-4xl">
        我们一起，把想法
        <br />
        变成<span className="gradient-text">一场活动</span>
      </h1>
      <p className="mb-10 max-w-xl text-center text-pretty text-sm leading-relaxed text-muted-foreground md:text-base">
        你准备办什么活动？还没想好也可以——从一个模糊的想法开始就好。
      </p>

      {/* 主输入卡：短欢迎 + 一处描述输入 + 照片附件 + 可跳过的补充条件（首屏内可见核心输入） */}
      <div className="w-full rounded-2xl border bg-card p-4 shadow-lg md:p-5">
        <div className="flex items-start gap-3">
          <AiAvatar className="h-9 w-9 shrink-0" />
          <p className="text-sm leading-relaxed text-foreground/90">
            我是你的 AI 策划伙伴，说说你的想法，我们边聊边把它变成完整的活动方案。
          </p>
        </div>

        <div className="mt-4">
          <Textarea
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
            placeholder="描述你的活动想法，比如：下个月想给团队办一场轻松的团建，大概 20 人…"
            className="min-h-32 resize-none border-0 p-2 text-base shadow-none focus-visible:ring-0"
          />
        </div>

        {/* 待发送照片：四态预览（本地即时缩略图 / 上传中 / 成功 / 失败重试） */}
        {venue.img && (
          <div className="mt-2">
            <PendingImageBar
              img={venue.img}
              onRetry={venue.retry}
              onRemove={venue.clear}
              okHint="照片已就绪，将随第一条消息发送给 AI"
            />
          </div>
        )}

        <div className="mt-2 flex flex-wrap items-center justify-between gap-3 border-t pt-3">
          <div className="flex flex-wrap items-center gap-2">
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                void venue.pick(f);
              }}
            />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={venue.busy}
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            >
              {venue.busy ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ImagePlus className="h-3.5 w-3.5" />
              )}
              {venue.img ? '更换场地照片' : '上传场地照片（可选）'}
            </button>
            <button
              type="button"
              onClick={() => setShowExtra((v) => !v)}
              className="inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            >
              {showExtra ? '收起补充信息' : '补充已知信息（选填）'}
            </button>
          </div>
          <Button
            onClick={() => void start()}
            disabled={!canStart}
            className="h-11 w-full rounded-xl px-6 sm:w-auto"
          >
            {creating ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {creating ? '正在创建活动…' : venue.busy ? '图片上传中…' : visionWorking ? 'AI 正在看图…' : !ready ? '会话准备中…' : '开始共同策划'}
          </Button>
        </div>

        {/* 可跳过的补充条件：未填一律保持未确定，不代用户确认 */}
        {showExtra && (
          <div className="mt-3 grid gap-2 border-t pt-3 md:grid-cols-2">
            <Input
              value={headcount}
              onChange={(e) => setHeadcount(e.target.value)}
              maxLength={12}
              placeholder="人数（未定可不填）"
            />
            <Input
              value={budgetText}
              onChange={(e) => setBudgetText(e.target.value)}
              maxLength={12}
              placeholder="预算（未定可不填）"
            />
            <Input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              maxLength={12}
              placeholder="城市（可选）"
            />
            <Input
              value={dateText}
              onChange={(e) => setDateText(e.target.value)}
              maxLength={12}
              placeholder="日期（可选）"
            />
          </div>
        )}
      </div>

      {/* 还没想好入口：同样有效，AI 不会催促，可带想法进入直接聊 */}
      <div className="mt-4 flex w-full flex-col items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() =>
            void start(
              hasExtra() || desc.trim() || venue.readyUrl
                ? undefined
                : '我还没想好，先给我一些不同活动方向的建议'
            )
          }
          disabled={creating || imgBlocking}
        >
          <Sparkles className="h-4 w-4" />
          还没想好？先给我一些方向
        </Button>
        <p className="max-w-md text-balance text-center text-xs leading-relaxed text-muted-foreground">
          「还没想好」也是有效的起点，AI 会陪你一步步把想法补全。
        </p>
      </div>
    </div>
  );
}
