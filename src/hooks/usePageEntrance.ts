import type { RefObject } from 'react';
import { useGSAP } from '@gsap/react';
import gsap from 'gsap';

gsap.registerPlugin(useGSAP);

/**
 * 内页统一轻盈动效：
 * 1) 页头与卡片错落轻入场（短促利落不拖沓，尊重 prefers-reduced-motion）
 * 2) 背景淡彩纸面色块随鼠标柔和 2.5D 微视差（复用首页同款活体纸面呼吸感）
 */
export function usePageEntrance(scopeRef: RefObject<HTMLElement | null>) {
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add('(prefers-reduced-motion: no-preference)', () => {
        const heroes = gsap.utils.toArray<HTMLElement>('.sf-reveal-hero');
        if (heroes.length > 0) {
          gsap.fromTo(
            heroes,
            { y: 18, autoAlpha: 0 },
            { y: 0, autoAlpha: 1, duration: 0.55, stagger: 0.07, ease: 'power3.out', clearProps: 'transform' }
          );
        }

        const items = gsap.utils.toArray<HTMLElement>('.sf-reveal-item');
        if (items.length > 0) {
          gsap.fromTo(
            items.slice(0, 12),
            { y: 22, autoAlpha: 0 },
            { y: 0, autoAlpha: 1, duration: 0.52, stagger: 0.045, delay: 0.12, ease: 'power2.out', clearProps: 'transform' }
          );
        }

        /* 桌面端背景纸面色块柔和微视差 */
        if (window.innerWidth >= 768) {
          const blobs = gsap.utils.toArray<HTMLElement>('.sf-deco .sf-blob');
          if (blobs.length > 0) {
            const movers = blobs.map((el, idx) => ({
              x: gsap.quickTo(el, 'x', { duration: 0.9, ease: 'power2.out' }),
              y: gsap.quickTo(el, 'y', { duration: 0.9, ease: 'power2.out' }),
              dir: idx % 2 === 0 ? -1 : 1,
            }));
            const onMove = (e: PointerEvent) => {
              const nx = e.clientX / window.innerWidth - 0.5;
              const ny = e.clientY / window.innerHeight - 0.5;
              movers.forEach((m) => {
                m.x(nx * 24 * m.dir);
                m.y(ny * 20 * m.dir);
              });
            };
            window.addEventListener('pointermove', onMove, { passive: true });
            return () => window.removeEventListener('pointermove', onMove);
          }
        }
      });
    },
    { scope: scopeRef }
  );
}
