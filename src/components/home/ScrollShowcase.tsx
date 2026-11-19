import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { Observer } from 'gsap/Observer';
import { ArrowRight, ChevronDown, ChevronRight, ChevronUp, Lightbulb, Sparkles, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import CompareCanvas from '@/components/scene/CompareCanvas';
import { showcase } from '@/data/showcase';
import { cn } from '@/lib/utils';

gsap.registerPlugin(Observer, useGSAP);

const ACT_META = [
  { label: '01 · 开场舞台' },
  { label: '02 · 筹备困扰' },
  { label: '03 · AI 共策' },
  { label: '04 · 实景效果' },
] as const;

/* 每幕背景双色块目标位姿：切换幕时色块像流动纸面一样丝滑变形漂移 */
const BLOB_STATES = [
  {
    a: { xPercent: 0, yPercent: 0, scale: 1, rotation: 0 },
    b: { xPercent: 0, yPercent: 0, scale: 1, rotation: 0 },
  },
  {
    a: { xPercent: 8, yPercent: 62, scale: 0.88, rotation: 18 },
    b: { xPercent: -6, yPercent: -56, scale: 0.92, rotation: -16 },
  },
  {
    a: { xPercent: -4, yPercent: 4, scale: 0.94, rotation: -12 },
    b: { xPercent: 4, yPercent: 8, scale: 1.02, rotation: 14 },
  },
  {
    a: { xPercent: 118, yPercent: -6, scale: 0.9, rotation: 24 },
    b: { xPercent: -118, yPercent: 6, scale: 0.94, rotation: -20 },
  },
];

/**
 * 首页四幕全屏动效舞台（桌面端 GSAP Observer 编排切换，移动端/减弱动效降级为自然流式堆叠）：
 * - 彻底消灭普通下拉把画面拦腰截断的问题，也彻底消灭长 scrub 死区“拖不动/一下全爆出”的毛病
 * - 桌面端一次轻滚 / 方向键 / 点击进度点 = 一次电影级 GSAP 完整转场（含背景色块流动变形 + 每幕专属编排入场）
 * - 内置 Mac 触控板惯性冷却锁，确保一划精准切一幕，稳稳停在完整画面
 * - 鼠标在首幕轻移时，背景色块与场地贴图带柔和 2.5D 视差呼吸感
 */
export default function ScrollShowcase() {
  const sectionRef = useRef<HTMLElement>(null);
  const [activeAct, setActiveAct] = useState(0);
  const activeActRef = useRef(0);
  const animatingRef = useRef(false);
  const lastTurnAtRef = useRef(0);
  const goToActRef = useRef<(next: number, instant?: boolean) => void>(() => {});
  const activeTlRef = useRef<gsap.core.Timeline | null>(null);

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

  /** 用户手动操作对比滑块时立即交还控制 */
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

  /** 离开第四幕时停止自动演示 */
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

  /** 启动幕4平滑对比演示（50% -> 28% -> 72% -> 50%） */
  const tryStartAct4Demo = useCallback(() => {
    if (autoDemoStartedRef.current || autoDemoDoneRef.current || userInteractedRef.current) {
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
    stayTimerRef.current = window.setTimeout(() => {
      if (userInteractedRef.current || autoDemoDoneRef.current) return;

      const proxy = { pos: comparePosRef.current };
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
        pos: 28,
        duration: 0.85,
        ease: 'power2.inOut',
        onUpdate: () => {
          setComparePos(proxy.pos);
          comparePosRef.current = proxy.pos;
        },
      })
        .to(proxy, {
          pos: 72,
          duration: 1.15,
          ease: 'power2.inOut',
          onUpdate: () => {
            setComparePos(proxy.pos);
            comparePosRef.current = proxy.pos;
          },
        })
        .to(proxy, {
          pos: 50,
          duration: 0.85,
          ease: 'power2.inOut',
          onUpdate: () => {
            setComparePos(proxy.pos);
            comparePosRef.current = proxy.pos;
          },
        });
    }, 550);
  }, [isReducedMotion]);

  useEffect(() => {
    return () => {
      if (stayTimerRef.current) window.clearTimeout(stayTimerRef.current);
      if (autoDemoTweenRef.current) autoDemoTweenRef.current.kill();
    };
  }, []);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();

      mm.add('(min-width: 768px) and (prefers-reduced-motion: no-preference)', () => {
        const panelSel = (idx: number) => `.sf-panel-${idx + 1}`;

        /* 初始化：全部幕叠放隐藏，仅首幕可见并播放开场大秀 */
        gsap.set(['.sf-panel-2', '.sf-panel-3', '.sf-panel-4'], { autoAlpha: 0, y: 0, scale: 1, force3D: true });
        gsap.set('.sf-panel-1', { autoAlpha: 1, y: 0, scale: 1, force3D: true });

        /* 各幕专属入场复位与编排工厂 */
        const resetAct = (idx: number) => {
          if (idx === 0) {
            gsap.set(['.sf-brand', '.sf-line-a', '.sf-line-b'], { yPercent: 115, force3D: true });
            gsap.set('.sf-sub', { autoAlpha: 0, y: 18, force3D: true });
            gsap.set('.sf-hint', { autoAlpha: 0, y: 14, force3D: true });
            showcase.intro.words.forEach((_, i) => {
              const dir = i % 2 === 0 ? 1 : -1;
              gsap.set(`.sf-word-${i}`, { x: dir * (46 + i * 10), y: 24, scale: 0.86, autoAlpha: 0, force3D: true });
            });
            gsap.set('.sf-sticker', { y: 36, scale: 0.86, autoAlpha: 0, force3D: true });
            gsap.set('.sf-prep', { autoAlpha: 0, y: 12, force3D: true });
          } else if (idx === 1) {
            gsap.set('.sf-q-line', { yPercent: 115, force3D: true });
            gsap.set('.sf-q-bar', { scaleX: 0, force3D: true });
            gsap.set('.sf-pain', { scale: 0.62, y: 28, autoAlpha: 0, force3D: true });
            gsap.set(['.sf-core', '.sf-aux'], { autoAlpha: 0, y: 20, force3D: true });
          } else if (idx === 2) {
            gsap.set('.sf-conv-user1', { autoAlpha: 0, x: 34, y: 12, force3D: true });
            gsap.set('.sf-conv-ai-lead', { autoAlpha: 0, y: 14, force3D: true });
            gsap.set('.sf-conv-dir', { autoAlpha: 0, y: 28, scale: 0.94, force3D: true });
            gsap.set('.sf-conv-user2', { autoAlpha: 0, x: 34, y: 12, force3D: true });
            gsap.set('.sf-conv-badge', { autoAlpha: 0, scale: 0.4, force3D: true });
            gsap.set('.sf-conv-adjust', { autoAlpha: 0, y: 26, force3D: true });
            gsap.set('.sf-conv-row', { autoAlpha: 0, y: 12, force3D: true });
          } else if (idx === 3) {
            gsap.set('.sf-final-title', { autoAlpha: 0, y: 22, force3D: true });
            gsap.set('.sf-final-canvas', { autoAlpha: 0, scale: 0.9, y: 28, force3D: true });
            gsap.set('.sf-final-added-chip', { autoAlpha: 0, y: 12, scale: 0.9, force3D: true });
            gsap.set(['.sf-final-added', '.sf-final-aux', '.sf-final-cycle', '.sf-final-cta'], { autoAlpha: 0, y: 16, force3D: true });
            gsap.set('.sf-final-footer', { autoAlpha: 0 });
          }
        };

        const buildEnterTl = (idx: number, onDone?: () => void) => {
          const tl = gsap.timeline({ onComplete: onDone });
          if (idx === 0) {
            tl.to('.sf-brand', { yPercent: 0, duration: 0.45, ease: 'power3.out' }, 0.04)
              .to('.sf-line-a', { yPercent: 0, duration: 0.65, ease: 'power4.out' }, 0.14)
              .to('.sf-line-b', { yPercent: 0, duration: 0.65, ease: 'power4.out' }, 0.25)
              .to('.sf-sub', { autoAlpha: 1, y: 0, duration: 0.45, stagger: 0.08, ease: 'power3.out' }, 0.42)
              .to('.sf-word', { x: 0, y: 0, scale: 1, autoAlpha: 1, duration: 0.68, stagger: 0.055, ease: 'back.out(1.25)' }, 0.36)
              .to('.sf-sticker', { y: 0, scale: 1, autoAlpha: 1, duration: 0.72, stagger: 0.11, ease: 'back.out(1.3)' }, 0.56)
              .to('.sf-prep', { autoAlpha: 1, y: 0, duration: 0.35, stagger: 0.05, ease: 'power2.out' }, 0.86)
              .to('.sf-hint', { autoAlpha: 1, y: 0, duration: 0.38, ease: 'power2.out' }, 1.05);
          } else if (idx === 1) {
            tl.to('.sf-q-line', { yPercent: 0, duration: 0.62, ease: 'power4.out' }, 0.02)
              .to('.sf-q-bar', { scaleX: 1, duration: 0.48, ease: 'power3.out' }, 0.2)
              .to('.sf-pain', { scale: 1, y: 0, autoAlpha: 1, duration: 0.56, stagger: { amount: 0.36, from: 'center' }, ease: 'back.out(1.45)' }, 0.16)
              .to('.sf-core', { autoAlpha: 1, y: 0, duration: 0.48, ease: 'power3.out' }, 0.48)
              .to('.sf-aux', { autoAlpha: 1, y: 0, duration: 0.42, ease: 'power2.out' }, 0.6);
          } else if (idx === 2) {
            tl.to('.sf-conv-user1', { autoAlpha: 1, x: 0, y: 0, duration: 0.45, ease: 'power3.out' }, 0.02)
              .to('.sf-conv-ai-lead', { autoAlpha: 1, y: 0, duration: 0.36, ease: 'power2.out' }, 0.24)
              .to('.sf-conv-dir', { autoAlpha: 1, y: 0, scale: 1, duration: 0.48, stagger: 0.08, ease: 'power3.out' }, 0.3)
              .to('.sf-conv-user2', { autoAlpha: 1, x: 0, y: 0, duration: 0.45, ease: 'power3.out' }, 0.62)
              .to('.sf-conv-badge', { autoAlpha: 1, scale: 1, duration: 0.38, ease: 'back.out(2.1)' }, 0.78)
              .to('.sf-conv-dim', { autoAlpha: 0.42, scale: 0.98, duration: 0.4, ease: 'power2.out' }, 0.78)
              .to('.sf-conv-adjust', { autoAlpha: 1, y: 0, duration: 0.48, ease: 'power3.out' }, 0.92)
              .to('.sf-conv-row', { autoAlpha: 1, y: 0, duration: 0.34, stagger: 0.05, ease: 'power2.out' }, 1.04);
          } else if (idx === 3) {
            tl.to('.sf-final-title', { autoAlpha: 1, y: 0, duration: 0.48, ease: 'power3.out' }, 0.02)
              .to('.sf-final-canvas', { autoAlpha: 1, scale: 1, y: 0, duration: 0.62, ease: 'power3.out' }, 0.12)
              .to('.sf-final-added', { autoAlpha: 1, y: 0, duration: 0.35, ease: 'power2.out' }, 0.34)
              .to('.sf-final-added-chip', { autoAlpha: 1, y: 0, scale: 1, duration: 0.36, stagger: 0.045, ease: 'back.out(1.4)' }, 0.38)
              .to('.sf-final-aux', { autoAlpha: 1, y: 0, duration: 0.38, ease: 'power2.out' }, 0.48)
              .to('.sf-final-cycle', { autoAlpha: 1, y: 0, duration: 0.4, ease: 'power2.out' }, 0.56)
              .to('.sf-final-cta', { autoAlpha: 1, y: 0, duration: 0.44, ease: 'power3.out' }, 0.66)
              .to('.sf-final-footer', { autoAlpha: 1, duration: 0.35, ease: 'power1.out' }, 0.76);
          }
          return tl;
        };

        /* 切换幕核心控制器：一次滚动/点击 = 一套丝滑电影级转场（退场 + 背景色块流动变形 + 新幕专属编排） */
        const goToAct = (target: number, bypassCooldown = false) => {
          const next = Math.max(0, Math.min(3, target));
          const prev = activeActRef.current;
          if (next === prev) return;
          const now = Date.now();
          if (!bypassCooldown && (animatingRef.current || now - lastTurnAtRef.current < 760)) {
            return;
          }

          animatingRef.current = true;
          lastTurnAtRef.current = now;
          activeTlRef.current?.kill();

          if (prev === 3) handleLeaveAct4();

          const dir = next > prev ? 1 : -1;
          const prevEl = panelSel(prev);
          const nextEl = panelSel(next);
          const blobTarget = BLOB_STATES[next];

          activeActRef.current = next;
          setActiveAct(next);

          resetAct(next);
          gsap.set(nextEl, { autoAlpha: 1, y: dir * 32, scale: 0.985, force3D: true });

          const master = gsap.timeline({
            onComplete: () => {
              animatingRef.current = false;
              if (next === 3) {
                act4InViewRef.current = true;
                tryStartAct4Demo();
              }
            },
          });
          activeTlRef.current = master;

          /* 背景双色块丝滑漂移变形 */
          master
            .to('.sf-bg-blob-a', { ...blobTarget.a, duration: 0.95, ease: 'power3.inOut' }, 0)
            .to('.sf-bg-blob-b', { ...blobTarget.b, duration: 0.95, ease: 'power3.inOut' }, 0)
            /* 上一幕优雅景深退场 */
            .to(prevEl, { autoAlpha: 0, y: -dir * 42, scale: 0.95, duration: 0.38, ease: 'power2.in' }, 0)
            /* 新幕整体就位，随后触发其专属元素编排 */
            .to(nextEl, { y: 0, scale: 1, duration: 0.46, ease: 'power3.out' }, 0.16)
            .add(buildEnterTl(next), 0.2);

          /* 0.52s 后提前解除交互锁（但保留触控板惯性冷却），让用户点击进度点可以畅快连切 */
          master.call(() => {
            animatingRef.current = false;
          }, [], 0.56);
        };

        goToActRef.current = goToAct;

        /* 初始自动播完第 1 幕开场动画 */
        resetAct(0);
        activeTlRef.current = buildEnterTl(0);

        /* 滚轮 & 触控滑动监听（GSAP Observer）：1 次轻滑 = 1 次精准优雅换幕 */
        const observer = Observer.create({
          target: sectionRef.current,
          type: 'wheel,touch',
          wheelSpeed: 1,
          tolerance: 22,
          preventDefault: true,
          ignore: '.compare-handle',
          onDown: (self) => {
            /* 鼠标滚轮向下或双指向上推 -> 下一幕 */
            if (Math.abs(self.deltaY) < 12) return;
            goToAct(activeActRef.current + 1);
          },
          onUp: (self) => {
            if (Math.abs(self.deltaY) < 12) return;
            goToAct(activeActRef.current - 1);
          },
        });

        /* 键盘上下键 / 翻页键支持 */
        const onKeyDown = (e: KeyboardEvent) => {
          const tag = (e.target as HTMLElement | null)?.tagName;
          if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement | null)?.isContentEditable) return;
          if (e.key === 'ArrowDown' || e.key === 'PageDown') {
            e.preventDefault();
            goToAct(activeActRef.current + 1, true);
          } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
            e.preventDefault();
            goToAct(activeActRef.current - 1, true);
          } else if (e.key === 'Home') {
            e.preventDefault();
            goToAct(0, true);
          } else if (e.key === 'End') {
            e.preventDefault();
            goToAct(3, true);
          }
        };
        window.addEventListener('keydown', onKeyDown);

        /* 点击顶栏 Logo 时丝滑动画回到第 1 幕 */
        const onHomeTop = () => goToAct(0, true);
        window.addEventListener('sf-home-top', onHomeTop);

        /* 柔和 2.5D 鼠标微视差（quickTo 硬件加速，零重绘开销，让页面静止时也自带呼吸感） */
        const blobAX = gsap.quickTo('.sf-bg-parallax-a', 'x', { duration: 0.7, ease: 'power2.out' });
        const blobAY = gsap.quickTo('.sf-bg-parallax-a', 'y', { duration: 0.7, ease: 'power2.out' });
        const blobBX = gsap.quickTo('.sf-bg-parallax-b', 'x', { duration: 0.7, ease: 'power2.out' });
        const blobBY = gsap.quickTo('.sf-bg-parallax-b', 'y', { duration: 0.7, ease: 'power2.out' });
        const wordsX = gsap.quickTo('.sf-words-parallax', 'x', { duration: 0.6, ease: 'power2.out' });
        const wordsY = gsap.quickTo('.sf-words-parallax', 'y', { duration: 0.6, ease: 'power2.out' });

        const onPointerMove = (e: PointerEvent) => {
          const nx = e.clientX / window.innerWidth - 0.5;
          const ny = e.clientY / window.innerHeight - 0.5;
          blobAX(nx * -26);
          blobAY(ny * -22);
          blobBX(nx * 28);
          blobBY(ny * 24);
          if (activeActRef.current === 0) {
            wordsX(nx * 14);
            wordsY(ny * 10);
          }
        };
        window.addEventListener('pointermove', onPointerMove, { passive: true });

        return () => {
          observer.kill();
          activeTlRef.current?.kill();
          window.removeEventListener('keydown', onKeyDown);
          window.removeEventListener('sf-home-top', onHomeTop);
          window.removeEventListener('pointermove', onPointerMove);
        };
      });
    },
    { scope: sectionRef }
  );

  /* 移动端 / 减弱动效：静态堆叠时滚入第 4 幕启动对比演示 */
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
          } else if (!entry.isIntersecting && act4InViewRef.current) {
            handleLeaveAct4();
          }
        });
      },
      { threshold: [0.1, 0.5] }
    );
    observer.observe(panel);
    return () => observer.disconnect();
  }, [tryStartAct4Demo, handleLeaveAct4]);

  return (
    <section
      ref={sectionRef}
      className="relative isolate w-full overflow-x-clip bg-background md:motion-safe:h-[calc(100dvh-4rem)] md:motion-safe:overflow-hidden"
    >
      {/* 全局共享动态纸面色块层：随四幕切换漂移变形 + 鼠标柔和视差 */}
      <div className="sf-deco pointer-events-none hidden md:motion-safe:block" aria-hidden="true">
        <div
          className="sf-bg-parallax-a absolute"
          style={{ top: '-14%', left: '-10%', width: '42vw', height: '42vw', minWidth: 320, minHeight: 320 }}
        >
          <span className="sf-bg-blob-a sf-blob sf-paper-cream block h-full w-full will-change-transform" />
        </div>
        <div
          className="sf-bg-parallax-b absolute"
          style={{ bottom: '-18%', right: '-12%', width: '46vw', height: '46vw', minWidth: 360, minHeight: 360 }}
        >
          <span className="sf-bg-blob-b sf-blob sf-paper-purple block h-full w-full will-change-transform" />
        </div>
      </div>

      {/* ===== 幕1 活动文字舞台 · 现代波普贴纸海报 ===== */}
      <div
        className={cn(
          'sf-panel-1 relative flex min-h-[92dvh] w-full flex-col overflow-hidden px-5 pb-16 pt-20 md:motion-safe:absolute md:motion-safe:inset-0 md:motion-safe:h-full md:motion-safe:min-h-0 md:motion-safe:px-0 md:motion-safe:pb-0 md:motion-safe:pt-0',
          activeAct === 0 ? 'md:motion-safe:pointer-events-auto md:motion-safe:z-10' : 'md:motion-safe:pointer-events-none md:motion-safe:z-0'
        )}
      >
        {/* 移动端专属淡背景色块（桌面端已由共享动态色块层接管） */}
        <div className="sf-deco md:motion-safe:hidden" aria-hidden="true">
          <span className="sf-blob sf-paper-cream" style={{ top: '-12%', left: '-10%', width: '58vw', height: '58vw', minWidth: 240, minHeight: 240 }} />
          <span className="sf-blob sf-paper-purple" style={{ bottom: '-14%', right: '-12%', width: '62vw', height: '62vw', minWidth: 260, minHeight: 260 }} />
        </div>

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

        {/* 舞台中部偏右：四排流式弹性贴纸拼贴（支持微视差，任意屏幕比例零遮挡） */}
        <div className="sf-words-parallax relative z-10 mt-8 md:motion-safe:absolute md:motion-safe:left-[47vw] md:motion-safe:top-[46%] md:motion-safe:mt-0 md:motion-safe:w-[45vw] md:motion-safe:max-w-[680px] md:motion-safe:-translate-y-1/2">
          <div className="sf-words flex flex-col gap-4 xl:gap-5">
            {/* 第 1 排 */}
            <div className="flex flex-wrap items-center justify-between gap-3 md:px-2">
              {showcase.intro.words.slice(0, 2).map((w, i) => (
                <div key={w.t} className="sf-word-mask flex items-center py-1">
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

            {/* 第 2 排 */}
            <div className="flex flex-wrap items-center gap-4 md:pl-4">
              {showcase.intro.preps[1] && (
                <span className="sf-prep hidden items-center gap-2 rounded-full bg-card/95 px-3 py-1 text-xs font-medium text-muted-foreground shadow-2xs md:motion-safe:inline-flex">
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary/70" />
                  {showcase.intro.preps[1].t}
                </span>
              )}
              {showcase.intro.words[2] && (
                <div className="sf-word-mask flex items-center py-0.5 md:ml-4">
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

            {/* 第 3 排：2 张白边实景场地贴图 */}
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

            {/* 第 4 排 */}
            <div className="flex flex-wrap items-center gap-3 pt-1 md:justify-around md:px-2">
              {showcase.intro.words.slice(3).map((w, idx) => {
                const i = idx + 3;
                return (
                  <div key={w.t} className="sf-word-mask flex items-center py-0.5">
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
        </div>

        {/* 底部可点击切换引导胶囊 */}
        <div className="sf-hint relative z-10 mt-6 flex justify-center md:motion-safe:absolute md:motion-safe:bottom-6 md:motion-safe:left-1/2 md:motion-safe:mt-0 md:motion-safe:-translate-x-1/2">
          <button
            type="button"
            onClick={() => goToActRef.current(1, true)}
            className="flex cursor-pointer items-center gap-2 rounded-full border border-border/80 bg-card/95 px-5 py-2 text-sm font-medium text-foreground/80 shadow-sm transition-colors hover:border-primary/40 hover:text-primary"
          >
            {showcase.intro.scrollHint}
            <ChevronDown className="h-4 w-4 animate-bounce text-primary" />
          </button>
        </div>
      </div>

      {/* ===== 幕2 困扰聚合 · 中心爆发式弹性贴纸 ===== */}
      <div
        className={cn(
          'sf-panel-2 relative w-full px-5 py-16 md:motion-safe:absolute md:motion-safe:inset-0 md:motion-safe:h-full md:motion-safe:overflow-hidden md:motion-safe:py-0',
          activeAct === 1 ? 'md:motion-safe:pointer-events-auto md:motion-safe:z-10' : 'md:motion-safe:pointer-events-none md:motion-safe:z-0'
        )}
      >
        <div className="sf-inner relative flex min-h-[80dvh] w-full flex-col items-center md:motion-safe:h-full md:motion-safe:min-h-0 md:motion-safe:justify-center">
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

      {/* ===== 幕3 共策过程 · 剧场式逐步对话演绎 ===== */}
      <div
        className={cn(
          'sf-panel-3 relative w-full px-5 py-16 md:motion-safe:absolute md:motion-safe:inset-0 md:motion-safe:h-full md:motion-safe:overflow-hidden md:motion-safe:py-0',
          activeAct === 2 ? 'md:motion-safe:pointer-events-auto md:motion-safe:z-10' : 'md:motion-safe:pointer-events-none md:motion-safe:z-0'
        )}
      >
        <div className="sf-inner mx-auto flex min-h-[80dvh] w-full max-w-4xl flex-col justify-center gap-4 md:motion-safe:h-full md:motion-safe:min-h-0 md:motion-safe:gap-5 md:motion-safe:px-10">
          <div className="sf-conv-user1 flex justify-end">
            <div className="max-w-[82%] rounded-2xl rounded-br-md border border-primary/25 bg-[#F4F5FF] px-5 py-4 shadow-sm md:px-6 md:py-5">
              <p className="text-[11px] font-semibold text-primary md:text-xs">你</p>
              <p className="mt-1 text-xl font-medium leading-relaxed text-foreground md:text-3xl">{showcase.act3.user1}</p>
            </div>
          </div>

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

          <div className="sf-conv-user2 flex justify-end">
            <div className="max-w-[82%] rounded-2xl rounded-br-md border border-primary/25 bg-[#F4F5FF] px-5 py-4 shadow-sm md:px-6 md:py-5">
              <p className="text-[11px] font-semibold text-primary md:text-xs">你</p>
              <p className="mt-1 text-xl font-medium leading-relaxed text-foreground md:text-3xl">{showcase.act3.user2}</p>
            </div>
          </div>

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

      {/* ===== 幕4 看见效果 + 收尾 · 聚焦展映 + 自动对比演示 ===== */}
      <div
        className={cn(
          'sf-panel-4 relative flex w-full flex-col items-center gap-3 px-5 py-14 md:motion-safe:absolute md:motion-safe:inset-0 md:motion-safe:h-full md:motion-safe:justify-center md:motion-safe:gap-3 md:motion-safe:overflow-hidden md:motion-safe:pb-12 md:motion-safe:pt-4',
          activeAct === 3 ? 'md:motion-safe:pointer-events-auto md:motion-safe:z-10' : 'md:motion-safe:pointer-events-none md:motion-safe:z-0'
        )}
      >
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
            className="aspect-[3/2] w-full rounded-[0.95rem] md:h-[min(45vh,450px)] md:w-auto"
            labels={['布置前', '布置后']}
          />
        </div>
        <div className="sf-final-added flex w-full max-w-4xl flex-wrap items-center justify-center gap-1.5 px-4">
          <span className="text-sm font-semibold text-foreground/80 md:text-base">新增布置：</span>
          {showcase.act4.added.map((a) => (
            <span
              key={a}
              className="sf-final-added-chip rounded-full border border-primary/20 bg-card/95 px-3 py-1 text-xs font-medium text-foreground/80 shadow-2xs md:text-sm"
            >
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

        <div className="sf-final-footer mt-3 flex w-full flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t px-4 pt-3 md:motion-safe:absolute md:motion-safe:bottom-0 md:motion-safe:left-0 md:motion-safe:mt-0 md:motion-safe:bg-background/90 md:motion-safe:py-3">
          <span className="flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-primary" />
            <span className="gradient-text text-xs font-bold md:text-sm">SceneFlow AI</span>
          </span>
          <span className="text-xs text-muted-foreground md:text-sm">{showcase.act4Copy.footer}</span>
        </div>
      </div>

      {/* ===== 桌面右侧舞台控制器：上下箭头 + 4 幕进度点（支持滚轮/触控/键盘/点击多模态切换） ===== */}
      <div className="fixed right-4 top-1/2 z-20 hidden -translate-y-1/2 flex-col items-center gap-1.5 rounded-full border border-border/70 bg-card/85 px-1.5 py-2 shadow-sm backdrop-blur-sm md:motion-safe:flex">
        <button
          type="button"
          aria-label="上一幕"
          disabled={activeAct === 0}
          onClick={() => goToActRef.current(activeAct - 1, true)}
          className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-25"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
        {ACT_META.map((act, i) => (
          <button
            key={act.label}
            type="button"
            title={act.label}
            aria-label={act.label}
            onClick={() => goToActRef.current(i, true)}
            className="group flex h-4 w-4 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span
              className={cn(
                'rounded-full transition-all duration-300 group-hover:bg-primary/70',
                activeAct === i ? 'h-4 w-2 bg-primary' : 'h-2 w-2 bg-muted-foreground/35'
              )}
            />
          </button>
        ))}
        <button
          type="button"
          aria-label="下一幕"
          disabled={activeAct === 3}
          onClick={() => goToActRef.current(activeAct + 1, true)}
          className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-25"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>
    </section>
  );
}
