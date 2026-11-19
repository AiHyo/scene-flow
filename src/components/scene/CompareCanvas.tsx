import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from 'react';
import { ChevronsLeftRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface CompareCanvasHandle {
  setPos: (pos: number) => void;
}

interface CompareCanvasProps {
  beforeUrl: string;
  afterUrl: string;
  className?: string;
  /** 初始分割位置（0-100） */
  initial?: number;
  /** 外部直接控制分割位置（0-100，受控模式） */
  pos?: number;
  /** 是否允许拖拽（首页展示动画时为 false，由外部 setPos 驱动） */
  interactive?: boolean;
  labels?: [string, string];
  /** 分割位置变化回调（拖拽/键盘），供持久化（调用方自行防抖） */
  onPosChange?: (pos: number) => void;
  /** 用户主动交互回调（PointerDown、KeyDown、点击等），用于中断自动演示动画 */
  onUserInteract?: () => void;
  /** 图片加载完成回调（before 与 after 均已加载） */
  onImagesLoaded?: () => void;
}

/** 前后对比画布：底层 after 铺满，上层 before 用 clip-path 裁切，拖动只改裁切比例 */
const CompareCanvas = forwardRef<CompareCanvasHandle, CompareCanvasProps>(
  (
    {
      beforeUrl,
      afterUrl,
      className,
      initial = 50,
      pos: propPos,
      interactive = true,
      labels = ['布置前', '布置后'],
      onPosChange,
      onUserInteract,
      onImagesLoaded,
    },
    ref
  ) => {
    const isControlled = typeof propPos === 'number';
    const initialPos = isControlled ? propPos : initial;
    const posRef = useRef(initialPos);

    const containerRef = useRef<HTMLDivElement>(null);
    const beforeClipRef = useRef<HTMLDivElement>(null);
    const dividerRef = useRef<HTMLDivElement>(null);
    const handleRef = useRef<HTMLButtonElement>(null);
    const dragging = useRef(false);
    const loadedRef = useRef({ before: false, after: false });

    /** 直接更新 DOM 裁切与手柄位置，避免 60/120fps 动画或拖拽时触发整棵 React 树重渲染 */
    const paintPos = useCallback((p: number) => {
      posRef.current = p;
      if (beforeClipRef.current) {
        beforeClipRef.current.style.clipPath = `inset(0 ${100 - p}% 0 0)`;
      }
      if (dividerRef.current) {
        dividerRef.current.style.left = `${p}%`;
      }
      if (handleRef.current) {
        handleRef.current.style.left = `${p}%`;
        handleRef.current.setAttribute('aria-valuenow', String(Math.round(p)));
        handleRef.current.setAttribute('aria-valuetext', `分割位置 ${Math.round(p)}%`);
      }
    }, []);

    useEffect(() => {
      if (isControlled && typeof propPos === 'number') {
        paintPos(propPos);
      }
    }, [isControlled, propPos, paintPos]);

    const notifyLoaded = useCallback(() => {
      if (loadedRef.current.before && loadedRef.current.after) {
        onImagesLoaded?.();
      }
    }, [onImagesLoaded]);

    useEffect(() => {
      if (containerRef.current) {
        const imgs = containerRef.current.querySelectorAll('img');
        if (imgs.length >= 2 && imgs[0].complete && imgs[1].complete) {
          loadedRef.current.before = true;
          loadedRef.current.after = true;
          onImagesLoaded?.();
        }
      }
    }, [beforeUrl, afterUrl, onImagesLoaded]);

    /** 更新分割位置并通知外部（持久化由调用方防抖处理） */
    const applyPos = useCallback(
      (next: number) => {
        const clamped = Math.min(98, Math.max(2, next));
        paintPos(clamped);
        onPosChange?.(clamped);
      },
      [paintPos, onPosChange]
    );

    const updateFromClientX = useCallback(
      (clientX: number) => {
        const el = containerRef.current;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        const next = ((clientX - rect.left) / rect.width) * 100;
        applyPos(next);
      },
      [applyPos]
    );

    useEffect(() => {
      if (!interactive) return;
      const onMove = (e: PointerEvent) => {
        if (!dragging.current) return;
        e.preventDefault();
        updateFromClientX(e.clientX);
      };
      const onUp = () => {
        dragging.current = false;
      };
      window.addEventListener('pointermove', onMove, { passive: false });
      window.addEventListener('pointerup', onUp);
      return () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
      };
    }, [interactive, updateFromClientX]);

    useImperativeHandle(
      ref,
      () => ({
        setPos: (p: number) => {
          const clamped = Math.min(98, Math.max(2, p));
          paintPos(clamped);
          onPosChange?.(clamped);
        },
      }),
      [paintPos, onPosChange]
    );

    return (
      <div
        ref={containerRef}
        className={cn('relative select-none overflow-hidden bg-muted', className)}
        style={{ touchAction: interactive ? 'none' : 'auto' }}
        onClick={(e) => {
          if (interactive && !dragging.current) {
            onUserInteract?.();
            updateFromClientX(e.clientX);
          }
        }}
      >
        {/* 底层：布置后 */}
        <img
          src={afterUrl}
          alt={labels[1]}
          className="absolute inset-0 h-full w-full object-cover"
          draggable={false}
          onLoad={(e) => {
            /* 空白/占位图兜底：上游可能返回 1px 透明占位图，此时隐藏本层避免右侧整块空白 */
            const img = e.currentTarget;
            if (img.naturalWidth < 2 || img.naturalHeight < 2) {
              img.style.visibility = 'hidden';
              return;
            }
            loadedRef.current.after = true;
            notifyLoaded();
          }}
          onError={(e) => {
            /* 加载失败同样不渲染空白，交由上层提示 */
            (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
          }}
        />
        {/* 上层：布置前（clip-path 裁切，只改裁切不动图） */}
        <div
          ref={beforeClipRef}
          className="absolute inset-0 overflow-hidden will-change-[clip-path]"
          style={{ clipPath: `inset(0 ${100 - posRef.current}% 0 0)` }}
        >
          <img
            src={beforeUrl}
            alt={labels[0]}
            className="absolute inset-0 h-full w-full object-cover"
            draggable={false}
            onLoad={(e) => {
              const img = e.currentTarget;
              if (img.naturalWidth < 2 || img.naturalHeight < 2) {
                img.style.visibility = 'hidden';
                return;
              }
              loadedRef.current.before = true;
              notifyLoaded();
            }}
            onError={(e) => {
              (e.currentTarget as HTMLImageElement).style.visibility = 'hidden';
            }}
          />
        </div>
        {/* 分割线 */}
        <div
          ref={dividerRef}
          className="pointer-events-none absolute inset-y-0 z-10 w-0.5 bg-white/90 shadow-[0_0_8px_rgba(0,0,0,0.4)] will-change-[left]"
          style={{ left: `${posRef.current}%` }}
        />
        {interactive && (
          <button
            ref={handleRef}
            type="button"
            role="slider"
            aria-label="对比分割线，可用左右方向键调整"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(posRef.current)}
            aria-valuetext={`分割位置 ${Math.round(posRef.current)}%`}
            className="compare-handle absolute top-1/2 z-20 flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full border border-black/10 bg-white/95 text-foreground shadow-lg backdrop-blur transition-transform will-change-[left] hover:scale-105 active:scale-95"
            style={{ left: `${posRef.current}%`, touchAction: 'none' }}
            onPointerDown={(e) => {
              onUserInteract?.();
              dragging.current = true;
              (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
            }}
            onKeyDown={(e) => {
              onUserInteract?.();
              if (e.key === 'ArrowLeft') {
                e.preventDefault();
                applyPos(Math.max(2, posRef.current - 5));
              } else if (e.key === 'ArrowRight') {
                e.preventDefault();
                applyPos(Math.min(98, posRef.current + 5));
              }
            }}
          >
            <ChevronsLeftRight className="h-5 w-5" />
          </button>
        )}
        {/* 标签 */}
        <span className="absolute left-3 top-3 z-10 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm">
          {labels[0]}
        </span>
        <span className="absolute right-3 top-3 z-10 rounded-full bg-black/60 px-2.5 py-1 text-xs font-medium text-white backdrop-blur-sm">
          {labels[1]}
        </span>
      </div>
    );
  },
);

CompareCanvas.displayName = 'CompareCanvas';

export default CompareCanvas;
