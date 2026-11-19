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
  const activeActRef = useRef(0);
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
        /* ===== 初始状态：第 1 幕自动开场，第 2/3/4 幕由各自独立实时时间轴编排（与滚动速度彻底解耦） ===== */
        gsap.set(['.sf-brand', '.sf-line-a', '.sf-line-b'], { yPercent: 115, force3D: true });
        gsap.set('.sf-sub', { autoAlpha: 0, y: 14, force3D: true });
        gsap.set('.sf-hint', { autoAlpha: 0, y: 10, force3D: true });
        showcase.intro.words.forEach((w, i) => {
          const dir = i % 2 === 0 ? 1 : -1;
          gsap.set(`.sf-word-${i}`, {
            x: dir * (44 + i * 10),
            y: 24 + i * 4,
            scale: 0.92,
            autoAlpha: 0,
            force3D: true,
          });
        });
        gsap.set('.sf-sticker', { y: 30, scale: 0.9, autoAlpha: 0, force3D: true });
        gsap.set('.sf-prep', { autoAlpha: 0, y: 10, force3D: true });

        /* 第 2/3/4 幕内部元素初始隐藏，等待进幕时以稳定优雅的实时节拍播完 */
        gsap.set('.sf-q-line', { yPercent: 115, force3D: true });
        gsap.set('.sf-q-bar', { scaleX: 0, force3D: true });
        gsap.set('.sf-pain', { y: 22, autoAlpha: 0, force3D: true });
        gsap.set(['.sf-core', '.sf-aux'], { autoAlpha: 0, y: 16, force3D: true });

        gsap.set(['.sf-conv-user1', '.sf-conv-user2', '.sf-conv-ai-lead', '.sf-conv-adjust'], { autoAlpha: 0, y: 20, force3D: true });
        gsap.set('.sf-conv-dir', { autoAlpha: 0, y: 20, force3D: true });
        gsap.set('.sf-conv-badge', { autoAlpha: 0, scale: 0.65, force3D: true });
        gsap.set('.sf-conv-row', { autoAlpha: 0, y: 12, force3D: true });

        gsap.set(['.sf-final-title', '.sf-final-canvas', '.sf-final-aux', '.sf-final-added', '.sf-final-cycle', '.sf-final-cta'], { autoAlpha: 0, y: 18, force3D: true });
        gsap.set('.sf-final-footer', { autoAlpha: 0 });

        /* ===== ① 第 1 幕自动开场（约 1.8s 利落完成） ===== */
        const intro = gsap.timeline();
        introRef.current = intro;
        intro
          .to('.sf-brand', { yPercent: 0, duration: 0.42, ease: 'power3.out' }, 0.04)
          .to('.sf-line-a', { yPercent: 0, duration: 0.6, ease: 'power4.out' }, 0.14)
          .to('.sf-line-b', { yPercent: 0, duration: 0.6, ease: 'power4.out' }, 0.26)
          .to('.sf-sub', { autoAlpha: 1, y: 0, duration: 0.42, ease: 'power3.out' }, 0.46)
          .to(
            '.sf-word',
            { x: 0, y: 0, scale: 1, autoAlpha: 1, duration: 0.65, stagger: 0.055, ease: 'power3.out' },
            0.48
          )
          .to(
            '.sf-sticker',
            { y: 0, scale: 1, autoAlpha: 1, duration: 0.65, stagger: 0.1, ease: 'power3.out' },
            0.72
          )
          .to('.sf-prep', { autoAlpha: 1, y: 0, duration: 0.32, stagger: 0.04, ease: 'power2.out' }, 1.05)
          .to('.sf-hint', { autoAlpha: 1, y: 0, duration: 0.35, ease: 'power2.out' }, 1.32);

        const setActIfChanged = (idx: number) => {
          if (idx !== activeActRef.current) {
            activeActRef.current = idx;
            setActiveAct(idx);
          }
        };

        /* ===== ② 第 2 幕独立实时入场动画（进幕即按固定舒适节拍播完，绝不因滚轮快慢而卡住或爆冲） ===== */
        const act2Tl = gsap.timeline({ paused: true });
        act2Tl
          .to('.sf-q-line', { yPercent: 0, duration: 0.55, ease: 'power3.out' }, 0)
          .to('.sf-q-bar', { scaleX: 1, duration: 0.45, ease: 'power2.out' }, 0.16)
          .to('.sf-pain', { autoAlpha: 1, y: 0, duration: 0.48, stagger: 0.045, ease: 'power2.out' }, 0.12)
          .to('.sf-core', { autoAlpha: 1, y: 0, duration: 0.45, ease: 'power2.out' }, 0.38)
          .to('.sf-aux', { autoAlpha: 1, y: 0, duration: 0.4, ease: 'power2.out' }, 0.5);

        /* ===== ③ 第 3 幕独立实时入场动画（用户提问 → AI 候选 → 选中点亮 → 调整安排，从容展开且完整定格） ===== */
        const act3Tl = gsap.timeline({ paused: true });
        act3Tl
          .to('.sf-conv-user1', { autoAlpha: 1, y: 0, duration: 0.42, ease: 'power2.out' }, 0)
          .to('.sf-conv-ai-lead', { autoAlpha: 1, y: 0, duration: 0.35, ease: 'power2.out' }, 0.22)
          .to('.sf-conv-dir', { autoAlpha: 1, y: 0, duration: 0.42, stagger: 0.08, ease: 'power2.out' }, 0.28)
          .to('.sf-conv-user2', { autoAlpha: 1, y: 0, duration: 0.42, ease: 'power2.out' }, 0.62)
          .to('.sf-conv-badge', { autoAlpha: 1, scale: 1, duration: 0.34, ease: 'back.out(1.7)' }, 0.78)
          .to('.sf-conv-dim', { autoAlpha: 0.45, duration: 0.36, ease: 'power1.out' }, 0.78)
          .to('.sf-conv-adjust', { autoAlpha: 1, y: 0, duration: 0.42, ease: 'power2.out' }, 0.92)
          .to('.sf-conv-row', { autoAlpha: 1, y: 0, duration: 0.34, stagger: 0.055, ease: 'power2.out' }, 1.02);

        /* ===== ④ 第 4 幕独立实时入场动画（标题 → 对比画布 → 清单 → 循环 → 行动入口 → 页脚） ===== */
        const act4Tl = gsap.timeline({ paused: true });
        act4Tl
          .to('.sf-final-title', { autoAlpha: 1, y: 0, duration: 0.45, ease: 'power2.out' }, 0)
          .to('.sf-final-canvas', { autoAlpha: 1, y: 0, duration: 0.55, ease: 'power2.out' }, 0.1)
          .to('.sf-final-added', { autoAlpha: 1, y: 0, duration: 0.38, ease: 'power2.out' }, 0.28)
          .to('.sf-final-aux', { autoAlpha: 1, y: 0, duration: 0.38, ease: 'power2.out' }, 0.36)
          .to('.sf-final-cycle', { autoAlpha: 1, y: 0, duration: 0.38, ease: 'power2.out' }, 0.44)
          .to('.sf-final-cta', { autoAlpha: 1, y: 0, duration: 0.42, ease: 'power2.out' }, 0.52)
          .to('.sf-final-footer', { autoAlpha: 1, duration: 0.35, ease: 'power1.out' }, 0.62);

        /* ===== 非 sticky 轨道触发器：原生 1:1 滚动滑入无任何死区，同时驱动景深轻退与幕内编排 ===== */
        const triggers: ScrollTrigger[] = [];

        /* 下一幕原生滑上覆盖时，上一幕做 1:1 零延迟（scrub: true）轻景深退场；完全退到视口下方后才静默复位，绝不在可见时突兀消失 */
        const addDeckDepth = (trackSel: string, prevSel: string, onFullyBelow?: () => void) => {
          const tween = gsap.to(prevSel, {
            scale: 0.96,
            autoAlpha: 0.35,
            ease: 'none',
            force3D: true,
            scrollTrigger: {
              trigger: trackSel,
              start: 'top bottom',
              end: 'top 64px',
              scrub: true,
              onLeaveBack: onFullyBelow,
            },
          });
          if (tween.scrollTrigger) triggers.push(tween.scrollTrigger);
        };
        addDeckDepth('.sf-track-2', '.sf-panel-1-stage', () => act2Tl.pause(0));
        addDeckDepth('.sf-track-3', '.sf-panel-2 .sf-inner', () => act3Tl.pause(0));
        addDeckDepth('.sf-track-4', '.sf-panel-3 .sf-inner', () => {
          act4Tl.pause(0);
          handleLeaveAct4();
        });

        triggers.push(
          ScrollTrigger.create({
            trigger: '.sf-track-1',
            start: 'top 60%',
            end: 'bottom 50%',
            onEnter: () => setActIfChanged(0),
            onEnterBack: () => setActIfChanged(0),
          }),
          ScrollTrigger.create({
            trigger: '.sf-track-2',
            start: 'top 70%',
            end: 'bottom 50%',
            onEnter: () => {
              if (introRef.current && introRef.current.progress() < 1) introRef.current.progress(1);
              setActIfChanged(1);
              act2Tl.play();
            },
            onEnterBack: () => setActIfChanged(1),
            onLeaveBack: () => setActIfChanged(0),
          }),
          ScrollTrigger.create({
            trigger: '.sf-track-3',
            start: 'top 70%',
            end: 'bottom 50%',
            onEnter: () => {
              setActIfChanged(2);
              act3Tl.play();
            },
            onEnterBack: () => setActIfChanged(2),
            onLeaveBack: () => setActIfChanged(1),
          }),
          ScrollTrigger.create({
            trigger: '.sf-track-4',
            start: 'top 70%',
            end: 'bottom bottom',
            onEnter: () => {
              setActIfChanged(3);
              act4Tl.play();
              act4InViewRef.current = true;
              tryStartAct4Demo();
            },
            onEnterBack: () => setActIfChanged(3),
            onLeaveBack: () => setActIfChanged(2),
          })
        );

        return () => {
          intro.kill();
          introRef.current = null;
          act2Tl.kill();
          act3Tl.kill();
          act4Tl.kill();
          triggers.forEach((st) => st.kill());
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
      {/* 非 sticky 不可见滚动轨道锚点（四等分高度，精准驱动进幕实时编排与 1:1 景深退场，绝不被 sticky 坐标干扰） */}
      <div className="pointer-events-none hidden md:motion-safe:block" aria-hidden="true">
        <div className="sf-track-1 absolute left-0 top-0 h-1/4 w-px" />
        <div className="sf-track-2 absolute left-0 top-1/4 h-1/4 w-px" />
        <div className="sf-track-3 absolute left-0 top-2/4 h-1/4 w-px" />
        <div className="sf-track-4 absolute left-0 top-3/4 h-1/4 w-px" />
      </div>

      {/* ===== 幕1 活动文字舞台 · 原生 sticky 卡片（1:1 跟手 120fps，零死区） ===== */}
      <div className="sf-panel-1 relative isolate flex min-h-[92dvh] w-full flex-col overflow-hidden bg-background px-5 pb-16 pt-20 md:motion-safe:sticky md:motion-safe:top-16 md:motion-safe:z-[1] md:motion-safe:h-[calc(100dvh-4rem)] md:motion-safe:min-h-0 md:motion-safe:px-0 md:motion-safe:pb-0 md:motion-safe:pt-0">
        {/* 「轻盈创意纸面」静态边缘装饰 */}
        <div className="sf-deco" aria-hidden="true">
          <span className="sf-blob sf-paper-cream" style={{ top: '-12%', left: '-10%', width: '42vw', height: '42vw', minWidth: 320, minHeight: 320 }} />
          <span className="sf-blob sf-paper-purple" style={{ bottom: '-18%', right: '-12%', width: '46vw', height: '46vw', minWidth: 360, minHeight: 360 }} />
        </div>
        {/* 外层舞台容器：滚动退场只驱动本容器，与内部开场 intro 动画零属性冲突 */}
        <div className="sf-panel-1-stage relative z-10 flex h-full w-full flex-col will-change-transform">
        {/* 舞台中部偏左：SceneFlow AI + 两行主标题 + 说明文案 + 首屏直达入口 */}
        <div className="sf-a1-top relative z-10 md:motion-safe:absolute md:motion-safe:left-[8vw] md:motion-safe:top-[47%] md:motion-safe:w-[38vw] md:motion-safe:max-w-[560px] md:motion-safe:-translate-y-1/2">
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
            <span className="block overflow-hidden pb-1">
              <span className="sf-line sf-line-a font-display block whitespace-nowrap text-[14vw] font-black leading-[1.08] tracking-tight text-foreground md:motion-safe:text-[4.8vw] xl:motion-safe:text-[5.4rem]">
                {showcase.intro.lineA}
              </span>
            </span>
            <span className="block overflow-hidden pb-1 md:motion-safe:pl-[2.2vw]">
              <span className="sf-line sf-line-b font-display block whitespace-nowrap text-[14vw] font-black leading-[1.08] tracking-tight text-primary md:motion-safe:text-[4.8vw] xl:motion-safe:text-[5.4rem]">
                {showcase.intro.lineB}
              </span>
            </span>
          </h1>
          <p className="sf-sub mt-4 max-w-md text-base leading-relaxed text-muted-foreground md:mt-5 md:text-lg">{showcase.intro.sub}</p>
          <div className="sf-sub mt-6 flex flex-wrap items-center gap-3">
            <Button asChild size="lg" className="sf-pill-cobalt h-11 rounded-full border-0 px-6 text-[15px] font-semibold hover:opacity-95">
              <Link to="/plan">
                <Wand2 className="h-4 w-4" />
                开始共策
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="h-11 rounded-full border-border/80 bg-card/90 px-5 text-[15px] font-medium shadow-sm hover:border-primary/40 hover:bg-card">
              <Link to="/cases">
                <Lightbulb className="h-4 w-4 text-primary" />
                先看案例
              </Link>
            </Button>
          </div>
        </div>

        {/* 舞台中部偏右：四层流式弹性拼贴（去除与 GSAP 冲突的 CSS transition-transform 和高频模糊重绘） */}
        <div className="sf-words relative z-10 mt-8 flex flex-col gap-4 md:motion-safe:absolute md:motion-safe:left-[47vw] md:motion-safe:top-[46%] md:motion-safe:mt-0 md:motion-safe:w-[45vw] md:motion-safe:max-w-[680px] md:motion-safe:-translate-y-1/2 md:motion-safe:gap-4 xl:motion-safe:gap-5">
          {/* 第 1 排：顶部波普贴纸 + 轻巧筹备标签 */}
          <div className="flex flex-wrap items-center justify-between gap-3 md:px-2">
            {showcase.intro.words.slice(0, 2).map((w, i) => (
              <div
                key={w.t}
                className={cn(
                  'sf-word-mask flex items-center py-1',
                  w.tier === 'major' ? 'sf-word-major' : 'sf-word-aux'
                )}
              >
                <span
                  className={cn(
                    'sf-word inline-block leading-[1.12]',
                    `sf-word-${i}`,
                    w.size,
                    w.tilt,
                    w.style === 'cobalt' &&
                      'sf-pill-cobalt rounded-full px-5 py-2 font-display font-black tracking-tight md:px-7 md:py-2.5',
                    w.style === 'amber' &&
                      'sf-pill-amber rounded-full px-5 py-2 font-display font-black tracking-tight md:px-6 md:py-2'
                  )}
                >
                  {w.t}
                </span>
              </div>
            ))}
            {showcase.intro.preps[0] && (
              <span className="sf-prep hidden items-center gap-2 rounded-full bg-card/95 px-3 py-1 text-xs font-medium text-muted-foreground shadow-2xs md:motion-safe:inline-flex">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
                {showcase.intro.preps[0].t}
              </span>
            )}
          </div>

          {/* 第 2 排：视觉核心大字「企业年会」+ 破冰筹备标签 */}
          <div className="flex flex-wrap items-center gap-4 md:pl-4">
            {showcase.intro.preps[1] && (
              <span className="sf-prep hidden items-center gap-2 rounded-full bg-card/95 px-3 py-1 text-xs font-medium text-muted-foreground shadow-2xs md:motion-safe:inline-flex">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
                {showcase.intro.preps[1].t}
              </span>
            )}
            {showcase.intro.words[2] && (
              <div className="sf-word-mask sf-word-major flex items-center py-0.5 md:ml-4">
                <span
                  className={cn(
                    'sf-word sf-word-2 inline-block font-display font-black leading-[1.08] tracking-tight text-foreground',
                    showcase.intro.words[2].size,
                    showcase.intro.words[2].tilt
                  )}
                >
                  {showcase.intro.words[2].t}
                </span>
              </div>
            )}
          </div>

          {/* 第 3 排：2 张现代圆角白边实景场地贴图（限高 25vh，任何屏幕比例都不会挤占下方文字） */}
          <div className="grid grid-cols-2 gap-3.5 md:gap-5 md:px-1">
            {showcase.intro.stickers.map((s) => (
              <div
                key={s.alt}
                className={cn(
                  'sf-sticker sf-sticker-photo group relative overflow-hidden bg-white',
                  s.tilt
                )}
              >
                <div className="aspect-[4/3] max-h-[25vh] w-full overflow-hidden rounded-[0.9rem] bg-muted">
                  <img
                    src={s.src}
                    alt={s.alt}
                    className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
                  />
                </div>
                <span className="pointer-events-none absolute bottom-2.5 left-2.5 rounded-full bg-background/95 px-2.5 py-0.5 text-[11px] font-semibold text-foreground shadow-sm">
                  {s.tag}
                </span>
              </div>
            ))}
          </div>

          {/* 第 4 排：底部波普贴纸（自然流排在实景贴图正下方，绝不遮挡任何字） */}
          <div className="flex flex-wrap items-center gap-3 pt-1 md:justify-around md:px-2">
            {showcase.intro.words.slice(3).map((w, idx) => {
              const i = idx + 3;
              return (
                <div
                  key={w.t}
                  className={cn(
                    'sf-word-mask flex items-center py-0.5',
                    w.tier === 'major' ? 'sf-word-major' : 'sf-word-aux'
                  )}
                >
                  <span
                    className={cn(
                      'sf-word inline-block leading-[1.12]',
                      `sf-word-${i}`,
                      w.size,
                      w.tilt,
                      w.style === 'mint' &&
                        'sf-pill-mint rounded-full px-5 py-2 font-display font-black tracking-tight md:px-6 md:py-2',
                      w.style === 'soft' &&
                        'rounded-full border border-border/80 bg-card/95 px-4 py-1.5 font-display font-semibold tracking-tight text-foreground/80 shadow-sm'
                    )}
                  >
                    {w.t}
                  </span>
                </div>
              );
            })}
            {showcase.intro.preps[2] && (
              <span className="sf-prep hidden items-center gap-2 rounded-full bg-card/95 px-3 py-1 text-xs font-medium text-muted-foreground shadow-2xs md:motion-safe:inline-flex">
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
                {showcase.intro.preps[2].t}
              </span>
            )}
          </div>
        </div>

        {/* 滚动引导（舞台已按 calc(100dvh - 4rem) 精确对齐顶栏，bottom-6 始终完整居中可见） */}
        <div className="sf-hint relative z-10 mt-6 flex justify-center md:motion-safe:absolute md:motion-safe:bottom-6 md:motion-safe:left-1/2 md:motion-safe:mt-0 md:motion-safe:-translate-x-1/2">
          <span className="flex items-center gap-2 rounded-full border border-border/80 bg-card/95 px-5 py-2 text-sm font-medium text-foreground/80 shadow-sm">
            {showcase.intro.scrollHint}
            <ChevronDown className="h-4 w-4 animate-bounce text-primary" />
          </span>
        </div>
        </div>
      </div>

      {/* ===== 幕2 困扰聚合 · 原生 sticky 卡片，滚 1px 即 1:1 平滑盖上 ===== */}
      <div className="sf-panel-2 relative isolate w-full bg-background px-5 py-16 md:motion-safe:sticky md:motion-safe:top-16 md:motion-safe:z-[2] md:motion-safe:h-[calc(100dvh-4rem)] md:motion-safe:overflow-hidden md:motion-safe:py-0 md:motion-safe:border-t md:motion-safe:border-border/60">
        <div className="sf-deco" aria-hidden="true">
          <span className="sf-blob sf-paper-purple-faint" style={{ top: '-12%', right: '-10%', width: '36vw', height: '36vw', minWidth: 280, minHeight: 280 }} />
          <span className="sf-blob sf-paper-cream-faint" style={{ bottom: '-14%', left: '-8%', width: '34vw', height: '34vw', minWidth: 260, minHeight: 260 }} />
        </div>
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

          {/* 痛点：现代贴纸胶囊围绕中心，纯实体底色零模糊重绘 */}
          <div className="sf-pains relative mt-8 flex w-full flex-wrap justify-center gap-3 md:motion-safe:absolute md:motion-safe:inset-0 md:motion-safe:mt-0 md:motion-safe:block">
            {showcase.act2.pains.map((p, i) => (
              <span
                key={p.t}
                className={cn(
                  'sf-pain inline-flex items-center gap-2 rounded-full border px-4 py-1.5 font-display tracking-tight shadow-sm md:motion-safe:absolute',
                  `sf-pain-${i}`,
                  p.size,
                  p.tone === 'light' && 'border-border/75 bg-card/95 font-medium text-muted-foreground',
                  p.tone === 'mid' && 'border-border/80 bg-card font-bold text-foreground',
                  p.tone === 'accent' && 'sf-pill-cobalt border-0 px-5 py-2 font-black',
                  p.tone === 'heavy' && 'sf-pill-amber border-0 px-5 py-1.5 font-black'
                )}
                style={p.pos}
              >
                {p.tone !== 'accent' && p.tone !== 'heavy' && (
                  <span className="h-2 w-2 shrink-0 rounded-full bg-chart-5/85" />
                )}
                {p.t}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* ===== 幕3 共策过程 · 原生 sticky 卡片，进幕按从容节拍展开并完整定格 ===== */}
      <div className="sf-panel-3 relative isolate w-full bg-background px-5 py-16 md:motion-safe:sticky md:motion-safe:top-16 md:motion-safe:z-[3] md:motion-safe:h-[calc(100dvh-4rem)] md:motion-safe:overflow-hidden md:motion-safe:py-0 md:motion-safe:border-t md:motion-safe:border-border/60">
        <div className="sf-deco" aria-hidden="true">
          <span className="sf-blob sf-paper-cream-faint" style={{ top: '-12%', left: '-10%', width: '36vw', height: '36vw', minWidth: 280, minHeight: 280 }} />
          <span className="sf-blob sf-paper-purple-faint" style={{ bottom: '-16%', right: '-10%', width: '40vw', height: '40vw', minWidth: 300, minHeight: 300 }} />
        </div>
        <div className="sf-inner mx-auto flex min-h-[80dvh] w-full max-w-4xl flex-col justify-center gap-4 md:motion-safe:h-full md:motion-safe:min-h-0 md:motion-safe:gap-5 md:motion-safe:px-10">
          {/* 用户诉求（第二幕的一个问题自然进入用户诉求） */}
          <div className="sf-conv-user1 flex justify-end">
            <div className="max-w-[82%] rounded-2xl rounded-br-md border border-primary/25 bg-[#F4F5FF] px-5 py-4 shadow-sm md:px-6 md:py-5">
              <p className="text-[11px] font-semibold text-primary md:text-xs">你</p>
              <p className="mt-1 text-xl font-medium leading-relaxed text-foreground md:text-3xl">{showcase.act3.user1}</p>
            </div>
          </div>

          {/* AI 建议方向（舞台主体：三个方向并排，选中点亮） */}
          <div className="flex flex-col gap-3">
            <p className="sf-conv-ai-lead flex items-center gap-2 text-sm font-semibold text-muted-foreground md:text-lg">
              <Sparkles className="h-4 w-4 text-primary" />
              {showcase.act3.aiLead}
            </p>
            <div className="grid gap-3 md:grid-cols-3 md:gap-4">
              {showcase.act3.directions.map((d, i) => (
                <div
                  key={d.name}
                  className={cn(
                    'sf-conv-dir sf-card relative rounded-2xl p-5 md:p-6',
                    i === showcase.act3.pickIndex
                      ? 'border-2 border-primary bg-[#F4F5FF] shadow-md'
                      : 'sf-conv-dim'
                  )}
                >
                  <p className="font-display text-xl font-bold tracking-tight text-foreground md:text-2xl">{d.name}</p>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground md:text-base">{d.desc}</p>
                  {i === showcase.act3.pickIndex && (
                    <span className="sf-conv-badge sf-pill-cobalt absolute -top-3 right-3 rounded-full px-3 py-0.5 text-[11px] font-semibold">
                      ✓ {showcase.act3.pickLabel}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* 用户选择与补充 */}
          <div className="sf-conv-user2 flex justify-end">
            <div className="max-w-[82%] rounded-2xl rounded-br-md border border-primary/25 bg-[#F4F5FF] px-5 py-4 shadow-sm md:px-6 md:py-5">
              <p className="text-[11px] font-semibold text-primary md:text-xs">你</p>
              <p className="mt-1 text-xl font-medium leading-relaxed text-foreground md:text-3xl">{showcase.act3.user2}</p>
            </div>
          </div>

          {/* 调整后的安排（选中方向的成果，收拢为紧凑上下文） */}
          <div className="sf-conv-adjust sf-card rounded-2xl p-5 md:p-6">
            <p className="text-base font-bold text-foreground md:text-lg">{showcase.act3.adjustTitle}</p>
            <div className="mt-3 grid gap-x-6 gap-y-2 md:grid-cols-2">
              {showcase.act3.schedule.map((r) => (
                <div key={r.time} className="sf-conv-row flex items-baseline gap-2.5">
                  <span className="shrink-0 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                    {r.time}
                  </span>
                  <span className="min-w-0 text-sm leading-relaxed text-foreground/90 md:text-base">{r.text}</span>
                </div>
              ))}
              {showcase.act3.materials.map((m) => (
                <div key={m} className="sf-conv-row flex items-baseline gap-2.5">
                  <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-500/80" />
                  <span className="min-w-0 text-sm leading-relaxed text-foreground/90 md:text-base">{m}</span>
                </div>
              ))}
            </div>
            <p className="sf-conv-row mt-2 text-[11px] text-muted-foreground/70">{showcase.act3.demoNote}</p>
          </div>
        </div>
      </div>

      {/* ===== 幕4 看见效果 + 收尾 · 原生 sticky 末幕 ===== */}
      <div className="sf-panel-4 relative isolate flex w-full flex-col items-center gap-3 bg-background px-5 py-14 md:motion-safe:sticky md:motion-safe:top-16 md:motion-safe:z-[4] md:motion-safe:h-[calc(100dvh-4rem)] md:motion-safe:justify-center md:motion-safe:gap-3 md:motion-safe:overflow-hidden md:motion-safe:pb-12 md:motion-safe:pt-4 md:motion-safe:border-t md:motion-safe:border-border/60">
        <div className="sf-deco" aria-hidden="true">
          <span className="sf-blob sf-paper-cream-faint" style={{ top: '-14%', right: '-10%', width: '36vw', height: '36vw', minWidth: 280, minHeight: 280 }} />
          <span className="sf-blob sf-paper-purple-faint" style={{ bottom: '-14%', left: '-10%', width: '38vw', height: '38vw', minWidth: 300, minHeight: 300 }} />
        </div>
        <h2 className="sf-final-title max-w-xl px-4 text-center font-display text-2xl font-black leading-[1.3] tracking-tight text-balance text-foreground md:text-4xl">
          {showcase.act4Copy.title}
        </h2>
        <div className="sf-final-canvas sf-sticker-photo w-full max-w-4xl overflow-hidden bg-white md:w-auto">
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
            className="aspect-[3/2] w-full rounded-[0.95rem] md:h-[min(46vh,460px)] md:w-auto"
            labels={['布置前', '布置后']}
          />
        </div>
        {/* 新增布置：清爽彩色胶囊清单 */}
        <div className="sf-final-added flex w-full max-w-4xl flex-wrap items-center justify-center gap-1.5 px-4">
          <span className="text-sm font-semibold text-foreground/80 md:text-base">新增布置：</span>
          {showcase.act4.added.map((a) => (
            <span key={a} className="rounded-full border border-primary/20 bg-card/95 px-3 py-1 text-xs font-medium text-foreground/80 shadow-2xs md:text-sm">
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
                  'rounded-full border px-3 py-1 text-xs font-semibold md:text-sm',
                  i === showcase.act4Copy.activeCycle
                    ? 'sf-pill-cobalt border-0'
                    : 'border-border/80 bg-card text-muted-foreground shadow-2xs'
                )}
              >
                {c}
              </span>
            </span>
          ))}
        </div>
        <div className="sf-final-cta flex flex-col items-center gap-3 sm:flex-row">
          <Button asChild size="lg" className="sf-pill-cobalt h-12 rounded-full border-0 px-8 text-base font-semibold hover:opacity-95">
            <Link to="/plan">
              <Wand2 className="h-5 w-5" />
              {showcase.act4Copy.cta.primary}
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
          <Button asChild variant="outline" className="h-12 rounded-full border-primary/30 bg-card/90 px-6 text-primary shadow-sm hover:bg-primary/10">
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

      {/* ===== 桌面叠加控件：可点击精准跳转的幕进度点 ===== */}
      <div className="fixed right-4 top-1/2 z-20 hidden -translate-y-1/2 flex-col gap-2.5 md:motion-safe:flex">
        {[
          { label: '第 1 幕 · 开场舞台', index: 0 },
          { label: '第 2 幕 · 筹备困扰', index: 1 },
          { label: '第 3 幕 · AI 共策', index: 2 },
          { label: '第 4 幕 · 实景效果', index: 3 },
        ].map((act, i) => (
          <button
            key={act.label}
            type="button"
            title={act.label}
            aria-label={act.label}
            onClick={() => {
              const step = Math.max(1, window.innerHeight - 64);
              window.scrollTo({ top: Math.round(act.index * step), behavior: 'smooth' });
            }}
            className="group flex h-4 w-4 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span
              className={cn(
                'h-2 w-2 rounded-full transition-all duration-300 group-hover:scale-125 group-hover:bg-primary/70',
                activeAct === i ? 'scale-125 bg-primary' : 'bg-muted-foreground/30'
              )}
            />
          </button>
        ))}
      </div>
    </section>
  );
}
