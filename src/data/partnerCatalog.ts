/**
 * 统一预置合作资源目录：合作页、AI 对话推荐、灵感详情、预算/物料与场景参考共用。
 * 规则：resourceId 稳定；线上条目为具体商品/商家/服务（预设资料），链接为平台精确关键词直达，
 * 价格库存以平台页面实时为准；本地条目仍为地区搜索入口。
 * AI 只能引用资源名称/编号，URL 由程序从目录取，模型不自由造链接。
 */

export type PartnerCategory = 'online' | 'local';

export interface PartnerResource {
  id: string;
  name: string;
  category: PartnerCategory;
  /** 触发推荐的讨论关键词（确定性匹配） */
  keywords: string[];
  /** 实际用途一句话 */
  use: string;
  /** 适用活动（展示用） */
  scenes: string;
  /** 真实平台搜索链接 */
  url: string;
  urlLabel: string;
  /** 线上资源形态：goods=实物商品/网店 service=线上服务（决定按钮文案；本地条目不设） */
  kind?: 'goods' | 'service';
  /** 用户评分（演示指标，条目为项目预置演示内容） */
  rating?: number;
  /** 评价数（演示指标） */
  reviews?: number;
  /** 已服务活动场次（本地服务演示指标） */
  servedCount?: number;
  /** 所在城市（本地条目：地区筛选的真实过滤依据；通用条目为空） */
  city?: string;
  /** 所属省份（本地具名商家：省级筛选依据；直辖市与省同名处理） */
  province?: string;
  /** 容量 / 服务范围 */
  capacity?: string;
  /** 参考价格区间（仅供预算量级参考） */
  priceNote?: string;
  /** 商家 / 店铺名称（线上具体条目） */
  merchant?: string;
  /** 商品图（有图卡片展示；无图条目用紧凑文字卡，不留空图位） */
  image?: string;
  /** SceneFlow 优选：置顶金标精选 */
  featured?: boolean;
}

const taobao = (q: string) => `https://s.taobao.com/search?q=${encodeURIComponent(q)}`;
/** 高德地图搜索链接（可带地区前缀）：泛类别入口与本地条目外链统一构造，保证链接目的与按钮名称一致 */
export const amapSearchUrl = (q: string, region?: string | null) =>
  `https://www.amap.com/search?query=${encodeURIComponent(region ? `${region}${q}` : q)}`;
const amap = (q: string, city?: string) => amapSearchUrl(q, city);

