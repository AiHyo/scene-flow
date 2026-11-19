import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { Observer } from 'gsap/Observer';
import { ArrowRight, ChevronDown, ChevronRight, ChevronUp, Lightbulb, Sparkles, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import CompareCanvas, { type CompareCanvasHandle } from '@/components/scene/CompareCanvas';
import { showcase } from '@/data/showcase';
import { cn } from '@/lib/utils';

gsap.registerPlugin(Observer, useGSAP);

/**
 * 5 个独立剧场节拍（把第 3 幕自然拆成「提出想法与候选方向」→「做出选择与方案落定」两拍，
 * 避免一次滚动把整段对话全播完，让用户按自己的阅读节奏推进）：
 * - step 0: 幕 1 · 开场舞台
 * - step 1: 幕 2 · 筹备困扰与 AI 定位
 * - step 2: 幕 3 上 · 说出想法，AI 给出三个方向
 * - step 3: 幕 3 下 · 你来选择补充，方案随之调整
 * - step 4: 幕 4 · 同场地实景前后对比与出发入口
 */
const STEP_META = [
  { label: '01 · 开场舞台', panel: 0 },
  { label: '02 · 筹备困扰', panel: 1 },
  { label: '03 · AI 提方向', panel: 2 },
  { label: '04 · 选定与调整', panel: 2 },
  { label: '05 · 实景效果', panel: 3 },
] as const;

/* 每拍对应的背景双色块目标位姿：切拍时背景色块缓慢优雅漂移变形 */
const BLOB_STATES = [
  {
    a: { xPercent: 0, yPercent: 0, scale: 1, rotation: 0 },
    b: { xPercent: 0, yPercent: 0, scale: 1, rotation: 0 },
  },
  {
    a: { xPercent: 8, yPercent: 60, scale: 0.9, rotation: 16 },
    b: { xPercent: -6, yPercent: -54, scale: 0.92, rotation: -14 },
  },
  {
    a: { xPercent: -6, yPercent: 2, scale: 0.94, rotation: -10 },
    b: { xPercent: 6, yPercent: 6, scale: 1.0, rotation: 12 },
  },
  {
    a: { xPercent: 6, yPercent: 18, scale: 0.98, rotation: -4 },
    b: { xPercent: -8, yPercent: -6, scale: 1.04, rotation: 20 },
  },
  {
    a: { xPercent: 116, yPercent: -6, scale: 0.9, rotation: 24 },
    b: { xPercent: -116, yPercent: 6, scale: 0.94, rotation: -20 },
  },
];

/**
 * 首页全屏剧场级动效舞台（桌面端 GSAP Observer 5 拍舒缓编排，移动端/减弱动效降级为自然堆叠）：
 * - 每拍节奏舒缓从容（1.4s–2.1s），不急促、不抢跑
 * - 第 3 幕拆分为两拍：先看「提问 + 3 个候选方向」并自然停顿，再轻滚一拍才点亮选中方向并展开「调整后的安排」
 * - 内置 Mac 触控板惯性冷却锁（950ms），保证一划稳稳推进一拍
 * - 全局共享双色块随节拍流动变形 + 鼠标 2.5D 柔和微视差
 */
export default function ScrollShowcase() {
  const sectionRef = useRef<HTMLElement>(null);
  const [activeStep, setActiveStep] = useState(0);
  const activeStepRef = useRef(0);
  const animatingRef = useRef(false);
  const lastTurnAtRef = useRef(0);
  const goToStepRef = useRef<(next: number, bypassCooldown?: boolean) => void>(() => {});
  const activeTlRef = useRef<gsap.core.Timeline | null>(null);

  const activePanel = STEP_META[activeStep].panel;

  /* ===== 幕4 自动演示对比状态（直写 DOM 零重渲染 + 正弦单摆无停顿往复） ===== */
  const compareRef = useRef<CompareCanvasHandle>(null);
  const comparePosRef = useRef(50);

  const userInteractedRef = useRef(false);
  const act4DemoPlayedRef = useRef(false);
  const autoDemoTweenRef = useRef<gsap.core.Timeline | null>(null);
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

  /** 用户手动操作对比滑块时立即交还控制，不再自动移动 */
  const interruptAutoDemo = useCallback(() => {
    userInteractedRef.current = true;
    if (autoDemoTweenRef.current) {
      autoDemoTweenRef.current.kill();
      autoDemoTweenRef.current = null;
    }
  }, []);

  /** 离开第四幕时停止自动演示；若用户未手动接管则复位居中，下次回来继续自然演示 */
  const handleLeaveAct4 = useCallback(() => {
    act4InViewRef.current = false;
    act4DemoPlayedRef.current = false;
    if (autoDemoTweenRef.current) {
      autoDemoTweenRef.current.kill();
      autoDemoTweenRef.current = null;
    }
    if (!userInteractedRef.current) {
      comparePosRef.current = 50;
      compareRef.current?.setPos(50);
    }
  }, []);

  /** 启动幕4单次丝滑对比演示（强缓动快慢有致：50% → 16% → 84% → 50% 一气呵成后自然停稳，不循环晃眼） */
  const tryStartAct4Demo = useCallback(() => {
    if (userInteractedRef.current || act4DemoPlayedRef.current || autoDemoTweenRef.current) {
      return;
    }
    if (!act4InViewRef.current || isReducedMotion()) {
      return;
    }
    if (!act4ImgsLoadedRef.current) {
      const imgs = sectionRef.current?.querySelectorAll<HTMLImageElement>('.sf-final-canvas img');
      if (imgs && imgs.length >= 2 && imgs[0].complete && imgs[1].complete && imgs[0].naturalWidth > 1 && imgs[1].naturalWidth > 1) {
        act4ImgsLoadedRef.current = true;
      } else {
        return;
      }
    }

    act4DemoPlayedRef.current = true;
    const proxy = { pos: comparePosRef.current };
    const syncPos = () => {
      comparePosRef.current = proxy.pos;
      compareRef.current?.setPos(proxy.pos);
    };

    const tl = gsap.timeline({
      onComplete: () => {
        comparePosRef.current = 50;
        compareRef.current?.setPos(50);
        autoDemoTweenRef.current = null;
      },
    });
    autoDemoTweenRef.current = tl;

    tl.to(proxy, {
      pos: 16,
      duration: 0.95,
      ease: 'power3.inOut',
      onUpdate: syncPos,
    })
      .to(proxy, {
        pos: 84,
        duration: 1.45,
        ease: 'power3.inOut',
        onUpdate: syncPos,
      })
      .to(proxy, {
        pos: 50,
        duration: 1.05,
        ease: 'power3.inOut',
        onUpdate: syncPos,
      });
  }, [isReducedMotion]);

  useEffect(() => {
    return () => {
      if (autoDemoTweenRef.current) {
        autoDemoTweenRef.current.kill();
        autoDemoTweenRef.current = null;
      }
    };
  }, []);

  useGSAP(
    () => {
      const mm = gsap.matchMedia();

      mm.add('(min-width: 768px) and (prefers-reduced-motion: no-preference)', () => {
        const panelSel = (panelIdx: number) => `.sf-panel-${panelIdx + 1}`;

        gsap.set(['.sf-panel-2', '.sf-panel-3', '.sf-panel-4'], { autoAlpha: 0, y: 0, scale: 1, force3D: true });
        gsap.set('.sf-panel-1', { autoAlpha: 1, y: 0, scale: 1, force3D: true });

        /* 各面板入场复位 */
        const resetPanel = (panelIdx: number) => {
          if (panelIdx === 0) {
            gsap.set(['.sf-brand', '.sf-line-a', '.sf-line-b'], { yPercent: 115, force3D: true });
            gsap.set('.sf-sub', { autoAlpha: 0, y: 20, force3D: true });
            gsap.set('.sf-hint', { autoAlpha: 0, y: 14, force3D: true });
            showcase.intro.words.forEach((_, i) => {
              const dir = i % 2 === 0 ? 1 : -1;
              gsap.set(`.sf-word-${i}`, { x: dir * (50 + i * 10), y: 28, scale: 0.86, autoAlpha: 0, force3D: true });
            });
            gsap.set('.sf-sticker', { y: 40, scale: 0.86, autoAlpha: 0, force3D: true });
            gsap.set('.sf-prep', { autoAlpha: 0, y: 14, force3D: true });
          } else if (panelIdx === 1) {
            gsap.set('.sf-q-line', { yPercent: 115, force3D: true });
            gsap.set('.sf-q-bar', { scaleX: 0, force3D: true });
            gsap.set('.sf-pain', { scale: 0.65, y: 28, autoAlpha: 0, force3D: true });
            gsap.set(['.sf-core', '.sf-aux'], { autoAlpha: 0, y: 22, force3D: true });
            gsap.set('.sf-act2-next', { autoAlpha: 0, y: 12, force3D: true });
          } else if (panelIdx === 2) {
            gsap.set('.sf-conv-user1', { autoAlpha: 0, x: 36, y: 14, force3D: true });
            gsap.set('.sf-conv-ai-lead', { autoAlpha: 0, y: 16, force3D: true });
            gsap.set('.sf-conv-dir', { autoAlpha: 0, y: 30, scale: 0.94, force3D: true });
            gsap.set('.sf-conv-pick-hint', { autoAlpha: 0, y: 12, force3D: true });
            /* 幕 3 下半拍：默认隐藏，等用户再滚一拍（或点“继续看你的选择”）才从容展开 */
            gsap.set('.sf-conv-user2', { autoAlpha: 0, x: 36, y: 14, force3D: true });
            gsap.set('.sf-conv-badge', { autoAlpha: 0, scale: 0.4, force3D: true });
            gsap.set('.sf-conv-adjust', { autoAlpha: 0, y: 28, force3D: true });
            gsap.set('.sf-conv-row', { autoAlpha: 0, y: 14, force3D: true });
          } else if (panelIdx === 3) {
            gsap.set('.sf-final-title', { autoAlpha: 0, y: 24, force3D: true });
            gsap.set('.sf-final-canvas', { autoAlpha: 0, scale: 0.92, y: 30, force3D: true });
            gsap.set('.sf-final-added-chip', { autoAlpha: 0, y: 14, scale: 0.9, force3D: true });
            gsap.set(['.sf-final-added', '.sf-final-aux', '.sf-final-cycle', '.sf-final-cta'], { autoAlpha: 0, y: 18, force3D: true });
            gsap.set('.sf-final-footer', { autoAlpha: 0 });
          }
        };

        /* 舒缓从容的每拍专属动画编排（1.4s–2.1s，有呼吸停顿与视觉重心） */
        const buildEnterTl = (stepIdx: number) => {
          const tl = gsap.timeline();
          if (stepIdx === 0) {
            tl.to('.sf-brand', { yPercent: 0, duration: 0.65, ease: 'power3.out' }, 0.06)
              .to('.sf-line-a', { yPercent: 0, duration: 0.9, ease: 'power4.out' }, 0.22)
              .to('.sf-line-b', { yPercent: 0, duration: 0.9, ease: 'power4.out' }, 0.44)
              .to('.sf-sub', { autoAlpha: 1, y: 0, duration: 0.65, stagger: 0.14, ease: 'power3.out' }, 0.78)
              .to('.sf-word', { x: 0, y: 0, scale: 1, autoAlpha: 1, duration: 0.95, stagger: 0.1, ease: 'back.out(1.2)' }, 0.68)
              .to('.sf-sticker', { y: 0, scale: 1, autoAlpha: 1, duration: 1.0, stagger: 0.18, ease: 'back.out(1.25)' }, 1.02)
              .to('.sf-prep', { autoAlpha: 1, y: 0, duration: 0.5, stagger: 0.08, ease: 'power2.out' }, 1.48)
              .to('.sf-hint', { autoAlpha: 1, y: 0, duration: 0.55, ease: 'power2.out' }, 1.75);
          } else if (stepIdx === 1) {
            /* 幕 2：先立住问题与 10 个痛点，留出 0.45s 呼吸后再由琥珀横线引出蓝色解法 */
            tl.to('.sf-q-line', { yPercent: 0, duration: 0.85, ease: 'power4.out' }, 0.05)
              .to('.sf-pain', { scale: 1, y: 0, autoAlpha: 1, duration: 0.78, stagger: { amount: 0.58, from: 'center' }, ease: 'back.out(1.35)' }, 0.32)
              .to('.sf-q-bar', { scaleX: 1, duration: 0.65, ease: 'power3.out' }, 1.02)
              .to('.sf-core', { autoAlpha: 1, y: 0, duration: 0.68, ease: 'power3.out' }, 1.24)
              .to('.sf-aux', { autoAlpha: 1, y: 0, duration: 0.58, ease: 'power2.out' }, 1.48)
              .to('.sf-act2-next', { autoAlpha: 1, y: 0, duration: 0.45, ease: 'power2.out' }, 1.78);
          } else if (stepIdx === 2) {
            /* 幕 3 上半拍：只呈现「用户提出诉求 → AI 给出三个候选方向」，停下来等你细看与互动 */
            tl.to('.sf-conv-user1', { autoAlpha: 1, x: 0, y: 0, duration: 0.68, ease: 'power3.out' }, 0.05)
              .to('.sf-conv-ai-lead', { autoAlpha: 1, y: 0, duration: 0.5, ease: 'power2.out' }, 0.46)
              .to('.sf-conv-dir', { autoAlpha: 1, y: 0, scale: 1, duration: 0.72, stagger: 0.14, ease: 'power3.out' }, 0.62)
              .to('.sf-conv-pick-hint', { autoAlpha: 1, y: 0, duration: 0.45, ease: 'power2.out' }, 1.28);
          } else if (stepIdx === 3) {
            /* 幕 3 下半拍：你的追问 → 选中方向点亮弹跳 & 其余轻退 → 调整后的日程逐行浮现 */
            tl.to('.sf-conv-pick-hint', { autoAlpha: 0, y: -8, duration: 0.28, ease: 'power2.in' }, 0)
              .to('.sf-conv-user2', { autoAlpha: 1, x: 0, y: 0, duration: 0.65, ease: 'power3.out' }, 0.1)
              .to('.sf-conv-badge', { autoAlpha: 1, scale: 1, duration: 0.52, ease: 'back.out(2.0)' }, 0.48)
              .to('.sf-conv-dim', { autoAlpha: 0.4, scale: 0.97, duration: 0.58, ease: 'power2.out' }, 0.48)
              .to('.sf-conv-picked', { scale: 1.03, duration: 0.28, ease: 'power2.out' }, 0.48)
              .to('.sf-conv-picked', { scale: 1, duration: 0.36, ease: 'power2.inOut' }, 0.76)
              .to('.sf-conv-adjust', { autoAlpha: 1, y: 0, duration: 0.68, ease: 'power3.out' }, 0.84)
              .to('.sf-conv-row', { autoAlpha: 1, y: 0, duration: 0.48, stagger: 0.09, ease: 'power2.out' }, 1.06);
          } else if (stepIdx === 4) {
            /* 幕 4：画框缓缓缩放登场 + 物料胶囊涟漪 + 行动入口，随后启动舒缓前后对比演示 */
            tl.to('.sf-final-title', { autoAlpha: 1, y: 0, duration: 0.68, ease: 'power3.out' }, 0.06)
              .to('.sf-final-canvas', { autoAlpha: 1, scale: 1, y: 0, duration: 0.9, ease: 'power3.out' }, 0.22)
              .to('.sf-final-added', { autoAlpha: 1, y: 0, duration: 0.45, ease: 'power2.out' }, 0.66)
              .to('.sf-final-added-chip', { autoAlpha: 1, y: 0, scale: 1, duration: 0.48, stagger: 0.08, ease: 'back.out(1.35)' }, 0.74)
              .to('.sf-final-aux', { autoAlpha: 1, y: 0, duration: 0.52, ease: 'power2.out' }, 1.05)
              .to('.sf-final-cycle', { autoAlpha: 1, y: 0, duration: 0.55, ease: 'power2.out' }, 1.24)
              .to('.sf-final-cta', { autoAlpha: 1, y: 0, duration: 0.62, ease: 'power3.out' }, 1.42)
              .to('.sf-final-footer', { autoAlpha: 1, duration: 0.48, ease: 'power1.out' }, 1.62);
          }
          return tl;
        };

        /* 5 拍核心转场控制器：支持同幕内无缝推进（2 ↔ 3）与跨幕电影级切换 */
        const goToStep = (target: number, bypassCooldown = false) => {
          const next = Math.max(0, Math.min(4, target));
          const prev = activeStepRef.current;
          if (next === prev) return;
          const now = Date.now();
          if (!bypassCooldown && (animatingRef.current || now - lastTurnAtRef.current < 950)) {
            return;
          }

          animatingRef.current = true;
          lastTurnAtRef.current = now;
          activeTlRef.current?.kill();

          const prevPanel = STEP_META[prev].panel;
          const nextPanel = STEP_META[next].panel;
          const blobTarget = BLOB_STATES[next];

          if (prevPanel === 3 && nextPanel !== 3) handleLeaveAct4();

          activeStepRef.current = next;
          setActiveStep(next);

          /* 场景 A：幕 3 内部两拍互切（2 → 3 展开下半拍；3 → 2 优雅收起下半拍、恢复三方向平权态） */
          if (prevPanel === 2 && nextPanel === 2) {
            const innerTl = gsap.timeline({
              onComplete: () => {
                animatingRef.current = false;
              },
            });
            activeTlRef.current = innerTl;
            innerTl
              .to('.sf-bg-blob-a', { ...blobTarget.a, duration: 1.1, ease: 'power2.inOut' }, 0)
              .to('.sf-bg-blob-b', { ...blobTarget.b, duration: 1.1, ease: 'power2.inOut' }, 0);

            if (next === 3) {
              innerTl.add(buildEnterTl(3), 0.05);
            } else {
              /* 从 3 回退到 2：收起追问与调整卡，恢复三个候选方向原亮度 */
              innerTl
                .to(['.sf-conv-adjust', '.sf-conv-user2'], { autoAlpha: 0, y: 20, duration: 0.42, ease: 'power2.in' }, 0)
                .to('.sf-conv-badge', { autoAlpha: 0, scale: 0.4, duration: 0.3, ease: 'power2.in' }, 0)
                .to('.sf-conv-dim', { autoAlpha: 1, scale: 1, duration: 0.45, ease: 'power2.out' }, 0.14)
                .to('.sf-conv-pick-hint', { autoAlpha: 1, y: 0, duration: 0.4, ease: 'power2.out' }, 0.28);
            }
            innerTl.call(() => {
              animatingRef.current = false;
            }, [], 0.7);
            return;
          }

          /* 场景 B：跨幕切换 */
          const dir = next > prev ? 1 : -1;
          const prevEl = panelSel(prevPanel);
          const nextEl = panelSel(nextPanel);

          resetPanel(nextPanel);
          /* 若从第 4 幕回退到 step 3（幕 3 下半拍），或直接点进度点跳到 step 3：先把上半拍就位，再流畅播下半拍 */
          if (next === 3) {
            gsap.set('.sf-conv-user1', { autoAlpha: 1, x: 0, y: 0 });
            gsap.set('.sf-conv-ai-lead', { autoAlpha: 1, y: 0 });
            gsap.set('.sf-conv-dir', { autoAlpha: 1, y: 0, scale: 1 });
            gsap.set('.sf-conv-pick-hint', { autoAlpha: 0 });
          }

          gsap.set(nextEl, { autoAlpha: 1, y: dir * 36, scale: 0.985, force3D: true });

          const master = gsap.timeline({
            onComplete: () => {
              animatingRef.current = false;
            },
          });
          activeTlRef.current = master;

          master
            .to('.sf-bg-blob-a', { ...blobTarget.a, duration: 1.25, ease: 'power3.inOut' }, 0)
            .to('.sf-bg-blob-b', { ...blobTarget.b, duration: 1.25, ease: 'power3.inOut' }, 0)
            .to(prevEl, { autoAlpha: 0, y: -dir * 46, scale: 0.95, duration: 0.52, ease: 'power2.in' }, 0)
            .to(nextEl, { y: 0, scale: 1, duration: 0.62, ease: 'power3.out' }, 0.24)
            .add(buildEnterTl(next), 0.3);

          master.call(() => {
            animatingRef.current = false;
          }, [], 0.78);

          /* 幕 4 画框落定后立即启动舒缓往复对比演示，无需干等整幕收尾 */
          if (nextPanel === 3) {
            master.call(() => {
              act4InViewRef.current = true;
              tryStartAct4Demo();
            }, [], 1.15);
          }
        };

        goToStepRef.current = goToStep;

        /* 初始自动舒缓播完第 1 幕开场 */
        resetPanel(0);
        activeTlRef.current = buildEnterTl(0);

        /* 滚轮 & 触控监听：1 次轻滑精准推进 1 拍 */
        const observer = Observer.create({
          target: sectionRef.current,
          type: 'wheel,touch',
          wheelSpeed: 1,
          tolerance: 24,
          preventDefault: true,
          ignore: '.compare-handle',
          onDown: (self) => {
            if (Math.abs(self.deltaY) < 14) return;
            goToStep(activeStepRef.current + 1);
          },
          onUp: (self) => {
            if (Math.abs(self.deltaY) < 14) return;
            goToStep(activeStepRef.current - 1);
          },
        });

        const onKeyDown = (e: KeyboardEvent) => {
          const tag = (e.target as HTMLElement | null)?.tagName;
          if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement | null)?.isContentEditable) return;
          if (e.key === 'ArrowDown' || e.key === 'PageDown') {
            e.preventDefault();
            goToStep(activeStepRef.current + 1, true);
          } else if (e.key === 'ArrowUp' || e.key === 'PageUp') {
            e.preventDefault();
            goToStep(activeStepRef.current - 1, true);
          } else if (e.key === 'Home') {
            e.preventDefault();
            goToStep(0, true);
          } else if (e.key === 'End') {
            e.preventDefault();
            goToStep(4, true);
          }
        };
        window.addEventListener('keydown', onKeyDown);

        const onHomeTop = () => goToStep(0, true);
        window.addEventListener('sf-home-top', onHomeTop);

        /* 柔和 2.5D 鼠标微视差 */
        const blobAX = gsap.quickTo('.sf-bg-parallax-a', 'x', { duration: 0.85, ease: 'power2.out' });
        const blobAY = gsap.quickTo('.sf-bg-parallax-a', 'y', { duration: 0.85, ease: 'power2.out' });
        const blobBX = gsap.quickTo('.sf-bg-parallax-b', 'x', { duration: 0.85, ease: 'power2.out' });
        const blobBY = gsap.quickTo('.sf-bg-parallax-b', 'y', { duration: 0.85, ease: 'power2.out' });
        const wordsX = gsap.quickTo('.sf-words-parallax', 'x', { duration: 0.75, ease: 'power2.out' });
        const wordsY = gsap.quickTo('.sf-words-parallax', 'y', { duration: 0.75, ease: 'power2.out' });

        const onPointerMove = (e: PointerEvent) => {
          const nx = e.clientX / window.innerWidth - 0.5;
          const ny = e.clientY / window.innerHeight - 0.5;
          blobAX(nx * -28);
          blobAY(ny * -24);
          blobBX(nx * 30);
          blobBY(ny * 26);
          if (activeStepRef.current === 0) {
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
      {/* 全局共享动态纸面色块层 */}
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
          activePanel === 0 ? 'md:motion-safe:pointer-events-auto md:motion-safe:z-10' : 'md:motion-safe:pointer-events-none md:motion-safe:z-0'
        )}
      >
        <div className="sf-deco md:motion-safe:hidden" aria-hidden="true">
          <span className="sf-blob sf-paper-cream" style={{ top: '-12%', left: '-10%', width: '58vw', height: '58vw', minWidth: 240, minHeight: 240 }} />
          <span className="sf-blob sf-paper-purple" style={{ bottom: '-14%', right: '-12%', width: '62vw', height: '62vw', minWidth: 260, minHeight: 260 }} />
        </div>

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

        <div className="sf-words-parallax relative z-10 mt-8 md:motion-safe:absolute md:motion-safe:left-[47vw] md:motion-safe:top-[46%] md:motion-safe:mt-0 md:motion-safe:w-[45vw] md:motion-safe:max-w-[680px] md:motion-safe:-translate-y-1/2">
          <div className="sf-words flex flex-col gap-4 xl:gap-5">
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

        <div className="sf-hint relative z-10 mt-6 flex justify-center md:motion-safe:absolute md:motion-safe:bottom-6 md:motion-safe:left-1/2 md:motion-safe:mt-0 md:motion-safe:-translate-x-1/2">
          <button
            type="button"
            onClick={() => goToStepRef.current(1, true)}
            className="flex cursor-pointer items-center gap-2 rounded-full border border-border/80 bg-card/95 px-5 py-2 text-sm font-medium text-foreground/80 shadow-sm transition-colors hover:border-primary/40 hover:text-primary"
          >
            {showcase.intro.scrollHint}
            <ChevronDown className="h-4 w-4 animate-bounce text-primary" />
          </button>
        </div>
      </div>

      {/* ===== 幕2 困扰聚合 · 舒缓呼吸式弹性贴纸 ===== */}
      <div
        className={cn(
          'sf-panel-2 relative w-full px-5 py-16 md:motion-safe:absolute md:motion-safe:inset-0 md:motion-safe:h-full md:motion-safe:overflow-hidden md:motion-safe:py-0',
          activePanel === 1 ? 'md:motion-safe:pointer-events-auto md:motion-safe:z-10' : 'md:motion-safe:pointer-events-none md:motion-safe:z-0'
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
            <button
              type="button"
              onClick={() => goToStepRef.current(2, true)}
              className="sf-act2-next mt-6 hidden cursor-pointer items-center gap-1.5 rounded-full border border-border/80 bg-card/95 px-4 py-1.5 text-xs font-medium text-muted-foreground shadow-2xs transition-colors hover:border-primary/40 hover:text-primary md:motion-safe:inline-flex"
            >
              看看 AI 如何陪你梳理方向
              <ChevronDown className="h-3.5 w-3.5 text-primary" />
            </button>
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

      {/* ===== 幕3 共策过程 · 两拍互动剧场（拍 3：提方向停顿；拍 4：选定方向与调整安排） ===== */}
      <div
        className={cn(
          'sf-panel-3 relative w-full px-5 py-16 md:motion-safe:absolute md:motion-safe:inset-0 md:motion-safe:h-full md:motion-safe:overflow-hidden md:motion-safe:py-0',
          activePanel === 2 ? 'md:motion-safe:pointer-events-auto md:motion-safe:z-10' : 'md:motion-safe:pointer-events-none md:motion-safe:z-0'
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
            <div className="flex items-center justify-between gap-2">
              <p className="sf-conv-ai-lead flex items-center gap-2 text-sm font-semibold text-muted-foreground md:text-lg">
                <Sparkles className="h-4 w-4 text-primary" />
                {showcase.act3.aiLead}
              </p>
              <button
                type="button"
                onClick={() => goToStepRef.current(3, true)}
                className="sf-conv-pick-hint hidden cursor-pointer items-center gap-1.5 rounded-full border border-primary/30 bg-[#F4F5FF] px-3.5 py-1 text-xs font-semibold text-primary shadow-2xs transition-colors hover:bg-primary/15 md:motion-safe:inline-flex"
              >
                继续滚动或点此看你的选择
                <ChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="grid gap-3 md:grid-cols-3 md:gap-4">
              {showcase.act3.directions.map((d, i) => {
                const picked = i === showcase.act3.pickIndex;
                return (
                  <button
                    key={d.name}
                    type="button"
                    onClick={() => {
                      if (activeStepRef.current === 2) goToStepRef.current(3, true);
                    }}
                    className={cn(
                      'sf-conv-dir sf-card relative cursor-pointer rounded-2xl p-5 text-left md:p-6',
                      picked
                        ? 'sf-conv-picked border-2 border-primary bg-[#F4F5FF] shadow-md'
                        : 'sf-conv-dim hover:border-primary/40'
                    )}
                  >
                    <p className="font-display text-xl font-bold tracking-tight text-foreground md:text-2xl">{d.name}</p>
                    <p className="mt-2 text-sm leading-relaxed text-muted-foreground md:text-base">{d.desc}</p>
                    {picked && (
                      <span className="sf-conv-badge sf-pill-cobalt absolute -top-3 right-3 rounded-full px-3 py-0.5 text-[11px] font-semibold">
                        ✓ {showcase.act3.pickLabel}
                      </span>
                    )}
                  </button>
                );
              })}
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

      {/* ===== 幕4 看见效果 + 收尾 · 聚焦展映 + 舒缓自动对比演示 ===== */}
      <div
        className={cn(
          'sf-panel-4 relative flex w-full flex-col items-center gap-3 px-5 py-14 md:motion-safe:absolute md:motion-safe:inset-0 md:motion-safe:h-full md:motion-safe:justify-center md:motion-safe:gap-3 md:motion-safe:overflow-hidden md:motion-safe:pb-12 md:motion-safe:pt-4',
          activePanel === 3 ? 'md:motion-safe:pointer-events-auto md:motion-safe:z-10' : 'md:motion-safe:pointer-events-none md:motion-safe:z-0'
        )}
      >
        <h2 className="sf-final-title max-w-xl px-4 text-center font-display text-2xl font-black leading-[1.3] tracking-tight text-balance text-foreground md:text-4xl">
          {showcase.act4Copy.title}
        </h2>
        <div className="sf-final-canvas sf-sticker-photo w-full max-w-4xl overflow-hidden bg-white md:w-auto">
          <CompareCanvas
            ref={compareRef}
            beforeUrl={showcase.act4.beforeUrl}
            afterUrl={showcase.act4.afterUrl}
            interactive
            initial={50}
            onPosChange={(next) => {
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

      {/* ===== 桌面右侧 5 拍舞台控制器 ===== */}
      <div className="fixed right-4 top-1/2 z-20 hidden -translate-y-1/2 flex-col items-center gap-1.5 rounded-full border border-border/70 bg-card/85 px-1.5 py-2 shadow-sm backdrop-blur-sm md:motion-safe:flex">
        <button
          type="button"
          aria-label="上一拍"
          disabled={activeStep === 0}
          onClick={() => goToStepRef.current(activeStep - 1, true)}
          className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-25"
        >
          <ChevronUp className="h-3.5 w-3.5" />
        </button>
        {STEP_META.map((step, i) => (
          <button
            key={step.label}
            type="button"
            title={step.label}
            aria-label={step.label}
            onClick={() => goToStepRef.current(i, true)}
            className="group flex h-4 w-4 items-center justify-center rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            <span
              className={cn(
                'rounded-full transition-all duration-300 group-hover:bg-primary/70',
                activeStep === i ? 'h-4 w-2 bg-primary' : 'h-2 w-2 bg-muted-foreground/35'
              )}
            />
          </button>
        ))}
        <button
          type="button"
          aria-label="下一拍"
          disabled={activeStep === 4}
          onClick={() => goToStepRef.current(activeStep + 1, true)}
          className="flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary disabled:opacity-25"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>
    </section>
  );
}
