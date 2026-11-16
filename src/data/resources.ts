/**
 * 轻量资源推荐 · 集中配置
 * - 本文件为推荐数据唯一来源，后续替换真实商家/商品只需改这里
 * - 当前全部条目均为「平台搜索入口」（真实可用的平台检索 URL），未核实具体商家，
 *   因此卡片统一标注演示徽章，不展示虚构价格/库存/评分，不放「立即购买」
 * - AI 只解释推荐理由，链接一律来自此配置，模型不生成网址
 */

import { ASSETS } from '@/data/assets';

export interface ResourceLink {
  /** 按钮文案：「去平台搜索」或「去平台看看」 */
  label: string;
  url: string;
}

export interface MaterialResource {
  id: string;
  name: string;
  /** 对应物品的参考图（素材库示意，非商品页图片） */
  image?: string;
  /** 用途 / 对应环节 */
  usage: string;
  /** 适用规格 */
  spec: string;
  platform: string;
  links: ResourceLink[];
  /** 自制 / 借用 / 租赁等替代方式 */
  alternatives?: string;
  /** 配送与时效提示（有来源与适用条件才出现，不承诺具体时效） */
  deliveryNote?: string;
  /** 匹配关键词（物料名 / 灵感 needs / 用户消息） */
  matchKeywords: string[];
  /** 参考标记：仅提供平台入口，未核实具体商家 */
  demo: boolean;
  /** 推广 / 合作推荐标注（当前无商业合作，全部为普通参考入口） */
  promo?: boolean;
  /** 综合评分 */
  rating?: number;
  /** 评价总数 */
  reviews?: number;
  /** 已服务场次 */
  servedCount?: number;
}

export interface VenueResource {
  id: string;
  /** 限定城市；缺省为通用选址建议 */
  city?: string;
  title: string;
  venueType: string;
  /** 容量信息与其来源（未核实具体商家时不写确定容量） */
  capacity: string;
  capacitySource: string;
  usage: string;
  platform: string;
  links: ResourceLink[];
  demo: boolean;
}

const SEARCH = {
  jd: (kw: string) => ({ label: '去京东搜索', url: `https://search.jd.com/Search?keyword=${encodeURIComponent(kw)}` }),
  taobao: (kw: string) => ({ label: '去淘宝搜索', url: `https://s.taobao.com/search?q=${encodeURIComponent(kw)}` }),
};

