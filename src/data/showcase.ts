import { ASSETS } from '@/data/assets';

/**
 * 首页 GSAP 文字舞台内容（四幕叙事）：
 * 熟悉的活动 → 实际困扰 → AI 建议与用户选择 → 调整方案 → 看见布置效果并继续迭代。
 * 词库按阶段选用，通过大小、颜色、位置与运动区分主次。
 */

export const showcase = {
  /** 末幕同场地前后对比（annual 同一组图，保证「同一场地」真实成立） */
  act4: {
    beforeUrl: ASSETS.venue.annual.before,
    afterUrl: ASSETS.venue.annual.after,
    /** 效果图相对空置原场地真实新增的元素（与场景页示例同一核对结果） */
    added: ['圆桌与座椅', '紫色背景板', '白色桌布', '花卉装饰', '点燃的蜡烛'],
  },

  /**
   * 第一幕：动态文字海报。主标题两行（舞台中部偏左）+ 活动词群（中部偏右，整体覆盖约八成舞台宽）。
   * 三层级：主标题最强 → 主要活动词（色块+大字错位）→ 其他活动与筹备事项补充构图。
   * 坐标为词群容器内百分比，无旋转（保证中文字形清晰、不叠压）。
   */
  intro: {
    brand: 'SceneFlow AI',
    brandTag: '与 AI 共同策划',
    lineA: '这场活动',
    lineB: '你来定义。',
    sub: '找灵感、聊想法、看效果。AI提供建议，你来选择和调整。',
    scrollHint: '向下，看一次共同策划',
    /* tier: major=主要活动贴纸层级 / aux=轻盈补充词 */
    words: [
      { t: '公司团建', tier: 'major', style: 'cobalt', tilt: 'md:motion-safe:-rotate-3', size: 'text-3xl xl:text-4xl', pos: { top: '4%', left: '2%' } },
      { t: '生日派对', tier: 'major', style: 'amber', tilt: 'md:motion-safe:rotate-3', size: 'text-2xl xl:text-3xl', pos: { top: '9%', left: '54%' } },
      { t: '企业年会', tier: 'major', style: 'bold', tilt: 'md:motion-safe:rotate-1', size: 'text-5xl xl:text-6xl', pos: { top: '23%', left: '22%' } },
      { t: '户外沙龙', tier: 'major', style: 'mint', tilt: 'md:motion-safe:rotate-2', size: 'text-2xl xl:text-3xl', pos: { top: '81%', left: '12%' } },
      { t: '校园市集', tier: 'aux', style: 'soft', tilt: 'md:motion-safe:-rotate-2', size: 'text-base xl:text-lg', pos: { top: '84%', left: '60%' } },
    ] as Array<{
      t: string;
      tier: 'major' | 'aux';
      style: 'cobalt' | 'amber' | 'mint' | 'bold' | 'soft';
      tilt?: string;
      size: string;
      pos: Record<string, string>;
    }>,
    /* 现代圆角白边实景场地贴图（FigJam 轻拟物贴纸感，随开场交错入场） */
    stickers: [
      {
        src: ASSETS.inspiration.dopamine,
        alt: '多巴胺主题派对空间',
        tag: '主题布置',
        tilt: '-rotate-3',
        pos: { top: '43%', left: '3%' },
      },
      {
        src: ASSETS.venue.annual.after,
        alt: '暖光宴会布置实景',
        tag: '实景光影',
        tilt: 'rotate-2',
        pos: { top: '46%', left: '49%' },
      },
    ] as Array<{
      src: string;
      alt: string;
      tag: string;
      tilt: string;
      pos: Record<string, string>;
    }>,
    /* 具体筹备事项：轻盈点缀在留白角落 */
    preps: [
      { t: '签到 · 茶歇', pos: { top: '1%', left: '58%' } },
      { t: '破冰互动', pos: { top: '33%', left: '2%' } },
      { t: '拍照区 · 动线', pos: { top: '94%', left: '36%' } },
    ] as Array<{ t: string; pos: Record<string, string> }>,
  },

  /** 第二幕：困扰聚合。中心问题 + 10 个真实痛点围绕（上/两侧/下分区，有疏密），观点文案清楚可见不作脚注。 */
  act2: {
    center: '这场活动，怎么安排？',
    pains: [
      /* 上区 */
      { t: '人数未定', tone: 'light', size: 'text-xl md:text-2xl', pos: { top: '8%', left: '10%' } },
      { t: '场地难选', tone: 'mid', size: 'text-2xl md:text-3xl', pos: { top: '14%', left: '64%' } },
      { t: '怕冷场', tone: 'mid', size: 'text-2xl md:text-3xl', pos: { top: '24%', left: '32%' } },
      /* 两侧（与中心问题同层，靠左右） */
      { t: '物料漏买', tone: 'light', size: 'text-xl md:text-2xl', pos: { top: '38%', left: '4%' } },
      { t: '临时变更', tone: 'light', size: 'text-xl md:text-2xl', pos: { top: '38%', right: '5%' } },
      { t: '众口难调', tone: 'mid', size: 'text-2xl md:text-3xl', pos: { top: '54%', left: '7%' } },
      { t: '下雨怎么办', tone: 'mid', size: 'text-2xl md:text-3xl', pos: { top: '55%', right: '6%' } },
      /* 下区（观点下方，避免左右碰撞） */
      { t: '预算超支', tone: 'accent', size: 'text-3xl md:text-5xl', pos: { top: '74%', left: '43%' } },
      { t: '流程混乱', tone: 'heavy', size: 'text-2xl md:text-4xl', pos: { top: '83%', left: '13%' } },
      { t: '时间太赶', tone: 'mid', size: 'text-2xl md:text-3xl', pos: { top: '81%', right: '11%' } },
    ] as Array<{
      t: string;
      tone: 'light' | 'mid' | 'accent' | 'heavy';
      size: string;
      pos: Record<string, string>;
    }>,
    core: 'AI帮你探索方向，你来决定。',
    aux: '不是替代你，而是和你一起把想法变成安排。',
    preps: [] as Array<{ t: string; pos: Record<string, string> }>,
  },

  /** 第三幕：共策过程示例（AI 建议 / 用户选择 / 调整后成果 三态清晰区分） */
  act3: {
    user1: '想办一场轻松的团建，大概 25 人，预算还没想好。',
    aiLead: 'AI 建议的三个方向',
    directions: [
      { name: '轻松茶歇', desc: '低门槛社交，节奏舒缓' },
      { name: '互动游戏', desc: '分组对抗，全员参与' },
      { name: '户外交流', desc: '走走聊聊，自然破冰' },
    ],
    user2: '想要互动，但不想上台表演。',
    pickIndex: 1,
    pickLabel: '你的选择',
    adjustTitle: '调整后的安排',
    demoNote: '首页演示 · 实际建议与成果以你的活动数据为准',
    schedule: [
      { time: '14:00', text: '签到 · 破冰分组' },
      { time: '15:30', text: '桌面互动游戏 · 免上台' },
      { time: '18:00', text: '晚餐 · 随意入座' },
    ],
    materials: ['道具与奖品 · 按分组准备', '预算先给三档，按优先级再定'],
  },

  /** 第四幕：看见效果，也可以继续调整 */
  act4Copy: {
    title: '先看效果，再一起调整',
    aux: '根据选定的方向与布置要求生成效果图，不满意，就继续讨论和修改。',
    cycle: ['选择方向', '查看效果', '调整要求', '再次查看'],
    activeCycle: 1,
    cta: { primary: '开始 AI 共策', secondary: '先去「找灵感」看看' },
    footer: '© 2026 SceneFlow AI · 让每一场活动从一个想法开始',
  },
};
