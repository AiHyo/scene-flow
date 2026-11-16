/**
 * 场地布置参考：本地素材严格配对的布置前 / 布置后 + 可编辑默认诉求。
 * 场景布置页与工作台场景模块共用同一数据源，保证图文配对一致。
 * 稳定 ID 集中维护，卡片 / 弹窗 / 下载 / 开始策划均读取此处，不按下标配图。
 * 场地名称强调空间类型；副标题仅为示例主题，用户可编辑或清空默认诉求。
 */
export const VENUE_SAMPLES = [
  {
    id: 'lawn',
    name: '户外草坪',
    subtitle: '团建游园布置',
    desc: '从空草坪出发，参考游戏、交流与休息分区的布置方式。',
    before: '/images/layout-reference/01-lawn-before.png',
    after: '/images/layout-reference/01-lawn-after.png',
    region: '布置参考',
    capacity: '主题仅供参考',
    title: '草坪场地布置',
    brief: '这是我们的草坪场地，想参考游戏、交流与休息分区做布置，先给些方向',
    /** 参考物料：完整清单在大图弹窗展示，卡片仅取前几项保持紧凑 */
    materials: [
      '遮阳篷',
      '签到与茶歇桌',
      '野餐桌椅',
      '积木与套圈投掷道具',
      '合影背景板',
      '队旗彩旗',
      '休闲椅与野餐垫',
    ],
  },
  {
    id: 'hall',
    name: '多功能大厅',
    subtitle: '毕业欢送布置',
    desc: '参考观众席、合影区与回忆展示区的布置，也可以调整为其他室内活动。',
    before: '/images/layout-reference/02-graduation-before.png',
    after: '/images/layout-reference/02-graduation-after.png',
    region: '布置参考',
    capacity: '主题仅供参考',
    title: '大厅场地布置',
    brief: '这是我们的多功能大厅，想参考观众席、合影区与展示区的布置方式',
    materials: ['毕业主题背景板', '观众座椅', '照片展示架', '留言桌', '气球花艺', '毕业帽道具'],
  },
  {
    id: 'courtyard',
    name: '中式庭院',
    subtitle: '中秋茶会布置',
    desc: '参考品茶、赏灯与手作分区，打造适合相聚交流的庭院活动。',
    before: '/images/layout-reference/03-courtyard-before.png',
    after: '/images/layout-reference/03-courtyard-after.png',
    region: '布置参考',
    capacity: '主题仅供参考',
    title: '庭院场地布置',
    brief: '这是我们的中式庭院，想参考品茶、赏灯与手作分区做布置，先给些方向',
    materials: ['茶桌座椅', '月亮背景板', '灯笼灯谜架', '手作桌与工具', '编织篮与花艺'],
  },
] as const;

export type VenueSample = (typeof VENUE_SAMPLES)[number];