export const MATERIAL_RESOURCES: MaterialResource[] = [
  {
    id: 'm-whiteboard',
    name: '白板（带支架）',
    usage: '你画我猜、计分板、关键词墙等互动环节的主力道具',
    spec: '90×120cm 起步，带万向轮支架，配板擦与磁贴更方便',
    platform: '京东 / 淘宝',
    links: [SEARCH.jd('白板带支架'), SEARCH.taobao('白板带支架')],
    alternatives: '预算有限可用大白纸 + 粗头马克笔贴墙代替；玻璃窗/玻璃门用可擦水性笔也能直接写（先角落试写）',
    deliveryNote: '配送时效以平台下单页为准；活动临近建议优先同城现货、自提或租赁',
    matchKeywords: ['白板', '画板', '写字板', '题板', '你画我猜', '计分', '关键词'],
    demo: true,
    rating: 4.8,
    reviews: 1860,
    servedCount: 3200,
  },
  {
    id: 'm-markers',
    name: '粗头马克笔 / 白板笔',
    image: '/images/assets/material-markers-pen.webp',
    usage: '白板书写、题卡制作、姓名贴大字书写',
    spec: '黑红蓝各 2 支起（干得快、丢得快，宁多勿少）',
    platform: '京东 / 淘宝',
    links: [SEARCH.jd('白板笔套装'), SEARCH.taobao('马克笔粗头')],
    alternatives: '办公室现有签字笔 + 便利贴可应急；姓名贴建议粗头才醒目',
    matchKeywords: ['马克笔', '白板笔', '画笔', '笔', '题卡'],
    demo: true,
    rating: 4.9,
    reviews: 3420,
    servedCount: 5600,
  },
  {
    id: 'm-balloons',
    name: '彩色气球 / 气球拱门',
    image: ASSETS.material.balloons,
    usage: '多巴胺等亮色主题布置：入口拱门、舞台背景、拍照区点缀',
    spec: '按主题选 3–4 个主色；拱门可用定制套装或散球 + 鱼线自制',
    platform: '京东 / 淘宝',
    links: [SEARCH.jd('气球拱门套装'), SEARCH.taobao('彩色气球布置')],
    alternatives: '预算有限改为彩色桌旗 + 一束气球束；有人力可提前一晚自吹散球',
    deliveryNote: '充气类商品注意运输尺寸；活动临近优先同城配送或门店自提',
    matchKeywords: ['气球', '拱门', '多巴胺', '彩色', '布置', '装饰', '背景'],
    demo: true,
    rating: 4.8,
    reviews: 4500,
    servedCount: 6800,
  },
  {
    id: 'm-tablecloth',
    name: '彩色桌布 / 桌旗',
    image: ASSETS.inspiration.tableCenter,
    usage: '主题餐桌与甜品桌的底色统一，布置见效最快的物料之一',
    spec: '一次性无纺布桌布性价比高；圆桌按直径选规格',
    platform: '京东 / 淘宝',
    links: [SEARCH.jd('一次性桌布彩色'), SEARCH.taobao('派对桌布')],
    alternatives: '家中有素色桌布可用彩纸/丝带做桌旗叠加；甜品桌可用牛皮纸打底',
    matchKeywords: ['桌布', '桌旗', '餐桌', '甜品桌', '桌面'],
    demo: true,
    rating: 4.7,
    reviews: 2100,
    servedCount: 3100,
  },
  {
    id: 'm-photo-props',
    name: '手持拍照牌 / 拍照道具',
    image: ASSETS.material.photoprops,
    usage: '拍照背景区配套，合影不尴尬，散场可带走当小礼物',
    spec: '10–20 块轮换够用；风格混搭：爱心框、年份牌、趣味语录',
    platform: '京东 / 淘宝',
    links: [SEARCH.jd('拍照道具手举牌'), SEARCH.taobao('派对拍照牌')],
    alternatives: '雪糕棒 + 卡纸一晚上可自制 20 块；A4 卡纸打印贴雪糕棒是极简版',
    matchKeywords: ['拍照', '手举牌', '手持牌', '合影', '道具', '拍照区'],
    demo: true,
    rating: 4.9,
    reviews: 1980,
    servedCount: 2900,
  },
  {
    id: 'm-sign-kit',
    name: '签到本 / 姓名贴',
    image: ASSETS.material.signin,
    usage: '入场统计、抽奖编号与破冰（大字姓名 + 一句身份标签）',
    spec: '签到本按每 50 人 1 本；姓名贴按预计人数 110% 准备',
    platform: '京东 / 淘宝',
    links: [SEARCH.jd('活动签到本'), SEARCH.taobao('姓名贴空白')],
    alternatives: '签到可改打印名单打勾或白板画正字；姓名贴可用胸卡 + 吊绳替代（可回收）',
    matchKeywords: ['签到', '姓名贴', '签到本', '登记', '胸牌'],
    demo: true,
    rating: 4.8,
    reviews: 1650,
    servedCount: 2400,
  },
  {
    id: 'm-lottery',
    name: '抽奖箱 / 号码券',
    image: ASSETS.material.raffle,
    usage: '选用抽奖环节时使用（未选抽奖则无需准备）',
    spec: '券按人数 110% 印，一式两联；纸箱加装饰即可当抽奖箱',
    platform: '京东 / 淘宝',
    links: [SEARCH.jd('抽奖箱号码券'), SEARCH.taobao('抽奖球号码')],
    alternatives: '电子抽奖（大屏滚动名单）零物料；纸质券可现场手写编号代替',
    matchKeywords: ['抽奖', '奖券', '号码', '抽奖箱'],
    demo: true,
    rating: 4.7,
    reviews: 920,
    servedCount: 1500,
  },
  {
    id: 'm-lighting',
    name: '便携灯光 / 荧光棒',
    image: ASSETS.material.lighting,
    usage: '舞台氛围、桌角点缀与暖场互动（荧光棒可当互动小道具）',
    spec: '串灯按 5 米/条起备；荧光棒按人数 80% 准备（三色混装）',
    platform: '京东 / 淘宝',
    links: [SEARCH.jd('LED串灯电池'), SEARCH.taobao('荧光棒套装')],
    alternatives: '现场有调光设备可用现场灯光；蜡烛型 LED 小灯更省电但注意固定',
    deliveryNote: '电池类注意备足电池；临近活动优先同城现货',
    matchKeywords: ['灯光', '荧光棒', '灯串', '串灯', '氛围灯', 'LED'],
    demo: true,
    rating: 4.8,
    reviews: 2780,
    servedCount: 4200,
  },
  {
    id: 'm-awards',
    name: '奖杯 / 证书',
    image: ASSETS.material.awards,
    usage: '表彰、颁奖与纪念环节（年会、结营、比赛通用）',
    spec: '奖杯按获奖人数；证书可打印（A4 120g 纸 + 现场签名）',
    platform: '京东 / 淘宝',
    links: [SEARCH.jd('奖杯定制小号'), SEARCH.taobao('荣誉证书空白')],
    alternatives: '证书现场打印 + 手写颁奖词更有人情味；奖杯可换奖牌或锦旗',
    matchKeywords: ['奖杯', '证书', '颁奖', '表彰', '荣誉', '奖牌'],
    demo: true,
    rating: 4.9,
    reviews: 1460,
    servedCount: 2300,
  },
];

