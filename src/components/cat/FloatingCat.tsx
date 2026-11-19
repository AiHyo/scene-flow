import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { ASSETS } from '@/data/assets';
import { useAiCat } from '@/contexts/AiCatContext';
import { useModalOpen } from '@/hooks/useModalOpen';

/**
 * 轻量悬浮小猫 AI 助手（统一形象：白色小猫·紫围巾）
 * - 外层(gsap)负责页面内缓慢随机移动，内层(.ai-cat-idle)负责轻微浮动/倾斜，二者分离不争用 transform
 * - 悬停立即暂停当前位移（gsap.pause 真正停住），离开约 0.8s 后从当前位置继续
 * - 触屏不游走固定边缘；系统减少动态时静态显示；页面进后台暂停动画
 * - 全屏透明容器 pointer-events-none，仅角色与气泡可交互；不遮挡顶部导航与模态弹窗
 */

const DESKTOP_SIZE = 82; // 桌面 3D 小猫约 82px，细节与护目镜清晰可辨
const MOBILE_SIZE = 58; // 移动端收敛为 58px，减少遮挡
const MARGIN = 14;
const NAV_CLEAR = 84; // 顶部导航高度 + 留白

const catSizeOf = () => (typeof window !== 'undefined' && window.innerWidth < 768 ? MOBILE_SIZE : DESKTOP_SIZE);
const SHOW_ROUTES = ['/', '/inspiration', '/cases', '/scene', '/plaza', '/resources', '/projects'];
const HIDE_ROUTE_PREFIX = ['/plan', '/workbench', '/preview'];

function random(min: number, max: number) {
  return min + Math.random() * (max - min);
}

