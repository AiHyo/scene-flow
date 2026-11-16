/**
 * 素材库「SceneFlow_AI_项目素材」统一映射（29 张，2026-10 上传）
 * - 三组前后图同尺寸（1672×941）同裁切：拖动竖线仅改变裁切可见范围，不移动/缩放任一图
 * - before=布置前 / after=布置后，严禁倒置或混配；after 均基于同一场地，不另造场地
 * - ai-cat / user-cat 为透明 PNG（橙白猫·紫围巾 = AI 伙伴；灰白猫·浅绿项圈 = 默认用户头像）
 * - 场景图已转 webp（等比、原分辨率）；封面缩略图请加 loading="lazy"
 */
export const ASSETS = {
  /** 三组同场地前后图 */
  venue: {
    annual: { before: '/images/assets/annual-before.webp', after: '/images/assets/annual-after.webp' },
    birthday: { before: '/images/assets/birthday-before.webp', after: '/images/assets/birthday-after.webp' },
    community: { before: '/images/assets/community-before.webp', after: '/images/assets/community-after.webp' },
  },
  /** 10 个案例封面（与案例内容一一匹配，不随机复用无关照片） */
  caseCover: {
    annual: '/images/assets/annual-after.webp',
    birthday: '/images/assets/birthday-after.webp',
    community: '/images/assets/community-after.webp',
    friends: '/images/assets/inspiration-warm-dinner.webp',
    team: '/images/assets/case-team.webp',
    club: '/images/assets/case-club.webp',
    market: '/images/assets/case-market.webp',
    parentchild: '/images/assets/case-parentchild.webp',
    reading: '/images/assets/case-reading.webp',
    workshop: '/images/assets/case-workshop.webp',
  },
  /** 灵感布置参考（均为可移动/可拆装物件，不改建筑结构） */
  inspiration: {
    dopamine: '/images/assets/inspiration-dopamine.webp',
    memoryWall: '/images/assets/inspiration-memory-wall.webp',
    greenCorner: '/images/assets/inspiration-green-corner.webp',
    warmDinner: '/images/assets/inspiration-warm-dinner.webp',
    signin: '/images/assets/inspiration-signin.webp',
    photoCorner: '/images/assets/inspiration-photo-corner.webp',
    tableCenter: '/images/assets/inspiration-table-center.webp',
    wayfinding: '/images/assets/inspiration-wayfinding.webp',
  },
  /** 物料图（与 MATERIAL_RESOURCES 分类对应） */
  material: {
    balloons: '/images/assets/material-balloons.webp',
    signin: '/images/assets/material-signin.webp',
    markers: '/images/assets/material-markers.webp',
    raffle: '/images/assets/material-raffle.webp',
    lighting: '/images/assets/material-lighting.webp',
    photoprops: '/images/assets/material-photoprops.webp',
    awards: '/images/assets/material-awards.webp',
  },
  /** AI 伙伴：白色小猫·紫色围巾·深紫大眼（统一形象；全身=悬浮助手，脸部=聊天头像取景） */
  aiCat: {
    full: '/images/assets/sceneflow-ai-cat.png',
    face: '/images/assets/sceneflow-ai-cat-face.png',
  },
  /** 默认用户头像：灰白小猫·浅绿项圈（注册无需上传，个人资料可换） */
  userCat: '/images/assets/default-avatar.png',
  /** 活动广场侧栏品牌插画：探头小猫（AI 生成演示配图，仅作氛围装饰） */
  plazaCat: '/images/assets/plaza-cat.webp',
} as const;