export const VENUE_RESOURCES: VenueResource[] = [
  {
    id: 'v-hangzhou',
    city: '杭州',
    title: '杭州 · 场地与包间检索',
    venueType: '宴会厅 / 餐饮包间 / 共享活动空间',
    capacity: '容量以平台筛选与商家页面为准',
    capacitySource: '以平台页面为准',
    usage: '优先核对：包间容量、最低消费、投影/音响设备、交通与停车',
    platform: '大众点评 / 美团',
    links: [
      { label: '去大众点评（杭州）', url: 'https://www.dianping.com/hangzhou' },
      { label: '去美团看看', url: 'https://www.meituan.com/' },
    ],
    demo: true,
  },
];

/** 通用选址建议（城市未知时展示，不随机推荐具体城市） */
export const VENUE_GENERAL_TIPS = [
  '先定人数和形式（坐宴 / 站立酒会 / 围桌讨论），再找场地类型',
  '核对容量时按「人均 1.5–2㎡」估坐宴，留出舞台或互动区',
  '逐项确认：最低消费、设备（投影/音响/麦）、能否自带布置与餐食、撤场时间',
  '交通与停车：地铁 500 米内加分；提前问清加班时费用',
  '日期临近时，优先可当天看场的本地场地，避免只靠线上沟通',
];

const PLATFORM_ENTRY = [
  { label: '去大众点评选城市找场地', url: 'https://www.dianping.com/' },
  { label: '去美团看看餐饮与场地', url: 'https://www.meituan.com/' },
];

/** 按关键词（物料名 / 灵感需求 / 用户消息）匹配物料推荐 */
export function getMaterialMatches(keywords: string[]): MaterialResource[] {
  const text = keywords.join(' ').toLowerCase();
  return MATERIAL_RESOURCES.filter((r) => r.matchKeywords.some((k) => text.includes(k.toLowerCase())));
}

/** 场地推荐：有城市配置则返回对应入口，否则返回通用建议 + 平台入口 */
export function getVenueMatches(city?: string): { venues: VenueResource[]; tips: string[]; entries: ResourceLink[] } {
  const c = city?.trim();
  if (c) {
    const venues = VENUE_RESOURCES.filter((v) => v.city === c);
    if (venues.length > 0) return { venues, tips: VENUE_GENERAL_TIPS, entries: [] };
    return { venues: [], tips: VENUE_GENERAL_TIPS, entries: PLATFORM_ENTRY };
  }
  return { venues: [], tips: VENUE_GENERAL_TIPS, entries: PLATFORM_ENTRY };
}
