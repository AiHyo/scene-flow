import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { ArrowRight, ChevronDown, ChevronRight, Lightbulb, Sparkles, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import CompareCanvas from '@/components/scene/CompareCanvas';
import { showcase } from '@/data/showcase';
import { cn } from '@/lib/utils';

gsap.registerPlugin(ScrollTrigger, useGSAP);

/**
 * 首页四幕文字舞台 · 动态文字海报方向：
 * 统一字体体系（主标题 Zhi Mang Xing 几何感标题体 + 正文 Noto Sans SC），
 * 靠大小 / 字重 / 错位排版 / 运动形成设计感，不靠换字体。
 * ① 首幕：主标题两行中部偏左 + 活动词紧凑主视觉中部偏右（约 75–85% 舞台宽），
 *    5s 自动开场（品牌揭示 → 标题落位 → 活动词交错进入 → 一次尺度收束），遮罩揭示、整词组运动；
 * ② 困扰：中心问题建立，痛点紧凑三层围绕（不围边缘一圈），预算只是其中一个问题；
 * ③ 共策：对话 / 候选 / 调整成为舞台主体（放大展示尺度），重点放大正在发生的选择；
 * ④ 看见效果：同场地前后拖拽对比 + 循环关系 + 行动入口 + 页脚。
 * 跨幕连续衔接（旧主体收拢让位、新主体及时接住），无空滚动死区；反向连续还原；Logo 返回第一幕。
 * 后续面板以 yPercent 滑入覆盖前一幕；移动端 / 减弱动效为静态堆叠。
 */
export default function ScrollShowcase() {
  const sectionRef = useRef<HTMLElement>(null);
  const [activeAct, setActiveAct] = useState(0);
  const introRef = useRef<gsap.core.Timeline | null>(null);

  /* ===== 幕4 自动演示对比状态 ===== */
  const [comparePos, setComparePos] = useState(50);
  const comparePosRef = useRef(50);
  comparePosRef.current = comparePos;

  const autoDemoStartedRef = useRef(false);
  const autoDemoDoneRef = useRef(false);
  const userInteractedRef = useRef(false);
  const autoDemoTweenRef = useRef<gsap.core.Timeline | null>(null);
  const stayTimerRef = useRef<number | null>(null);
  const act4InViewRef = useRef(false);
  const act4ImgsLoadedRef = useRef(false);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);

  const isReducedMotion = useCallback(() => {
    return (
      typeof window !== 'undefined' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }, []);

  /** 用户手动操作（拖拽/点击/键盘）时立即取消动画并交还控制，保持当时比例，不再重播 */
  const interruptAutoDemo = useCallback(() => {
    userInteractedRef.current = true;
    autoDemoDoneRef.current = true;
    if (stayTimerRef.current) {
      window.clearTimeout(stayTimerRef.current);
      stayTimerRef.current = null;
    }
    if (autoDemoTweenRef.current) {
      autoDemoTweenRef.current.kill();
      autoDemoTweenRef.current = null;
    }
  }, []);

  /** 离开第四幕时停止并保持当时比例，回来不重播 */
  const handleLeaveAct4 = useCallback(() => {
    if (stayTimerRef.current) {
      window.clearTimeout(stayTimerRef.current);
      stayTimerRef.current = null;
    }
    if (autoDemoTweenRef.current && autoDemoTweenRef.current.isActive()) {
      autoDemoTweenRef.current.kill();
      autoDemoTweenRef.current = null;
      autoDemoDoneRef.current = true;
    }
    act4InViewRef.current = false;
  }, []);

  /** 尝试启动幕4自动演示（满足：在可视区、切幕基本结束、图片加载完成、未播过、未手动干预） */
  const tryStartAct4Demo = useCallback(() => {
    if (
      autoDemoStartedRef.current ||
      autoDemoDoneRef.current ||
      userInteractedRef.current
    ) {
      return;
    }
    if (!act4InViewRef.current || !act4ImgsLoadedRef.current) {
      return;
    }
    if (isReducedMotion()) {
      autoDemoDoneRef.current = true;
      return;
    }

    autoDemoStartedRef.current = true;

    // 停留约 0.4 秒后平滑演示
    stayTimerRef.current = window.setTimeout(() => {
      if (userInteractedRef.current || autoDemoDoneRef.current) return;

      const proxy = { pos: comparePosRef.current };
      // 50% -> 30% (0.8s) -> 70% (1.1s) -> 50% (0.8s)，总时长约 2.7 秒，平滑舒缓
      const tl = gsap.timeline({
        onComplete: () => {
          setComparePos(50);
          comparePosRef.current = 50;
          autoDemoDoneRef.current = true;
          autoDemoTweenRef.current = null;
        },
      });
      autoDemoTweenRef.current = tl;

      tl.to(proxy, {
        pos: 30,
        duration: 0.8,
        ease: 'power2.inOut',
        onUpdate: () => {
          setComparePos(proxy.pos);
          comparePosRef.current = proxy.pos;
        },
      })
        .to(proxy, {
          pos: 70,
          duration: 1.1,
          ease: 'power2.inOut',
          onUpdate: () => {
            setComparePos(proxy.pos);
            comparePosRef.current = proxy.pos;
          },
        })
        .to(proxy, {
          pos: 50,
          duration: 0.8,
          ease: 'power2.inOut',
          onUpdate: () => {
            setComparePos(proxy.pos);
            comparePosRef.current = proxy.pos;
          },
        });
    }, 400);
  }, [isReducedMotion]);

  // 组件卸载时清理动画与定时器
  useEffect(() => {
    return () => {
      if (stayTimerRef.current) {
        window.clearTimeout(stayTimerRef.current);
      }
      if (autoDemoTweenRef.current) {
        autoDemoTweenRef.current.kill();
      }
    };
  }, []);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();

      mm.add('(min-width: 768px) and (prefers-reduced-motion: no-preference)', () => {
        /* ===== 初始状态：全部就位到入场起点（遮罩线 yPercent 115） ===== */
        gsap.set('.sf-panel-2, .sf-panel-3, .sf-panel-4', { yPercent: 100 });
        gsap.set(['.sf-brand', '.sf-line-a', '.sf-line-b'], { yPercent: 115 });
        gsap.set('.sf-sub', { autoAlpha: 0, y: 16 });
        gsap.set('.sf-hint', { autoAlpha: 0, y: 10 });
        /* 活动词：整词组从左右两侧位移入场，零旋转（中文字形不变形） */
        showcase.intro.words.forEach((w, i) => {
          const dir = i % 2 === 0 ? 1 : -1;
          gsap.set(`.sf-word-${i}`, {
            x: dir * (60 + i * 12),
            y: 36 + i * 6,
            scale: 0.92,
            autoAlpha: 0,
          });
        });
        gsap.set('.sf-prep', { autoAlpha: 0, y: 12 });
        gsap.set('.sf-q-line', { yPercent: 115 });
        gsap.set('.sf-q-bar', { scaleX: 0 });
        showcase.act2.pains.forEach((p, i) => {
          gsap.set(`.sf-pain-${i}`, { y: 28, autoAlpha: 0, rotation: 0 });
        });
        gsap.set(['.sf-core', '.sf-aux'], { autoAlpha: 0, y: 20 });
        gsap.set(['.sf-conv-user1', '.sf-conv-user2', '.sf-conv-ai-lead', '.sf-conv-adjust'], { autoAlpha: 0, y: 26 });
        gsap.set('.sf-conv-dir', { autoAlpha: 0, y: 26 });
        gsap.set('.sf-conv-badge', { autoAlpha: 0, scale: 0.6 });
        gsap.set('.sf-conv-row', { autoAlpha: 0, y: 16 });
        gsap.set(['.sf-final-title', '.sf-final-canvas', '.sf-final-aux', '.sf-final-added', '.sf-final-cycle', '.sf-final-cta'], { autoAlpha: 0, y: 22 });
        gsap.set('.sf-final-footer', { autoAlpha: 0 });

        /* ===== ① 自动开场（约 5s：第 1s 已有主视觉 → 标题落位 → 活动词交错 → 一次尺度收束） ===== */
        const intro = gsap.timeline();
        introRef.current = intro;
        intro
          .to('.sf-brand', { yPercent: 0, duration: 0.6, ease: 'power4.out' }, 0.05)
          .to('.sf-line-a', { yPercent: 0, duration: 0.9, ease: 'power4.out' }, 0.35)
          .to('.sf-line-b', { yPercent: 0, duration: 0.85, ease: 'power4.out' }, 0.6)
          .to('.sf-sub', { autoAlpha: 1, y: 0, duration: 0.55, ease: 'power3.out' }, 1.05)
          /* 活动词交错进入（整词组，不逐字），零旋转保证字形清晰 */
          .to(
            '.sf-word',
            { x: 0, y: 0, scale: 1, autoAlpha: 1, duration: 1.0, stagger: 0.075, ease: 'power4.out' },
            1.15
          )
          /* 筹备事项补入第三层级 */
          .to('.sf-prep', { autoAlpha: 1, y: 0, duration: 0.35, stagger: 0.06, ease: 'power3.out' }, 2.75)
          /* 一次尺度收束：主视觉整体微放大后落定，形成节拍 */
          .to('.sf-words', { scale: 1.04, duration: 0.3, ease: 'power2.inOut' }, 3.1)
          .to('.sf-words', { scale: 1, duration: 0.35, ease: 'power2.inOut' }, 3.4)
          .to('.sf-hint', { autoAlpha: 1, y: 0, duration: 0.4, ease: 'power3.out' }, 3.55)
          .to({}, { duration: 0.45 });

        /* ===== 滚动 scrub：面板滑入覆盖 + 幕内序列；反向按同一时间轴回退 ===== */
        const tl = gsap.timeline({
          scrollTrigger: {
            trigger: sectionRef.current,
            start: 'top top',
            end: '+=3000',
            scrub: 1,
            pin: true,
            anticipatePin: 1,
            onUpdate: (self) => {
              const p = self.progress;
              const nextAct = p < 0.17 ? 0 : p < 0.52 ? 1 : p < 0.86 ? 2 : 3;
              setActiveAct(nextAct);

              /* 第4幕切幕基本结束 (p >= 0.94)：启动停留 0.4s 后的平滑对比演示 */
              if (p >= 0.94) {
                if (!act4InViewRef.current) {
                  act4InViewRef.current = true;
                  tryStartAct4Demo();
                }
              } else {
                if (act4InViewRef.current) {
                  handleLeaveAct4();
                }
              }

              /* 滚动打断开场：直追完成态，scrub 从同一构图接续；开场与滚动不抢同一元素状态 */
              if (self.scroll() > 4 && introRef.current && introRef.current.progress() < 1) {
                introRef.current.progress(1);
              }
            },
          },
        });

        /* 幕1 → 幕2：少量主要活动词收拢让位，中心问题随即建立（旧标题先退场、不剩残字） */
        tl.to('.sf-hint', { autoAlpha: 0, duration: 0.03 }, 0.02)
          .to(['.sf-a1-top', '.sf-sub'], { y: -60, autoAlpha: 0, duration: 0.07, ease: 'power2.in' }, 0.03)
          /* 主要活动词向中部收拢、让位 */
          .to('.sf-word-major', { x: 0, y: -30, autoAlpha: 0, duration: 0.1, stagger: 0.02, ease: 'power2.in' }, 0.05)
          .to('.sf-word-aux', { autoAlpha: 0, duration: 0.06, stagger: 0.015 }, 0.06)
          .to('.sf-panel-2', { yPercent: 0, duration: 0.2, ease: 'power2.inOut' }, 0.1)
          /* 幕2 内部：中心问题建立 → 痛点自上下聚合（紧凑围绕，不围边缘）→ 结论落定 */
          .to('.sf-q-line', { yPercent: 0, duration: 0.1, ease: 'power4.out' }, 0.19)
          .to('.sf-q-bar', { scaleX: 1, duration: 0.07, ease: 'power3.inOut' }, 0.26)
          .to('.sf-pain', { autoAlpha: 1, y: 0, duration: 0.12, stagger: 0.016, ease: 'power3.out' }, 0.21)
          .to('.sf-core', { autoAlpha: 1, y: 0, duration: 0.06 }, 0.375)
          .to('.sf-aux', { autoAlpha: 1, y: 0, duration: 0.05 }, 0.405)
          /* 幕2 → 幕3：幕2 收拢让位 */
          .to('.sf-panel-2 .sf-inner', { yPercent: -14, autoAlpha: 0.2, duration: 0.1, ease: 'power2.in' }, 0.46)
          .to('.sf-panel-3', { yPercent: 0, duration: 0.2, ease: 'power2.inOut' }, 0.5)
          /* 幕3 分阶段：① 用户一问 → ② AI 方向与候选 → ③ 用户选择与调整成果（重点放大正在发生的选择） */
          .to('.sf-conv-user1', { autoAlpha: 1, y: 0, duration: 0.06, ease: 'power3.out' }, 0.53)
          .to('.sf-conv-ai-lead', { autoAlpha: 1, y: 0, duration: 0.05, ease: 'power3.out' }, 0.615)
          .to('.sf-conv-dir', { autoAlpha: 1, y: 0, duration: 0.055, stagger: 0.02, ease: 'power3.out' }, 0.635)
          .to('.sf-conv-user2', { autoAlpha: 1, y: 0, duration: 0.06, ease: 'power3.out' }, 0.72)
          .to('.sf-conv-badge', { autoAlpha: 1, scale: 1, duration: 0.04, ease: 'back.out(2)' }, 0.755)
          .to('.sf-conv-dim', { autoAlpha: 0.45, duration: 0.045 }, 0.755)
          .to('.sf-conv-adjust', { autoAlpha: 1, y: 0, duration: 0.055, ease: 'power3.out' }, 0.79)
          .to('.sf-conv-row', { autoAlpha: 1, y: 0, duration: 0.045, stagger: 0.014 }, 0.815)
          /* 幕3 → 幕4：幕3 收拢让位 */
          .to('.sf-panel-3 .sf-inner', { yPercent: -14, autoAlpha: 0.2, duration: 0.1, ease: 'power2.in' }, 0.865)
          .to('.sf-panel-4', { yPercent: 0, duration: 0.2, ease: 'power2.inOut' }, 0.88)
          /* 幕4 收尾：主体与署名同屏 */
          .to('.sf-final-title', { autoAlpha: 1, y: 0, duration: 0.045 }, 0.925)
          .to('.sf-final-canvas', { autoAlpha: 1, y: 0, duration: 0.05 }, 0.935)
          .to('.sf-final-aux', { autoAlpha: 1, y: 0, duration: 0.035 }, 0.95)
          .to('.sf-final-added', { autoAlpha: 1, y: 0, duration: 0.035 }, 0.957)
          .to('.sf-final-cycle', { autoAlpha: 1, y: 0, duration: 0.035 }, 0.96)
          .to('.sf-final-cta', { autoAlpha: 1, y: 0, duration: 0.04 }, 0.97)
          .to('.sf-final-footer', { autoAlpha: 1, duration: 0.03 }, 0.985);

        return () => {
          intro.kill();
          introRef.current = null;
          tl.scrollTrigger?.kill();
          tl.kill();
        };
      });
      /* 移动端 / 减弱动效：CSS 默认静态堆叠，无 GSAP 干预 */
    },
    { scope: sectionRef }
  );

  /* 移动端 / 静态堆叠视口监听：进入主要可视区域启动演示，离开停止 */
  useEffect(() => {
    const isMobileOrReduced =
      window.innerWidth < 768 ||
      window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (!isMobileOrReduced) return;

    const panel = sectionRef.current?.querySelector('.sf-panel-4');
    if (!panel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && entry.intersectionRatio >= 0.5) {
            act4InViewRef.current = true;
            tryStartAct4Demo();
          } else if (!entry.isIntersecting) {
            if (act4InViewRef.current) {
              handleLeaveAct4();
            }
          }
        });
      },
      { threshold: [0.1, 0.5] }
    );
    observer.observe(panel);
    return () => {
      observer.disconnect();
    };
  }, [tryStartAct4Demo, handleLeaveAct4]);

  return (
    <section ref={sectionRef} className="relative w-full overflow-x-clip bg-background">
      {/* ===== 幕1 活动文字舞台 · 动态文字海报 ===== */}
      <div className="sf-panel-1 relative flex min-h-[92dvh] w-full flex-col overflow-hidden px-5 pb-16 pt-20 md:motion-safe:min-h-[100dvh] md:motion-safe:px-0 md:motion-safe:pb-0 md:motion-safe:pt-0">
        {/* 「轻盈创意纸面」静态边缘装饰（v108）：仅角落大块纸片/柔和弧形，避开中部标题与右侧活动词，不动 GSAP 时间轴 */}
        <div className="sf-deco" aria-hidden="true">
          <span className="sf-blob sf-paper-cream" style={{ top: '-12%', left: '-10%', width: '42vw', height: '42vw', minWidth: 320, minHeight: 320 }} />
          <span className="sf-blob sf-paper-purple" style={{ bottom: '-18%', right: '-12%', width: '46vw', height: '46vw', minWidth: 360, minHeight: 360 }} />
        </div>
        {/* 舞台中部偏左：SceneFlow AI + 两行主标题 + 说明文案（紧凑组合，唯一第一视觉层级） */}
        <div className="sf-a1-top md:motion-safe:absolute md:motion-safe:left-[8vw] md:motion-safe:top-1/2 md:motion-safe:w-[38vw] md:motion-safe:max-w-[560px] md:motion-safe:-translate-y-[54%]">
          <div className="overflow-hidden">
            <div className="sf-brand flex items-center gap-2.5">
              <Sparkles className="h-5 w-5 shrink-0 text-primary md:h-6 md:w-6" />
              <span className="gradient-text font-display text-xl font-bold md:text-2xl">{showcase.intro.brand}</span>
              <span className="rounded-full border border-primary/30 bg-primary/5 px-3 py-1 text-xs font-medium text-primary md:text-sm">
                {showcase.intro.brandTag}
              </span>
            </div>
          </div>
          <h1 className="mt-4 md:mt-5">
            <span className="block overflow-hidden">
              <span className="sf-line sf-line-a font-display block text-[15vw] font-black leading-[1.04] tracking-tight text-foreground md:motion-safe:text-[5.6vw] xl:motion-safe:text-[6.2rem]">
                {showcase.intro.lineA}
              </span>
            </span>
            <span className="block overflow-hidden md:motion-safe:pl-[2.5vw]">
              <span className="sf-line sf-line-b font-display block text-[15vw] font-black leading-[1.04] tracking-tight text-primary md:motion-safe:text-[5.6vw] xl:motion-safe:text-[6.2rem]">
                {showcase.intro.lineB}
              </span>
            </span>
          </h1>
          <p className="sf-sub mt-4 max-w-md text-base leading-relaxed text-muted-foreground md:mt-5 md:text-lg">{showcase.intro.sub}</p>
        </div>

        {/* 舞台中部偏右：活动词群主视觉（48vw–92vw，与标题区共占约八成舞台宽，纵向 72vh 展开）。
            全部词绝对定位、零旋转，坐标经重叠校验；主要层级错位大字 + 一处色块，筹备事项小字补空隙 */}
        <div className="sf-words relative mt-8 flex flex-wrap items-baseline gap-x-6 gap-y-4 md:motion-safe:absolute md:motion-safe:left-[48vw] md:motion-safe:top-1/2 md:motion-safe:mt-0 md:motion-safe:block md:motion-safe:h-[72vh] md:motion-safe:w-[44vw] md:motion-safe:-translate-y-1/2">
          {showcase.intro.words.map((w, i) => (
            <div
              key={w.t}
              className={cn(
                'sf-word-mask flex items-baseline md:motion-safe:absolute md:motion-safe:overflow-hidden',
                w.tier === 'major' ? 'sf-word-major' : 'sf-word-aux'
              )}
              style={w.pos}
            >
              <span
                className={cn(
                  'sf-word inline-block leading-[1.08]',
                  `sf-word-${i}`,
                  w.size,
                  /* 风格：一处主色块强调；其余按字重 / 颜色分层，全部清晰可读，无描边无旋转 */
                  w.style === 'block' &&
                    'rounded-lg bg-primary px-3.5 pb-1.5 pt-1 font-display font-black tracking-tight text-primary-foreground shadow-2xl',
                  w.style === 'bold' && 'font-display font-black tracking-tight text-foreground',
                  w.style === 'accent' && 'font-display font-bold tracking-tight text-chart-5',
                  w.style === 'muted' && 'font-display font-semibold tracking-tight text-muted-foreground'
                )}
              >
                {w.t}
              </span>
            </div>
          ))}
          {/* 筹备事项：小方块 + 小字，补充第三层级构图 */}
          {showcase.intro.preps.map((pr) => (
            <span
              key={pr.t}
              className="sf-prep inline-flex items-center gap-2 text-sm text-muted-foreground md:motion-safe:absolute md:text-base"
              style={pr.pos}
            >
              <span className="h-2 w-2 shrink-0 rounded-[2px] bg-chart-5/70" />
              {pr.t}
            </span>
          ))}
        </div>

        {/* 滚动引导（首屏内完整可见） */}
        <div className="sf-hint mt-auto flex justify-center md:motion-safe:absolute md:motion-safe:bottom-7 md:motion-safe:left-1/2 md:motion-safe:mt-0 md:motion-safe:-translate-x-1/2">
          <span className="flex items-center gap-2 rounded-full border bg-card/90 px-5 py-2.5 text-sm font-medium text-foreground/80 shadow-sm backdrop-blur md:text-base">
            {showcase.intro.scrollHint}
            <ChevronDown className="h-4 w-4 animate-bounce text-primary" />
          </span>
        </div>
      </div>

      {/* ===== 幕2 困扰聚合 · 围绕中心问题的紧凑三层 ===== */}
      <div className="sf-panel-2 relative w-full bg-background px-5 py-16 md:motion-safe:absolute md:motion-safe:inset-0 md:motion-safe:overflow-hidden md:motion-safe:py-0 md:motion-safe:will-change-transform">
        <div className="sf-inner relative flex min-h-[80dvh] w-full flex-col items-center md:motion-safe:h-full md:motion-safe:min-h-0 md:motion-safe:justify-center">
          {/* 中心问题（主体）：问题 → 观点 → 辅助说明，成块居中，观点清楚可见不作脚注 */}
          <div className="relative z-10 flex flex-col items-center px-4 text-center">
            <div className="overflow-hidden">
              <h2 className="sf-q-line font-display text-4xl font-black leading-tight tracking-tight text-foreground md:text-7xl">
                {showcase.act2.center}
              </h2>
            </div>
            <span className="sf-q-bar mx-auto mt-5 block h-1.5 w-24 origin-center rounded-full bg-chart-5 md:w-32" />
            <p className="sf-core mt-8 font-display text-2xl font-bold leading-relaxed tracking-tight text-primary md:text-4xl">
              {showcase.act2.core}
            </p>
            <p className="sf-aux mt-3 max-w-md text-base text-muted-foreground md:text-lg">{showcase.act2.aux}</p>
          </div>

          {/* 痛点：上/两侧/下三区围绕中心，紧凑有疏密（不围屏幕四边一圈，预算只是其中一个） */}
          <div className="sf-pains relative mt-8 flex w-full flex-wrap justify-center gap-x-5 gap-y-3 md:motion-safe:absolute md:motion-safe:inset-0 md:motion-safe:mt-0 md:motion-safe:block">
            {showcase.act2.pains.map((p, i) => (
              <span
                key={p.t}
                className={cn(
                  'sf-pain inline-flex items-center gap-2 font-display tracking-tight md:motion-safe:absolute',
                  `sf-pain-${i}`,
                  p.size,
                  p.tone === 'light' && 'font-medium text-muted-foreground',
                  p.tone === 'mid' && 'font-bold text-foreground',
                  p.tone === 'accent' && 'font-black text-primary',
                  p.tone === 'heavy' && 'font-black text-foreground'
                )}
                style={{ ...p.pos, transform: p.pos.tx ? `translateX(${p.pos.tx})` : undefined }}
              >
                <span className={cn('h-2 w-2 shrink-0 rounded-[2px]', p.tone === 'accent' ? 'bg-primary' : 'bg-chart-5/80')} />
                {p.t}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ===== 幕3 共策过程 · 对话/候选/调整成为舞台主体 ===== */}
      <div className="sf-panel-3 relative w-full bg-background px-5 py-16 md:motion-safe:absolute md:motion-safe:inset-0 md:motion-safe:overflow-hidden md:motion-safe:py-0 md:motion-safe:will-change-transform">
        <div className="sf-inner mx-auto flex min-h-[80dvh] w-full max-w-4xl flex-col justify-center gap-4 md:motion-safe:h-full md:motion-safe:min-h-0 md:motion-safe:gap-6 md:motion-safe:px-10">
          {/* 用户诉求（第二幕的一个问题自然进入用户诉求） */}
          <div className="sf-conv-user1 flex justify-end">
            <div className="max-w-[82%] rounded-2xl rounded-br-md border border-primary/30 bg-primary/10 px-5 py-4 md:px-6 md:py-5">
              <p className="text-[11px] font-medium text-primary md:text-xs">你</p>
              <p className="mt-1 text-xl leading-relaxed text-foreground md:text-3xl">{showcase.act3.user1}</p>
            </div>
          </div>

          {/* AI 建议方向（舞台主体：三个方向并排，选中点亮） */}
          <div className="flex flex-col gap-3">
            <p className="sf-conv-ai-lead flex items-center gap-2 text-sm font-medium text-muted-foreground md:text-lg">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
              {showcase.act3.aiLead}
            </p>
            <div className="grid gap-3 md:grid-cols-3 md:gap-4">
              {showcase.act3.directions.map((d, i) => (
                <div
                  key={d.name}
                  className={cn(
                    'sf-conv-dir relative rounded-2xl border bg-card p-5 shadow-sm md:p-6',
                    i === showcase.act3.pickIndex ? 'border-primary/60 shadow-md' : 'sf-conv-dim'
                  )}
                >
                  <p className="font-display text-xl font-bold tracking-tight text-foreground md:text-2xl">{d.name}</p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground md:text-base">{d.desc}</p>
                  {i === showcase.act3.pickIndex && (
                    <span className="sf-conv-badge absolute -top-2.5 right-3 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-semibold text-primary-foreground shadow-md">
                      {showcase.act3.pickLabel}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* 用户选择与补充 */}
          <div className="sf-conv-user2 flex justify-end">
            <div className="max-w-[82%] rounded-2xl rounded-br-md border border-primary/30 bg-primary/10 px-5 py-4 md:px-6 md:py-5">
              <p className="text-[11px] font-medium text-primary md:text-xs">你</p>
              <p className="mt-1 text-xl leading-relaxed text-foreground md:text-3xl">{showcase.act3.user2}</p>
            </div>
          </div>

          {/* 调整后的安排（选中方向的成果，收拢为紧凑上下文） */}
          <div className="sf-conv-adjust rounded-2xl border bg-card p-5 shadow-sm md:p-6">
            <p className="text-base font-semibold text-foreground md:text-lg">{showcase.act3.adjustTitle}</p>
            <div className="mt-3 grid gap-x-6 gap-y-2 md:grid-cols-2">
              {showcase.act3.schedule.map((r) => (
                <div key={r.time} className="sf-conv-row flex items-baseline gap-2.5">
                  <span className="shrink-0 rounded-md bg-secondary px-2 py-0.5 text-xs font-medium text-secondary-foreground">
                    {r.time}
                  </span>
                  <span className="min-w-0 text-sm leading-relaxed text-foreground/90 md:text-base">{r.text}</span>
                </div>
              ))}
              {showcase.act3.materials.map((m) => (
                <div key={m} className="sf-conv-row flex items-baseline gap-2.5">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-[2px] bg-chart-5/80" />
                  <span className="min-w-0 text-sm leading-relaxed text-foreground/90 md:text-base">{m}</span>
                </div>
              ))}
            </div>
            <p className="sf-conv-row mt-1 text-[10px] text-muted-foreground/70">{showcase.act3.demoNote}</p>
          </div>
        </div>
      </div>

      {/* ===== 幕4 看见效果 + 收尾 · 对比图与标题形成有力量构图 ===== */}
      <div className="sf-panel-4 relative flex w-full flex-col items-center gap-3 bg-background px-5 py-14 md:motion-safe:absolute md:motion-safe:inset-0 md:motion-safe:justify-center md:motion-safe:gap-3.5 md:motion-safe:overflow-hidden md:motion-safe:py-6 md:motion-safe:will-change-transform">
        <h2 className="sf-final-title max-w-xl px-4 text-center font-display text-2xl font-black leading-[1.3] tracking-tight text-balance text-foreground md:text-4xl">
          {showcase.act4Copy.title}
        </h2>
        <CompareCanvas
          beforeUrl={showcase.act4.beforeUrl}
          afterUrl={showcase.act4.afterUrl}
          interactive
          pos={comparePos}
          onPosChange={(next) => {
            setComparePos(next);
            comparePosRef.current = next;
          }}
          onUserInteract={() => {
            interruptAutoDemo();
          }}
          onImagesLoaded={() => {
            act4ImgsLoadedRef.current = true;
            tryStartAct4Demo();
          }}
          className="sf-final-canvas aspect-[3/2] w-full max-w-4xl rounded-2xl shadow-2xl md:h-[min(48vh,480px)] md:w-auto"
          labels={['布置前', '布置后']}
        />
        {/* 新增布置：紧凑清单（不挤小对比图、不溢出整幕） */}
        <div className="sf-final-added flex w-full max-w-4xl flex-wrap items-center justify-center gap-1.5 px-4">
          <span className="text-sm font-medium text-foreground/75 md:text-base">新增布置：</span>
          {showcase.act4.added.map((a) => (
            <span key={a} className="rounded-full border bg-card px-2.5 py-1 text-xs text-muted-foreground md:text-sm">
              {a}
            </span>
          ))}
        </div>
        <p className="sf-final-aux max-w-xl px-4 text-center text-pretty text-sm leading-relaxed text-muted-foreground md:text-base">
          {showcase.act4Copy.aux}
        </p>
        <div className="sf-final-cycle flex flex-wrap items-center justify-center gap-1.5 md:gap-2">
          {showcase.act4Copy.cycle.map((c, i) => (
            <span key={`${c}-${i}`} className="contents">
              {i > 0 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/60" />}
              <span
                className={cn(
                  'rounded-full border px-3 py-1 text-xs font-medium md:text-sm',
                  i === showcase.act4Copy.activeCycle
                    ? 'border-primary bg-primary text-primary-foreground shadow-sm'
                    : 'border-border bg-card text-muted-foreground'
                )}
              >
                {c}
              </span>
            </span>
          ))}
        </div>
        <div className="sf-final-cta flex flex-col items-center gap-3 sm:flex-row">
          <Button asChild size="lg" className="h-12 rounded-full px-8 text-base shadow-xl">
            <Link to="/plan">
              <Wand2 className="h-5 w-5" />
              {showcase.act4Copy.cta.primary}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild variant="ghost" className="rounded-full border border-primary/30 text-primary hover:bg-primary/10">
            <Link to="/inspiration">
              <Lightbulb className="h-4 w-4" />
              {showcase.act4Copy.cta.secondary}
            </Link>
          </Button>
        </div>

        {/* 收尾署名：并入末幕底部，与主内容同屏呈现 */}
        <div className="sf-final-footer mt-3 flex w-full flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t px-4 pt-3 md:motion-safe:absolute md:motion-safe:bottom-0 md:motion-safe:left-0 md:motion-safe:mt-0 md:motion-safe:bg-background/95 md:motion-safe:py-3">
          <span className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span className="gradient-text text-xs font-bold md:text-sm">SceneFlow AI</span>
          </span>
          <span className="text-xs text-muted-foreground md:text-sm">{showcase.act4Copy.footer}</span>
        </div>
      </div>

      {/* ===== 桌面叠加控件：幕进度点 ===== */}
      <div className="absolute right-4 top-1/2 z-20 hidden -translate-y-1/2 flex-col gap-2.5 md:motion-safe:flex">
        {[0, 1, 2, 3].map((i) => (
          <span
            key={i}
            className={cn(
              'h-2 w-2 rounded-full transition-all duration-300',
              activeAct === i ? 'scale-125 bg-primary' : 'bg-muted-foreground/30'
            )}
          />
        ))}
      </div>
    </section>
  );
}