export const PARTNER_CATALOG: PartnerResource[] = [
  /* ---- SceneFlow 优选（置顶 3 项，金标） ---- */
  {
    id: 'goods-balloon-arch',
    kind: 'goods',
    name: '奶油风气球拱门套装',
    merchant: '喜柿派对用品店',
    category: 'online',
    featured: true,
    image: 'https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_d2626016-abeb-4c2d-8957-07a1d906e0dd.jpg',
    keywords: ['气球', '拱门', '氛围布置', '装饰', '拍照区'],
    use: '门口与拍照区主视觉，含支架与打气筒，约 30 分钟可搭好',
    scenes: '生日、团建、派对',
    priceNote: '¥129 起',
    url: taobao('奶油风气球拱门套装'),
    urlLabel: '查看商品',
    rating: 4.8,
    reviews: 2360,
  },
  {
    id: 'goods-film-camera',
    kind: 'goods',
    name: '一次性胶片相机 8 张装',
    merchant: '闪念胶片社',
    category: 'online',
    featured: true,
    image: 'https://miaoda-image.bj.bcebos.com/pexel_round1/01/pexels_955886_6044927.jpg',
    keywords: ['拍照', '相机', '胶片', '出片', '合影'],
    use: '即开即拍，复古色调原片直出，派对合影随手出片',
    scenes: '派对、婚礼、聚会',
    priceNote: '¥59',
    url: taobao('一次性胶片相机 派对'),
    urlLabel: '查看商品',
    rating: 4.9,
    reviews: 512,
  },
  {
    id: 'goods-table-flag',
    kind: 'goods',
    name: '香槟金桌旗椅套套装',
    merchant: '宴遇餐饮布草',
    category: 'online',
    featured: true,
    image: 'https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_a38ddfc6-e876-45e9-a561-0f85c2579b3f.jpg',
    keywords: ['桌旗', '椅套', '布草', '晚宴', '桌布'],
    use: '圆桌长桌通用，色系齐，批量下单可统一发货',
    scenes: '年会、晚宴、婚礼',
    priceNote: '¥15/位 起',
    url: taobao('香槟金桌旗椅套套装'),
    urlLabel: '查看商品',
    rating: 4.7,
    reviews: 1875,
  },
  /* ---- 普通条目：有图 ---- */
  {
    id: 'goods-kt-board',
    kind: 'goods',
    name: 'KT板定制签到背景',
    merchant: '快印联盟旗舰店',
    category: 'online',
    image: 'https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_d0efdc23-9397-43f2-8a4c-a30e01e68595.jpg',
    keywords: ['签到', '背景板', 'KT板', '合影', '指引'],
    use: '按尺寸与画面定制，活动前 3 天下单即可',
    scenes: '年会、发布会、毕业',
    priceNote: '¥260 起',
    url: taobao('KT板定制签到背景'),
    urlLabel: '查看商品',
    rating: 4.8,
    reviews: 980,
  },
  {
    id: 'goods-picnic-mat',
    kind: 'goods',
    name: '露营风野餐防潮垫',
    merchant: '山系户外用品',
    category: 'online',
    image: 'https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_4f4eb0ff-1c5f-4258-9bbe-a01dd6b20e85.jpg',
    keywords: ['野餐垫', '防潮垫', '露营', '休息区', '草坪'],
    use: '加厚防潮，可围坐 6–8 人，用完折叠收纳',
    scenes: '户外聚会、亲子野餐',
    priceNote: '¥69 起',
    url: taobao('露营野餐防潮垫 加厚'),
    urlLabel: '查看商品',
    rating: 4.6,
    reviews: 1320,
  },
  {
    id: 'goods-photo-wall',
    kind: 'goods',
    name: '照片墙麻绳木夹套装',
    merchant: '栖木文创',
    category: 'online',
    image: 'https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_00706fa1-212d-427e-8745-357e6941004a.jpg',
    keywords: ['照片墙', '回忆墙', '展示区', '麻绳', '夹子'],
    use: '含麻绳、木夹与墙贴，照片即夹即换，适合回忆墙',
    scenes: '毕业、周年、生日',
    priceNote: '¥39',
    url: taobao('照片墙麻绳木夹套装'),
    urlLabel: '查看商品',
    rating: 4.9,
    reviews: 764,
  },
  /* ---- 普通条目：无图（紧凑文字卡） ---- */
  {
    id: 'goods-light-banner',
    kind: 'goods',
    name: '手持弹幕灯牌定制',
    merchant: '闪字工坊',
    category: 'online',
    image: 'https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_3eebd365-9f73-4294-9fc4-c33439022c48.jpg',
    keywords: ['灯牌', '手举牌', '应援', '拍照道具'],
    use: '文字与灯色可定制，暖场互动与合影都出片',
    scenes: '晚会、团建、生日',
    priceNote: '¥25/个',
    url: taobao('手持弹幕灯牌定制'),
    urlLabel: '查看商品',
    rating: 4.5,
    reviews: 433,
  },
  {
    id: 'goods-tea-break',
    kind: 'service',
    name: '甜品台茶歇套餐（50 人）',
    merchant: '麦浪烘焙企业店',
    category: 'online',
    keywords: ['茶歇', '甜品', '餐饮', '下午茶', '点心'],
    use: '按人数配点心与饮品，支持备注忌口与主题色',
    scenes: '会议、沙龙、发布会',
    priceNote: '¥1,580/场',
    url: taobao('企业茶歇甜品台套餐'),
    urlLabel: '进入店铺',
    rating: 4.8,
    reviews: 296,
  },
  {
    id: 'goods-invite-design',
    kind: 'service',
    name: '电子请柬设计（加急出稿）',
    merchant: '纸间设计工作室',
    category: 'online',
    keywords: ['邀请函', '请柬', '海报', '设计', '出稿'],
    use: '线上沟通出稿，含动态与静态两版，支持两次修改',
    scenes: '婚礼、生日、发布会',
    priceNote: '¥59 起',
    url: taobao('电子请柬设计 加急'),
    urlLabel: '进入店铺',
    rating: 4.9,
    reviews: 388,
  },
  {
    id: 'goods-solar-string',
    kind: 'goods',
    name: '太阳能氛围串灯 10m',
    merchant: '星点灯业',
    category: 'online',
    keywords: ['灯串', '串灯', '氛围灯', '夜景'],
    use: '太阳能供电免布线，户外挂树绕棚都方便',
    scenes: '户外派对、露营、庭院',
    priceNote: '¥49',
    url: taobao('太阳能装饰串灯 户外'),
    urlLabel: '查看商品',
    rating: 4.7,
    reviews: 2105,
  },
  {
    id: 'goods-signin-miniapp',
    kind: 'service',
    name: '签到二维码小程序（年）',
    merchant: '码上签',
    category: 'online',
    keywords: ['签到', '小程序', '二维码', '报名', '统计'],
    use: '扫码签到、名单导出与抽奖名单互通，按年订阅',
    scenes: '会议、培训、年会',
    priceNote: '¥299/年',
    url: taobao('活动签到小程序 二维码'),
    urlLabel: '进入店铺',
    rating: 4.6,
    reviews: 154,
  },
  {
    id: 'goods-hand-board',
    kind: 'goods',
    name: 'ins 风拍照手举牌 12 件',
    merchant: '拍拍乐道具',
    category: 'online',
    image: 'https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_081247fe-7fb5-4f15-92d4-33c2571c8b50.jpg',
    keywords: ['手举牌', '拍照道具', '合影', '道具'],
    use: '文字图案多款式，即拆即拍，合影暖场都好用',
    scenes: '派对、团建、婚礼',
    priceNote: '¥35',
    url: taobao('ins拍照手举牌 派对'),
    urlLabel: '查看商品',
    rating: 4.5,
    reviews: 620,
  },
  {
    id: 'local-ktv',
    name: 'KTV 包间',
    category: 'local',
    keywords: ['KTV', '唱歌', '包厢'],
    use: '按小时订包间，自带音响与点歌设备',
    scenes: '团建、生日、聚会',
    url: amap('KTV'),
    urlLabel: '高德搜索',
    rating: 4.6,
    reviews: 3120,
    servedCount: 480,
  },
  {
    id: 'local-scriptkill',
    name: '剧本杀 / 桌游店',
    category: 'local',
    keywords: ['剧本杀', '桌游店', '实景游戏'],
    use: '按人数组局，店家提供主持与场地',
    scenes: '团建、朋友聚会',
    url: amap('剧本杀'),
    urlLabel: '高德搜索',
    rating: 4.7,
    reviews: 2680,
    servedCount: 520,
  },
  {
    id: 'local-restaurant',
    name: '餐厅包间',
    category: 'local',
    keywords: ['餐厅', '包间', '聚餐', '宴请', '晚宴'],
    use: '包间聚餐宴请，可提前沟通布置时间',
    scenes: '年会、生日、部门聚餐',
    url: amap('餐厅 包间'),
    urlLabel: '高德搜索',
    rating: 4.5,
    reviews: 4520,
    servedCount: 890,
  },
  {
    id: 'local-cafe',
    name: '咖啡馆包场',
    category: 'local',
    keywords: ['咖啡馆', '咖啡厅', '包场'],
    use: '小型场地按时段包场，适合轻聚会与分享会',
    scenes: '团建、生日、社群活动',
    url: amap('咖啡馆 包场'),
    urlLabel: '高德搜索',
    rating: 4.4,
    reviews: 1560,
    servedCount: 260,
  },
  {
    id: 'local-party',
    name: '轰趴馆',
    category: 'local',
    keywords: ['轰趴', '轰趴馆', '别墅聚会'],
    use: '独栋或整层场地，含厨房与娱乐设施',
    scenes: '团建、生日、朋友聚会',
    url: amap('轰趴馆'),
    urlLabel: '高德搜索',
    rating: 4.6,
    reviews: 2100,
    servedCount: 350,
  },
  {
    id: 'local-photo',
    name: '活动摄影',
    category: 'local',
    keywords: ['摄影', '跟拍', '摄像', '拍照'],
    use: '按小时跟拍，交付精修照片',
    scenes: '年会、生日、社区活动',
    url: amap('活动跟拍摄影'),
    urlLabel: '高德搜索',
    rating: 4.8,
    reviews: 890,
    servedCount: 640,
  },
  {
    id: 'local-setup',
    name: '活动布置服务',
    category: 'local',
    keywords: ['布置服务', '现场布置', '搭建', '气球布置'],
    use: '到场布置与撤收，按项目报价',
    scenes: '年会、生日、发布会',
    url: amap('活动布置'),
    urlLabel: '高德搜索',
    rating: 4.7,
    reviews: 540,
    servedCount: 380,
  },
  {
    id: 'local-tables',
    name: '桌椅租赁',
    category: 'local',
    keywords: ['桌椅', '椅子', '桌子', '租赁', '临时增设'],
    use: '按把/按天租用，可协商配送摆放与现场回收（具体范围与价格以商家为准）',
    scenes: '各类需要临时增设座位的活动',
    url: amap('桌椅租赁'),
    urlLabel: '高德搜索',
    rating: 4.5,
    reviews: 420,
    servedCount: 720,
  },
  {
    id: 'local-audio',
    name: '灯光音响租赁',
    category: 'local',
    keywords: ['音响', '麦克风', '灯光设备', '音响租赁'],
    use: '音箱、麦克风与灯光按天租赁，含进场调试',
    scenes: '年会、晚会、发布会',
    url: amap('灯光音响租赁'),
    urlLabel: '高德搜索',
    rating: 4.6,
    reviews: 380,
    servedCount: 560,
  },
  /* ---- 物料类商品：与 AI 物料推荐关键词一一对应 ---- */
  {
    id: 'goods-board-game',
    kind: 'goods',
    name: '破冰桌游套装 8 合 1',
    merchant: '玩聚桌游馆',
    category: 'online',
    image: 'https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_354758d0-4650-4bc6-a6cb-5b18bfc31285.jpg',
    keywords: ['桌游', '破冰', '游戏道具', '卡牌', '互动游戏'],
    use: '含卡牌、骰子与计分道具，附玩法手册，分组对抗直接开局',
    scenes: '团建、聚会、暖场',
    priceNote: '¥89',
    url: taobao('破冰桌游套装 团建'),
    urlLabel: '查看商品',
    rating: 4.5,
    reviews: 860,
  },
  {
    id: 'goods-custom-gift',
    kind: 'goods',
    name: '定制帆布袋伴手礼',
    merchant: '布语定制工厂店',
    category: 'online',
    image: 'https://miaoda-site-img.cdn.bcebos.com/images/baidu_image_search_21c51189-f6bd-4710-9438-ed2576ef90ba.jpg',
    keywords: ['伴手礼', '礼品', '纪念品', '定制', '奖品'],
    use: '图案文字可印，50 个起订，活动主题色系可定制',
    scenes: '年会、表彰、生日',
    priceNote: '¥12/个 起',
    url: taobao('定制帆布袋 伴手礼'),
    urlLabel: '查看商品',
    rating: 4.9,
    reviews: 1520,
  },
  {
    id: 'goods-whiteboard',
    kind: 'goods',
    name: '移动白板写字板 60×90',
    merchant: '明文办公用品',
    category: 'online',
    keywords: ['白板', '写字板', '马克笔', '便利贴', '讨论'],
    use: '带支架可移动，配白板笔与板擦，讨论分组即推即用',
    scenes: '工作坊、培训、团建',
    priceNote: '¥139',
    url: taobao('移动白板写字板 支架'),
    urlLabel: '查看商品',
    rating: 4.6,
    reviews: 1240,
  },
  {
    id: 'goods-banner',
    kind: 'goods',
    name: '主题拉旗横幅定制 5m',
    merchant: '彩印天下',
    category: 'online',
    keywords: ['横幅', '拉旗', '主题', '口号', '装饰'],
    use: '文字与配色按主题定制，室内外两用，附安装绳',
    scenes: '年会、招新、派对',
    priceNote: '¥49',
    url: taobao('横幅拉旗定制 活动'),
    urlLabel: '查看商品',
    rating: 4.7,
    reviews: 690,
  },
  {
    id: 'goods-tableware',
    kind: 'goods',
    name: '一次性纸盘纸杯套装（50 人）',
    merchant: '绿禾环保餐具',
    category: 'online',
    image: 'https://miaoda-image.cdn.bcebos.com/img/corpus/92235c69a42143b8844d0545b5cb3f78.jpg',
    keywords: ['餐具', '纸杯', '纸盘', '餐饮', '一次性'],
    use: '本色环保材质，含盘杯与垃圾袋，按人数配套',
    scenes: '户外聚餐、茶歇、市集',
    priceNote: '¥79',
    url: taobao('一次性纸盘纸杯套装 环保'),
    urlLabel: '查看商品',
    rating: 4.6,
    reviews: 980,
  },
  {
    id: 'goods-wish-wall',
    kind: 'goods',
    name: '便利贴留言墙套装',
    merchant: '文具控企业店',
    category: 'online',
    keywords: ['便利贴', '留言墙', '许愿墙', '心愿', '互动'],
    use: '含渐变色便利贴与心形墙贴，签到许愿两用',
    scenes: '年会、婚礼、毕业',
    priceNote: '¥29',
    url: taobao('便利贴留言墙套装 渐变'),
    urlLabel: '查看商品',
    rating: 4.8,
    reviews: 510,
  },
];


