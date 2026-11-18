import { apiRequest } from '@/lib/apiClient';
import type { ProjectData } from '@/types/types';

export interface SceneGenOptions {
  style?: string;
  tags?: string[];
  density?: 'simple' | 'medium' | 'rich';
  extra?: string;
}

/** 统一根据当前项目条件、布置程度与标签构建布置生图 Prompt */
export function buildScenePrompt(data: ProjectData, opts?: SceneGenOptions): string {
  const scene = data.scene ?? {};
  const visualTheme = (data.requirements?.visualTheme?.value as string) || '';
  const styleVal = opts?.style || scene.style || (data.requirements?.style?.value as string) || '现代温馨';
  const density = opts?.density || scene.density || 'medium';
  const tags = opts?.tags ?? scene.tags ?? [];
  const extra = opts?.extra ?? scene.extra ?? '';

  const r = data.requirements ?? {};
  const condParts: string[] = [];
  if (r.headcount?.value) condParts.push(`人数：${r.headcount.value}（桌椅与通道规模按此安排，不得堵门）`);
  if (r.region?.value) condParts.push(`地区：${r.region.value}`);
  if (r.budget?.value || data.budget?.limit != null)
    condParts.push(
      `预算范围：${data.budget?.limit != null ? `${data.budget.limit} 元以内` : ((r.budget?.value as string) ?? '')}（布置强度按预算取轻量方案）`
    );
  const otherNeeds = r.otherNeeds?.trim();
  if (otherNeeds) condParts.push(`其他要求：${otherNeeds}`);
  const avoid = r.avoid?.trim();
  if (avoid) condParts.push(`明确排除：${avoid}（相关元素不得出现）`);

  const readyMats = (data.materials ?? []).filter((m) => m.ready).map((m) => `${m.name}${m.qty ? `×${m.qty}` : ''}`);
  if (readyMats.length > 0) condParts.push(`已有可复用物料：${readyMats.join('、')}（优先使用，不重复采购）`);

  const themePart = visualTheme
    ? `活动视觉主题：${visualTheme}，风格：${styleVal}（新增装饰与配色围绕该主题展开，不改变原有建筑结构）`
    : `主题风格：${styleVal}`;

  const hasBefore = !!scene.beforeUrl;
  const structureRule = hasBefore
    ? '图像编辑任务：<<<image_1>>> 是真实场地照片，以它为唯一底图做局部编辑，输出必须与<<<image_1>>>是同一个房间、同一场地、同一张照片。保持相机机位、视角、透视、焦距与画幅裁切完全一致，视平线和灭点不得偏移。墙体、地面、天花、门窗的位置形状数量样式、窗外景色、梁柱及全部固定装修一律原样保留，不得移动、增删、缩放、重建、改色或改变透视与自然光照方向。只允许在原有空地上添加或调整可移动软装物件（桌椅、背板、帷幔、花艺、灯光道具、展架等），新物件需符合原图透视与比例，不得遮挡门口与主要通道。画面中不得出现任何人物、动物；不要在图片中生成任何文字'
    : '生成一张活动布置氛围概念图（无原始场地照片，仅为概念参考，不对应任何真实场地结构，画面中不要出现人物）';

  const densityPart =
    density === 'simple'
      ? '布置程度：简约档（轻量点缀，仅在关键局部保留简约可移动软装，大面积保留原空间通透开阔，不作大面积密集遮盖）'
      : density === 'rich'
        ? '布置程度：丰富档（高密度视觉层次与饱满装饰，点缀丰满；但严禁突破现有预算，优先调整已有物品摆位和组合，严禁改动任何固定墙体、门窗、立柱、机位或基础结构；需新增物料时按极高性价比安排；装饰密度与结构一致性冲突时，宁可减少物件数量与密度，也绝不改动固定结构或改变空间比例）'
        : '布置程度：适中档（标准活动氛围，主次分明，视觉饱满和谐）';

  const extraText = extra.trim();
  let scopeRule: string;
  if (tags.length > 0 && extraText) {
    scopeRule = `布置范围仅限以下物件与说明：${tags.join('、')}；${extraText}。除清单与说明明确提到的物件外，任何其他物件（包括舞台、投影幕、LED屏、背景板、展架等）一律不得添加`;
  } else if (tags.length > 0) {
    scopeRule = `布置范围仅限以下物件：${tags.join('、')}。除清单明确选中的物件外，任何其他物件（包括舞台、投影幕、LED屏、背景板、展架等）一律不得添加`;
  } else if (extraText) {
    scopeRule = `布置范围以补充说明为准：${extraText}。说明未提到的物件（包括舞台、投影幕、背景板等）一律不得添加`;
  } else {
    scopeRule = '布置范围仅为少量轻量可移动装饰（气球、灯串、桌布等），不得添加舞台、投影幕、背景板等大型设施';
  }

  const parts = [
    structureRule,
    densityPart,
    themePart,
    condParts.length > 0 ? `当前条件：${condParts.join('；')}` : '',
    scopeRule,
    '装饰物件大小与空间比例可信，不遮挡门口与通道；不要在图片中生成任何文字，不要出现任何人物或人群',
  ];
  return parts.filter(Boolean).join('。');
}

/** 提交布置生图任务（同源接口：对话触发、工作区生成按钮、正常/丰富布置共用） */
export async function submitSceneGeneration(
  data: ProjectData,
  opts?: SceneGenOptions
): Promise<{ taskId: string; prompt: string }> {
  const scene = data.scene ?? {};
  const prompt = buildScenePrompt(data, opts);

  /* 参考图强制校验：布置生图必须携带当前活动的场地原图。
   * 缺失时明确报错并停止本次生成，绝不静默退化为纯文字概念生图
   * （纯文字生图无底图约束，必然产出结构完全不同的另一个空间）。 */
  const beforeUrl = scene.beforeUrl?.trim();
  if (!beforeUrl || !/^https?:\/\//.test(beforeUrl)) {
    throw new Error('缺少有效的场地原图，已停止本次生成。请先上传或选择场地照片作为底图后再试。');
  }

  const body: {
    prompt: string;
    resolution: string;
    aspect_ratio: string;
    image_list: Array<{ image: string }>;
  } = {
    prompt,
    resolution: '1k',
    /* 关键修复：有参考图时比例必须自适应原图（auto），而不是强制 16:9。
     * 强制固定比例会迫使上游对原图重新构图/裁切，空间比例与透视随之改变，
     * 这是此前「生图后场地结构像换了个空间」的直接原因之一。 */
    aspect_ratio: 'auto',
    /* 原场地照片以接口规定的参考图参数传入（上游按 image_list 做图生图局部编辑） */
    image_list: [{ image: beforeUrl }],
  };

  const resp = await apiRequest<{
    task_id?: string;
    task_status?: string;
  }>('/api/v1/ai/scene/submit', {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!resp?.task_id) {
    throw new Error(resp?.task_status || '生图任务提交失败');
  }

  return { taskId: resp.task_id, prompt };
}