export default function FloatingCat() {
  const navigate = useNavigate();
  const location = useLocation();

  const { visible: catVisible, setVisible: setCatVisible } = useAiCat();
  const hiddenPref = !catVisible;
  const [hover, setHover] = useState(false);
  const [confirmHide, setConfirmHide] = useState(false); // 气泡内「隐藏助手」二次确认
  const [touchMode, setTouchMode] = useState(false);

  const outerRef = useRef<HTMLDivElement>(null); // 外层：位移
  const innerRef = useRef<HTMLDivElement>(null); // 内层：浮动/倾斜
  const bubbleRef = useRef<HTMLDivElement>(null); // 气泡（用于悬停命中判定）
  /* 拖拽：按下原点 + 抓取偏移 + 是否已构成拖动 + 松手前速度采样（EMA 平滑，px/ms） */
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    offX: number;
    offY: number;
    moved: boolean;
    lx: number;
    ly: number;
    lt: number;
    vx: number;
    vy: number;
  } | null>(null);
  const hold = useRef(false); // 按下/滑行期间阻止游走循环启动新一步
  const afterDrag = useRef(false); // 拖拽刚结束：需先移出再移入才恢复气泡
  const suppressClick = useRef(false); // 拖拽松手后吞掉本次 click
  const waitTimerRef = useRef<number | null>(null); // 游走循环的停留计时（拖拽/滑行接管时清掉）
  const glideRef = useRef<{ kill: () => void } | null>(null); // 惯性滑行 tween
  const stepRef = useRef<(() => void) | null>(null); // 游走循环 step（惯性结束后重启用）
  const [dragging, setDragging] = useState(false);
  const lastMouse = useRef<{ x: number; y: number } | null>(null); // 最近一次鼠标位置（宽限期复核用）
  const resumeTimer = useRef<number | null>(null);
  const mounted = useRef(true);

  const reduceMotion = useRef(false);
  const touchDevice = useRef(false);

  const routeKey = location.pathname;
  const routeVisible =
    SHOW_ROUTES.includes(routeKey) || SHOW_ROUTES.some((r) => r !== '/' && routeKey.startsWith(r + '/'));
  const immersiveHidden = HIDE_ROUTE_PREFIX.some((p) => routeKey.startsWith(p));

  /* 模态弹窗（登录/大图/发布等）打开时隐藏，避免遮挡 */
  const modalOpen = useModalOpen();
  const [visible, setVisible] = useState(false);

  /* 最终是否渲染：路由可见 & 无沉浸隐藏 & 未记隐藏 & 模态未开 */
  const shouldRender = routeVisible && !immersiveHidden && !hiddenPref && !modalOpen;

  /* 能力检测：减少动态 / 触屏 */
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    reduceMotion.current = mq.matches;
    const onChange = (e: MediaQueryListEvent) => {
      reduceMotion.current = e.matches;
    };
    mq.addEventListener('change', onChange);
    touchDevice.current = window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
    return () => mq.removeEventListener('change', onChange);
  }, []);

  /* 页面进后台暂停动画，回前台恢复 */
  useEffect(() => {
    const onVis = () => {
      const el = innerRef.current;
      if (!el) return;
      if (document.hidden) el.style.animationPlayState = 'paused';
      else if (!hover) el.style.animationPlayState = 'running';
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, [hover]);

  /* 卸载清理 */
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (resumeTimer.current) window.clearTimeout(resumeTimer.current);
    };
  }, []);

  const bounds = useCallback(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const size = catSizeOf();
    return {
      minX: MARGIN,
      maxX: Math.max(MARGIN, vw - size - MARGIN),
      minY: NAV_CLEAR,
      maxY: Math.max(NAV_CLEAR, vh - size - MARGIN),
    };
  }, []);

  /* 选择落点：宽屏仅在主内容区外侧留白通道与底边安全带之间游走，不横穿正文/标题区 */
  const sideRef = useRef<'left' | 'right'>('right');
  const pickTarget = useCallback(() => {
    const b = bounds();
    const vw = window.innerWidth;
    const size = catSizeOf();
    const contentWidth = 1152; // 对齐 max-w-6xl 主内容容器
    const gutter = (vw - contentWidth) / 2;

    if (gutter >= size + MARGIN * 2) {
      // 宽屏两侧有充足留白：沿当前侧边通道纵向游走（不斜穿屏幕中心）
      const x =
        sideRef.current === 'left'
          ? random(b.minX, Math.max(b.minX, gutter - size - MARGIN))
          : random(Math.min(b.maxX, vw - gutter + MARGIN), b.maxX);
      const y = random(Math.min(b.maxY, b.minY + 140), Math.max(b.minY + 140, b.maxY - 24));
      return { x, y };
    }

    // 中屏/窄屏无宽裕侧边留白：沿右下底边安全区轻量巡游，避开正中与顶部标题/按钮
    const minRightX = Math.max(b.minX, b.maxX - (vw < 768 ? 56 : 160));
    const x = random(minRightX, b.maxX);
    const y = random(Math.max(b.minY + 140, b.maxY - (vw < 768 ? 20 : 80)), b.maxY);
    return { x, y };
  }, [bounds]);

  /* 外层移动主循环：5–9s 移动到落点 → 停 4–8s → 再移动（悬停时真正暂停） */
  const gsapRef = useRef<{ to: (...a: unknown[]) => { pause: () => void; resume: () => void; kill: () => void }; set: (...a: unknown[]) => void; getProperty: (t: Element, p: string) => number } | null>(null);
  const tweenRef = useRef<{ pause: () => void; resume: () => void; kill: () => void } | null>(null);
  useEffect(() => {
    if (!shouldRender || reduceMotion.current || touchMode) return;
    const outer = outerRef.current;
    if (!outer) return;

    let disposed = false;
    let waitTimer: number | null = null;

    void import('gsap').then((mod) => {
      if (disposed || !mounted.current) return;
      const gsap = (mod.gsap ?? mod) as NonNullable<typeof gsapRef.current>;
      gsapRef.current = gsap;
      const start = pickTarget();
      gsap.set(outer, { x: start.x, y: start.y });

      const step = () => {
        if (disposed || !mounted.current) return;
        if (hold.current) {
          /* 按下期间触发：稍后重试，避免循环永久停摆 */
          waitTimer = window.setTimeout(step, 1500);
          waitTimerRef.current = waitTimer;
          return;
        }
        const t = pickTarget();
        const tw = gsap.to(outer, {
          x: t.x,
          y: t.y,
          duration: random(5, 9),
          ease: 'sine.inOut',
          onComplete: () => {
            if (hold.current) return;
            waitTimer = window.setTimeout(step, random(4, 8) * 1000);
            waitTimerRef.current = waitTimer;
          },
        });
        tweenRef.current = tw;
      };
      stepRef.current = step;
      waitTimer = window.setTimeout(step, random(4, 8) * 1000);
      waitTimerRef.current = waitTimer;

      /* 窗口缩放后重新限制坐标，防跑出屏幕 */
      const onResize = () => {
        if (disposed || !outer) return;
        const bb = bounds();
        const x = Number(gsap.getProperty(outer, 'x'));
        const y = Number(gsap.getProperty(outer, 'y'));
        gsap.set(outer, {
          x: Math.min(Math.max(x, bb.minX), bb.maxX),
          y: Math.min(Math.max(y, bb.minY), bb.maxY),
        });
      };
      window.addEventListener('resize', onResize);
      cleanupResize = () => window.removeEventListener('resize', onResize);
    });

    let cleanupResize: (() => void) | undefined;
    return () => {
      disposed = true;
      stepRef.current = null;
      tweenRef.current?.kill();
      tweenRef.current = null;
      if (waitTimer) window.clearTimeout(waitTimer);
      cleanupResize?.();
    };
  }, [shouldRender, touchMode, bounds, pickTarget]);

  /* 触屏模式：固定右下安全边缘，不游走 */
  useEffect(() => {
    if (!shouldRender || !touchMode || reduceMotion.current) return;
    const outer = outerRef.current;
    if (!outer) return;
    const b = bounds();
    const g = gsapRef.current;
    if (g) g.set(outer, { x: b.maxX, y: b.maxY });
    else outer.style.transform = `translate(${b.maxX}px, ${b.maxY}px)`;
  }, [shouldRender, touchMode, bounds]);

  /* 进入视口淡入 */
  useEffect(() => {
    if (shouldRender) {
      const t = window.setTimeout(() => setVisible(true), 60);
      return () => window.clearTimeout(t);
    }
    setVisible(false);
  }, [shouldRender]);

  /* 气泡收起后重置二次确认，下次打开回到初始态 */
  useEffect(() => {
    if (!hover) setConfirmHide(false);
  }, [hover]);

  /* 命中判定：小猫 + 气泡的整体包围盒（含两者之间的空白间隙）都算悬停区域 */
  const hitTest = useCallback((x: number, y: number) => {
    const cat = outerRef.current?.getBoundingClientRect();
    const bub = bubbleRef.current?.getBoundingClientRect();
    if (!cat && !bub) return false;
    const minX = Math.min(cat?.left ?? Number.POSITIVE_INFINITY, bub?.left ?? Number.POSITIVE_INFINITY);
    const minY = Math.min(cat?.top ?? Number.POSITIVE_INFINITY, bub?.top ?? Number.POSITIVE_INFINITY);
    const maxX = Math.max(cat?.right ?? Number.NEGATIVE_INFINITY, bub?.right ?? Number.NEGATIVE_INFINITY);
    const maxY = Math.max(cat?.bottom ?? Number.NEGATIVE_INFINITY, bub?.bottom ?? Number.NEGATIVE_INFINITY);
    return x >= minX && x <= maxX && y >= minY && y <= maxY;
  }, []);

  /* 悬停：立即暂停外层位移并显示气泡，取消任何待收起计时 */
  const pause = useCallback(() => {
    setHover(true);
    if (resumeTimer.current) {
      window.clearTimeout(resumeTimer.current);
      resumeTimer.current = null;
    }
    tweenRef.current?.pause(); // 真正暂停当前运动，不只是停下一次计时
  }, []);

  /* 离开：气泡收起与恢复移动都延迟 0.8s（宽限期内鼠标回到区域则由 pause 取消）；
     超时后复核最近鼠标位置，避免 blur 等边界误收起 */
  const resume = useCallback(() => {
    if (resumeTimer.current) window.clearTimeout(resumeTimer.current);
    resumeTimer.current = window.setTimeout(() => {
      resumeTimer.current = null;
      const m = lastMouse.current;
      if (m && hitTest(m.x, m.y)) return; // 鼠标实际仍在区域内，保持悬停
      setHover(false);
      tweenRef.current?.resume(); // 从当前位置继续
    }, 800);
  }, [hitTest]);

  const goPlan = useCallback(() => {
    navigate('/plan');
  }, [navigate]);

  /* 悬停判定：document 级 mousemove + 整体包围盒命中（间隙也算），
     绕开 React 合成事件与 gsap transform 导致的 enter/leave 抖动 */
  useEffect(() => {
    if (!shouldRender || touchDevice.current) return;
    let inside = false;
    const onMove = (e: MouseEvent) => {
      lastMouse.current = { x: e.clientX, y: e.clientY };
      if (dragRef.current) return; // 拖拽中不判定悬停、不弹气泡
      if (afterDrag.current) {
        /* 刚拖完：鼠标移出整体区域后才恢复悬停气泡 */
        if (!hitTest(e.clientX, e.clientY)) afterDrag.current = false;
        return;
      }
      const nowInside = hitTest(e.clientX, e.clientY);
      if (nowInside !== inside) {
        inside = nowInside;
        if (inside) pause();
        else resume();
      }
    };
    document.addEventListener('mousemove', onMove);
    return () => document.removeEventListener('mousemove', onMove);
  }, [shouldRender, pause, resume, hitTest]);

  /* 读取小猫当前位置（gsap transform 优先，兜底解析 style） */
  const currentPos = useCallback(() => {
    const outer = outerRef.current;
    if (!outer) return { x: MARGIN, y: NAV_CLEAR };
    const g = gsapRef.current;
    if (g) return { x: Number(g.getProperty(outer, 'x')), y: Number(g.getProperty(outer, 'y')) };
    const m = /translate\(([-\d.]+)px,\s*([-\d.]+)px\)/.exec(outer.style.transform);
    return m ? { x: Number(m[1]), y: Number(m[2]) } : { x: MARGIN, y: NAV_CLEAR };
  }, []);

  /* 按下：暂停游走并准备拖拽（还未构成拖动时松手 = 普通点击） */
  const onPointerDown = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const outer = outerRef.current;
    if (!outer) return;
    const rect = outer.getBoundingClientRect();
    const orig = currentPos();
    dragRef.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origX: orig.x,
      origY: orig.y,
      offX: e.clientX - rect.left,
      offY: e.clientY - rect.top,
      moved: false,
      lx: e.clientX,
      ly: e.clientY,
      lt: performance.now(),
      vx: 0,
      vy: 0,
    };
    hold.current = true;
    tweenRef.current?.pause();
    /* 滑行中再按住：立即停止惯性，从当前位置接续拖动 */
    glideRef.current?.kill();
    glideRef.current = null;
    e.currentTarget.setPointerCapture(e.pointerId);
  }, [currentPos]);

  /* 拖动：跟随指针并限制在可视区内（顶部避开导航） */
  const onPointerMove = useCallback((e: React.PointerEvent<HTMLButtonElement>) => {
    const d = dragRef.current;
    const outer = outerRef.current;
    if (!d || d.pointerId !== e.pointerId || !outer) return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) > 6) {
      d.moved = true;
      setDragging(true);
      /* 构成拖动：彻底停掉游走循环，松手后留在原地 */
      tweenRef.current?.kill();
      tweenRef.current = null;
      if (waitTimerRef.current) {
        window.clearTimeout(waitTimerRef.current);
        waitTimerRef.current = null;
      }
    }
    if (!d.moved) return;
    /* 速度采样：指数平滑，避免末端抖动决定滑行方向 */
    const now = performance.now();
    const dt = Math.max(1, now - d.lt);
    const ivx = (e.clientX - d.lx) / dt;
    const ivy = (e.clientY - d.ly) / dt;
    d.vx = d.vx * 0.6 + ivx * 0.4;
    d.vy = d.vy * 0.6 + ivy * 0.4;
    d.lx = e.clientX;
    d.ly = e.clientY;
    d.lt = now;
    const b = bounds();
    const x = Math.min(Math.max(e.clientX - d.offX, b.minX), b.maxX);
    const y = Math.min(Math.max(e.clientY - d.offY, b.minY), b.maxY);
    const g = gsapRef.current;
    if (g) g.set(outer, { x, y });
    else outer.style.transform = `translate(${x}px, ${y}px)`;
  }, [bounds]);

  /* 惯性滑行：按松手速度沿原方向短距离减速滑行（200–400ms），慢速基本停在原地；
     目标点先钳制在可视区内，到边自然平滑停住；结束后短暂停留再恢复自主游走 */
  const GLIDE_MIN_SPEED = 0.1; // px/ms，低于此速度不滑行
  const GLIDE_MAX_DIST = 140;
  const glideAfterRelease = useCallback(
    (vx: number, vy: number) => {
      const outer = outerRef.current;
      const g = gsapRef.current;
      if (!outer || !g) {
        setDragging(false);
        return;
      }
      const speed = Math.hypot(vx, vy);
      const finish = () => {
        glideRef.current = null;
        hold.current = false; // 松手后不再按住，允许游走恢复
        setDragging(false);
        /* 短暂停留后恢复自主移动 */
        if (waitTimerRef.current) window.clearTimeout(waitTimerRef.current);
        waitTimerRef.current = window.setTimeout(() => {
          waitTimerRef.current = null;
          if (!hold.current && !dragRef.current) stepRef.current?.();
        }, random(1.5, 3) * 1000);
      };
      if (speed < GLIDE_MIN_SPEED) {
        finish();
        return;
      }
      const dist = Math.min(speed * 130, GLIDE_MAX_DIST);
      const dur = Math.min(400, Math.max(200, 180 + speed * 220));
      const b = bounds();
      const cur = currentPos();
      const tx = Math.min(Math.max(cur.x + (vx / speed) * dist, b.minX), b.maxX);
      const ty = Math.min(Math.max(cur.y + (vy / speed) * dist, b.minY), b.maxY);
      const tw = g.to(outer, {
        x: tx,
        y: ty,
        duration: dur / 1000,
        ease: 'power2.out',
        onComplete: finish,
      });
      glideRef.current = tw;
    },
    [bounds, currentPos]
  );

  /* 松手：拖动过 → 惯性滑行并吞掉 click；未拖动 → 恢复游走，click 正常执行原功能 */
  const endDrag = useCallback(
    (e: React.PointerEvent<HTMLButtonElement>, cancelled: boolean) => {
      const d = dragRef.current;
      dragRef.current = null;
      if (!d || d.pointerId !== e.pointerId) {
        hold.current = false;
        return;
      }
      if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      if (cancelled) {
        hold.current = false;
        setDragging(false);
        return;
      }
      if (d.moved) {
        afterDrag.current = true;
        suppressClick.current = true;
        glideAfterRelease(d.vx, d.vy);
      } else {
        hold.current = false;
        tweenRef.current?.resume();
      }
    },
    [glideAfterRelease]
  );

  const doHide = useCallback(() => {
    setConfirmHide(false);
    setCatVisible(false);
    toast('已隐藏 AI 助手，可点头像菜单 →「显示 AI 助手」重新召唤');
  }, [setCatVisible]);

  /* 拖拽期间禁止选中页面文字 */
  useEffect(() => {
    if (!dragging) return;
    document.body.style.userSelect = 'none';
    return () => {
      document.body.style.userSelect = '';
    };
  }, [dragging]);

  /* 键盘聚焦等同悬停 */
  const onFocus = useCallback(() => pause(), [pause]);
  const onBlur = useCallback(() => resume(), [resume]);

  const [catSize, setCatSize] = useState(catSizeOf);
  useEffect(() => {
    const onResizeSize = () => setCatSize(catSizeOf());
    window.addEventListener('resize', onResizeSize);
    return () => window.removeEventListener('resize', onResizeSize);
  }, []);

  if (!shouldRender) return null;

  const interactive = hover && !dragging;

  return (
    <div className="pointer-events-none fixed inset-0 z-30" aria-hidden={!interactive}>
      {/* 外层：位移（transform 由 gsap 控制） */}
      <div
        ref={outerRef}
        className="pointer-events-none absolute left-0 top-0"
        style={{ width: catSize, height: catSize }}
      >
        <div
          ref={innerRef}
          className={`ai-cat-idle ${hover ? 'ai-cat-paused' : ''} ${visible ? 'opacity-100' : 'opacity-0'} transition-opacity duration-500`}
        >
          {/* 角色本体：可交互 */}
          <button
            type="button"
            aria-label="AI 策划伙伴，可点击开始策划，也可按住拖到喜欢的位置"
            onFocus={onFocus}
            onBlur={onBlur}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={(e) => endDrag(e, false)}
            onPointerCancel={(e) => endDrag(e, true)}
            onClick={() => {
              if (suppressClick.current) {
                suppressClick.current = false;
                return; // 刚完成拖拽，不触发跳转
              }
              if (touchDevice.current && !hover) {
                setTouchMode(true);
                pause();
                return;
              }
              goPlan();
            }}
            className="pointer-events-auto block h-full w-full cursor-grab rounded-full outline-none active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
            style={{ background: 'transparent', border: 'none', padding: 0, touchAction: 'none' }}
          >
            <img
              src={ASSETS.aiCat.full}
              alt=""
              width={catSize}
              height={catSize}
              draggable={false}
              className="h-full w-full select-none object-contain"
            />
          </button>

          {/* 气泡：悬停/聚焦/触屏点按时显示 */}
          {interactive && (
            <div
              ref={bubbleRef}
              onMouseDown={(e) => e.stopPropagation()}
              className="ai-cat-bubble pointer-events-auto absolute bottom-full right-0 mb-3 w-56 rounded-xl border bg-card p-3 text-left shadow-lg"
            >
              <p className="text-sm font-medium leading-snug">有个活动想法？和我一起策划吧。</p>
              {confirmHide ? (
                <div className="mt-2.5">
                  <p className="text-xs text-muted-foreground">确定隐藏小猫助手吗？之后可从头像菜单随时召回。</p>
                  <div className="mt-2 flex items-center gap-2">
                    <Button size="sm" variant="secondary" className="flex-1" onClick={doHide}>
                      确定隐藏
                    </Button>
                    <Button size="sm" variant="ghost" className="flex-1" onClick={() => setConfirmHide(false)}>
                      取消
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="mt-2.5 flex items-center gap-2">
                  <Button size="sm" className="flex-1" onClick={goPlan} aria-label="开始策划">
                    开始策划
                  </Button>
                  <button
                    type="button"
                    onClick={() => setConfirmHide(true)}
                    className="shrink-0 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    隐藏助手
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