/* ===================== 本地合作商家（项目虚构演示资料） =====================
 * 名称/容量/参考价格为演示内容，链接仍为真实平台搜索入口；
 * 不给真实商家编造评价认证或配送承诺，产品内不显示 mock 字样。 */
const CITY_PROVINCE: Record<string, string> = {
  北京: '北京市', 上海: '上海市', 广州: '广东省', 深圳: '广东省', 杭州: '浙江省', 成都: '四川省',
};

const localMerchant = (
  prefix: string,
  name: string,
  city: string,
  scenes: string,
  use: string,
  capacity: string,
  priceNote: string,
  rating: number,
  reviews: number,
  servedCount: number,
  keywords: string[],
  query: string
): PartnerResource => ({
  id: `local-${prefix}-${city}`,
  province: CITY_PROVINCE[city] ?? '',
  name,
  category: 'local',
  keywords,
  use,
  scenes,
  url: amap(query, city),
  urlLabel: '高德搜索',
  rating,
  reviews,
  servedCount,
  city,
  capacity,
  priceNote,
});

/** 六大城市 × 六类商家（餐厅/KTV/桌游剧本杀/咖啡馆/活动空间/桌椅设备租赁），地区筛选真实过滤 */
export const LOCAL_MERCHANTS: PartnerResource[] = [
  // 北京
  localMerchant('rest', '聚福楼宴会厅', '北京', '年会、庆功宴、答谢晚宴', '中式圆桌宴席，含舞台区与迎宾区，适合正式晚宴', '8–20 桌（约 80–200 人）', '人均 188–388 元', 4.7, 1240, 420, ['宴会厅', '餐厅', '晚宴', '包席'], '餐厅 宴会厅'),
  localMerchant('ktv', '星聚汇量贩KTV', '北京', '团建、生日、朋友聚会', '大中小包间，含自助欢唱时段，适合轻松收尾', '小包 6 人 / 大包 30 人', '小包 3 小时 288 元起', 4.5, 2860, 980, ['KTV', '唱歌', '包间'], 'KTV 量贩'),
  localMerchant('script', '迷雾剧本杀剧场', '北京', '团建、桌游、剧本杀', '多主题实景房间，支持 6–12 人组局，可包场', '6–12 人/场', '人均 98–158 元', 4.6, 1540, 660, ['剧本杀', '桌游'], '剧本杀'),
  localMerchant('cafe', '暖山咖啡馆', '北京', '小型分享会、社群活动', '临街两层空间，可半层包场，安静适合交流', '一层 20 人 / 整店 45 人', '按位 58 元含饮品', 4.4, 980, 300, ['咖啡馆', '咖啡厅', '包场'], '咖啡馆 包场'),
  localMerchant('space', '云顶聚会空间', '北京', '团建、生日、发布会', 'loft 开放空间，含投影与音响，布置自由度高', '40–120 人', '半天 2400 元起', 4.7, 860, 380, ['活动空间', '场地', '包场'], '活动空间 租赁'),
  localMerchant('tables', '安捷桌椅设备租赁', '北京', '各类需要临时增设座位的活动', '折叠桌椅、长条桌、易拉宝等按天租赁，可协商配送摆放与回收', '50–500 席', '折叠椅 5 元/天起', 4.5, 520, 720, ['桌椅', '租赁', '临时增设'], '桌椅租赁'),

  // 上海
  localMerchant('rest', '沪上人家宴会厅', '上海', '年会、婚宴、主题聚餐', '本帮菜宴席，含独立迎宾区与化妆间', '10–22 桌（约 100–220 人）', '人均 168–358 元', 4.6, 1620, 480, ['宴会厅', '餐厅', '晚宴'], '餐厅 宴会厅'),
  localMerchant('ktv', '麦乐迪KTV', '上海', '团建、生日、朋友聚会', '主题包间与欢唱套餐，含小食软饮', '小包 8 人 / 豪华包 35 人', '3 小时套餐 358 元起', 4.4, 3100, 1120, ['KTV', '唱歌'], 'KTV'),
  localMerchant('script', '妙语桌游馆', '上海', '桌游、轻团建', '百款桌游免费畅玩，有主持教学，适合破冰', '4–20 人/组', '人均 68 元畅玩', 4.6, 1420, 700, ['桌游', '桌游馆'], '桌游馆'),
  localMerchant('cafe', '梧桐树咖啡', '上海', '读书会、沙龙、小型分享', '梧桐街区独栋，含露台，适合安静社交活动', '整店 35 人', '按位 62 元含饮品', 4.5, 860, 280, ['咖啡馆', '包场'], '咖啡馆 包场'),
  localMerchant('space', '半空创意活动空间', '上海', '发布会、市集、主题派对', '挑高白盒空间，可自由搭建布置与分区', '60–150 人', '半天 3200 元起', 4.7, 640, 300, ['活动空间', '场地'], '活动空间 租赁'),
  localMerchant('tables', '鸿运桌椅租赁', '上海', '各类需要临时增设座位的活动', '宴会圆桌、鸡尾酒桌、吧椅等齐备，支持上门布置', '30–400 席', '圆桌 25 元/天起', 4.4, 480, 650, ['桌椅', '租赁'], '桌椅租赁'),

  // 广州
  localMerchant('rest', '珠江宴府', '广州', '年会、粤式晚宴', '粤式宴席与茶点，含舞台与灯光基础配置', '12–25 桌（约 120–250 人）', '人均 158–328 元', 4.7, 1380, 520, ['宴会厅', '晚宴', '餐厅'], '餐厅 宴会厅'),
  localMerchant('ktv', '聚唱KTV', '广州', '团建、生日', '纯K包间与自助欢唱，含果盘小食', '小包 6 人 / 大包 28 人', '3 小时 268 元起', 4.5, 2560, 890, ['KTV', '唱歌'], 'KTV'),
  localMerchant('script', '南亭剧本社', '广州', '剧本杀、团建', '城景主题房间与换装本，支持包场组局', '6–14 人/场', '人均 88–148 元', 4.5, 1180, 560, ['剧本杀'], '剧本杀'),
  localMerchant('cafe', '骑楼咖啡', '广州', '社群活动、轻聚会', '骑楼老建筑改造，含小院，氛围怀旧', '整店 30 人', '按位 55 元含饮品', 4.3, 760, 260, ['咖啡馆', '包场'], '咖啡馆 包场'),
  localMerchant('space', '珠江畔活动场地', '广州', '发布会、年会、市集', '临江多功能厅，含LED屏与灯光桁架', '80–200 人', '半天 3800 元起', 4.6, 520, 240, ['活动空间', '场地'], '活动空间 租赁'),
  localMerchant('tables', '穗丰桌椅设备租赁', '广州', '各类需要临时增设座位的活动', '塑料/水晶椅、长桌与舞台板租赁，可上门搭建', '50–600 席', '塑料椅 3 元/天起', 4.4, 460, 700, ['桌椅', '租赁'], '桌椅租赁'),

  // 深圳
  localMerchant('rest', '鹏城宴汇', '深圳', '年会、庆功宴', '新派粤湘宴席，含宴会主持基础服务', '10–20 桌（约 100–200 人）', '人均 178–368 元', 4.6, 1120, 430, ['宴会厅', '晚宴'], '餐厅 宴会厅'),
  localMerchant('ktv', '唱响K歌俱乐部', '深圳', '团建、生日、朋友聚会', '影音级包间，含下午场优惠时段', '小包 6 人 / 大包 32 人', '下午场 198 元起', 4.4, 2240, 810, ['KTV', '唱歌'], 'KTV'),
  localMerchant('script', '星城桌游剧本杀', '深圳', '桌游、剧本杀、轻团建', '两层独栋，桌游+剧本杀双业态，含茶歇', '6–16 人/场', '人均 78–138 元', 4.5, 1340, 620, ['剧本杀', '桌游'], '桌游剧本杀'),
  localMerchant('cafe', '湾区小馆咖啡', '深圳', '分享会、社群活动', '园区临湖空间，含投影，适合工作坊', '整店 40 人', '按位 60 元含饮品', 4.5, 690, 240, ['咖啡馆', '包场'], '咖啡馆 包场'),
  localMerchant('space', '光盒子活动空间', '深圳', '发布会、主题派对、团建', '落地窗创意空间，含基础灯光音响', '50–130 人', '半天 2800 元起', 4.6, 580, 270, ['活动空间', '场地'], '活动空间 租赁'),
  localMerchant('tables', '速达桌椅租赁', '深圳', '各类需要临时增设座位的活动', '当日达配送的折叠桌椅与吧台设备', '40–450 席', '折叠椅 4 元/天起', 4.3, 420, 680, ['桌椅', '租赁'], '桌椅租赁'),

  // 杭州
  localMerchant('rest', '西湖宴庭', '杭州', '年会、主题聚餐', '杭帮菜宴席，含湖景包间与宴会厅', '8–18 桌（约 80–180 人）', '人均 158–338 元', 4.7, 1060, 390, ['宴会厅', '晚宴'], '餐厅 宴会厅'),
  localMerchant('ktv', '湖畔K歌汇', '杭州', '团建、生日', '湖景包间，含欢唱与桌游休息区', '小包 6 人 / 大包 30 人', '3 小时 288 元起', 4.4, 1980, 760, ['KTV', '唱歌'], 'KTV'),
  localMerchant('script', '留白桌游馆', '杭州', '桌游、轻团建', '安静向桌游馆，含新手教学与轻食', '4–18 人/组', '人均 58 元畅玩', 4.5, 1240, 580, ['桌游'], '桌游馆'),
  localMerchant('cafe', '青屿咖啡馆', '杭州', '读书会、小型分享', '植物园旁独栋，含庭院，适合白天活动', '整店 32 人', '按位 56 元含饮品', 4.6, 720, 230, ['咖啡馆', '包场'], '咖啡馆 包场'),
  localMerchant('space', '天目里活动空间', '杭州', '市集、发布会、社群活动', '挑高展厅与户外平台组合，可分区布展', '60–160 人', '半天 3000 元起', 4.7, 500, 220, ['活动空间', '场地'], '活动空间 租赁'),
  localMerchant('tables', '钱塘桌椅设备租赁', '杭州', '各类需要临时增设座位的活动', '宴会椅、折叠桌与遮阳棚租赁，含布置建议', '30–400 席', '宴会椅 6 元/天起', 4.4, 380, 610, ['桌椅', '租赁'], '桌椅租赁'),

  // 成都
  localMerchant('rest', '锦官宴厅', '成都', '年会、川式晚宴', '川菜宴席与变脸茶艺表演可预约', '10–22 桌（约 100–220 人）', '人均 148–318 元', 4.6, 1260, 470, ['宴会厅', '晚宴'], '餐厅 宴会厅'),
  localMerchant('ktv', '锦里欢唱KTV', '成都', '团建、生日', '大包间含小舞台，适合部门才艺环节', '小包 8 人 / 大包 35 人', '3 小时 258 元起', 4.5, 2420, 870, ['KTV', '唱歌'], 'KTV'),
  localMerchant('script', '蜀风剧本杀', '成都', '剧本杀、团建', '古风实景房间与阵营本，主持全程带队', '6–14 人/场', '人均 88–158 元', 4.6, 1420, 590, ['剧本杀'], '剧本杀'),
  localMerchant('cafe', '巷子里咖啡馆', '成都', '轻聚会、社群活动', '老院落改造，含天井茶座，氛围松弛', '整店 28 人', '按位 52 元含饮品', 4.4, 640, 210, ['咖啡馆', '包场'], '咖啡馆 包场'),
  localMerchant('space', '东郊记忆活动空间', '成都', '主题派对、市集、发布会', '工业风厂房空间，含桁架与配电支持', '60–180 人', '半天 2600 元起', 4.6, 560, 250, ['活动空间', '场地'], '活动空间 租赁'),
  localMerchant('tables', '蓉城桌椅租赁', '成都', '各类需要临时增设座位的活动', '竹木桌椅与户外伞具租赁，含摆放回收', '40–380 席', '竹椅 4 元/天起', 4.3, 360, 590, ['桌椅', '租赁'], '桌椅租赁'),
];

/** 否定/明确不采购语境：不做合作推荐，不为展示广告制造需求 */
export const PARTNER_NEGATION_RE = /不(?:要|想|需|用|再)?(?:买|买下|购买|采购|订|租|新增)|零新增|不新增(?:费用|采购|物品)/;

/** 确定性关键词匹配（无 AI 调用）：文本提到相关需求才推荐，同资源去重，最多 limit 条 */
export function matchPartnerCatalog(text: string, limit = 3, city?: string): PartnerResource[] {
  if (!text.trim() || PARTNER_NEGATION_RE.test(text)) return [];
  const out: PartnerResource[] = [];
  for (const r of PARTNER_CATALOG) {
    if (out.length >= limit) break;
    if (r.keywords.some((k) => text.includes(k))) {
      out.push(city && r.category === 'local' ? { ...r, url: amap(r.name, city) } : r);
    }
  }
  return out;
}

/** 具名本地商家（主列表）：有真实名称、地区、容量、参考价等资料的演示商家 */
export const LOCAL_MERCHANTS_ONLY: PartnerResource[] = LOCAL_MERCHANTS;

/** 泛类别搜索条目（仅高德地图搜索入口）：不展示评分/评价/服务场次，不计入合作商家数 */
export const LOCAL_GENERIC_ENTRIES: PartnerResource[] = PARTNER_CATALOG.filter((r) => r.category === 'local');

/** 合作目录全集：通用线上好物 + 通用本地服务 + 各城市商家（地区筛选数据源） */
export const ALL_LOCAL_RESOURCES: PartnerResource[] = [...PARTNER_CATALOG.filter((r) => r.category === 'local'), ...LOCAL_MERCHANTS];


/** 按城市参数化本地资源搜索链接（不虚构该市已有具体商家，仍是搜索入口） */
export function withCityFilter(list: PartnerResource[], city?: string | null): PartnerResource[] {
  if (!city) return list;
  return list.map((r) => (r.category === 'local' ? { ...r, url: amap(r.name, city) } : r));
}
