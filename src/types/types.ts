/** 需求字段的来源标记：已确定 / AI 建议（待确认）/ 待确定 */
export type ReqSource = 'confirmed' | 'ai' | 'undecided';

export interface RequirementValue {
  value: string | number | null;
  source: ReqSource;
}

export interface ProjectRequirements {
  goal?: string;
  /** 活动类型（如：年会 / 生日派对） */
  type?: string;
  /** 活动类型待确认：引导选择与描述冲突时保留两份原始值供用户选定，选定后清除；选「还没想好」时 type 保持空 */
  typePending?: { options: string[] };
  /** 其他需求／补充说明（自由文本：如「不要让个人上台」「只增加可移动装饰」），进入后续 AI 当前条件 */
  otherNeeds?: string;
  /** 活动视觉主题（如：多巴胺 / 森系），自由输入，可由 AI 推荐 */
  visualTheme?: RequirementValue;
  headcount?: RequirementValue;
  budget?: RequirementValue;
  region?: RequirementValue;
  date?: RequirementValue;
  venueType?: RequirementValue;
  style?: RequirementValue;
  /** 背景故事、组织介绍、近期成果、重点人物、文案语气、避免提及内容 */
  story?: string;
  orgIntro?: string;
  achievements?: string;
  keyPeople?: string;
  tone?: string;
  avoid?: string;
}

export interface Direction {
  id: string;
  name: string;
  style: string;
  highlights: string[];
  note: string;
  /** 准备难度（低/中/较高，AI 建议性描述，非硬事实） */
  difficulty?: string;
  /** 相对预算压力（较低/中等/较高，无可靠价格依据时只给相对描述） */
  budgetLevel?: string;
}

export interface ScheduleItem {
  id: string;
  name: string;
  time: string;
  duration: string;
  note: string;
}

export interface BudgetItem {
  id: string;
  name: string;
  qty: number;
  unitPrice: number;
  /** 价格未确定（待询价）：不计入合计，显示「待询价」而非 ¥0 */
  priceUnknown?: boolean;
}

export interface MaterialItem {
  id: string;
  category: string;
  name: string;
  qty: string;
  ready: boolean;
}

export interface TaskItem {
  id: string;
  name: string;
  owner: string;
  deadline: string;
  done: boolean;
  linkedSession?: string;
}

export interface ProjectCopies {
  invite?: string;
  hosting?: string;
  onsite?: string[];
}

export interface SceneState {
  beforeUrl?: string;
  afterUrl?: string;
  notes?: string;
  /** 示例效果（来自预设案例） */
  isExample?: boolean;
  /** 布置要求标签 */
  tags?: string[];
  /** 布置程度：简约 / 适中 / 丰富（默认适中） */
  density?: 'simple' | 'medium' | 'rich';
  /** 布置主题风格输入（随项目保存并在重开时恢复） */
  style?: string;
  /** 布置补充说明输入（随项目保存并在重开时恢复） */
  extra?: string;
  /** 前后对比分割位置 0-100（随项目保存并在重开时恢复） */
  comparePos?: number;
  /** 已有效果图是否对应调整前的旧要求（修改主题/物料/布置要求后置 true，重新生成后清除） */
  stale?: boolean;
  /** 此次生图实际采用的要求快照（随项目保存，重开可查看） */
  lastReq?: {
    /** 生成时使用的场地原图（结果与原图绑定；当前原图不同则说明对应旧原图） */
    beforeUrl?: string;
    style?: string;
    tags?: string[];
    density?: 'simple' | 'medium' | 'rich';
    extra?: string;
    prompt?: string;
    at?: number;
  };
  /** 进行中的生成任务（随项目保存：切页/刷新后恢复查询，不重发请求、不重复扣费；失败保留待重试） */
  genTask?: {
    taskId: string;
    status: 'querying' | 'failed';
    prompt: string;
    beforeUrl?: string;
    style?: string;
    tags?: string[];
    density?: 'simple' | 'medium' | 'rich';
    extra?: string;
    submittedAt: number;
    error?: string;
  };
}

/** 流程条目字段级补丁：只含用户明确要求变更的字段；未出现的字段原样保留 */
export interface SchedulePatchItem {
  /** 定位：优先稳定条目 ID（模型从方案实况引用），或精确条目名 */
  id?: string;
  name?: string;
  /** 明确要写入的新值（undefined=不动；null 或空串=明确清空该字段） */
  time?: string | null;
  duration?: string | null;
  note?: string | null;
  /** 明确改条目名（重命名）时才提供 */
  rename?: string | null;
}

/** 待应用补丁：确认前与正式数据完全分离；应用端按字段级合并，绝不整套替换 */
export interface AdjustPlan {
  theme?: { name?: string; slogan?: string | null; highlights?: string[] };
  /** 视觉主题/配色：纯配色描述（≤24 字），不得包含整段指令 */
  visualTheme?: string;
  /** 流程局部补丁：按条目定位，只改明确字段 */
  schedulePatch?: SchedulePatchItem[];
  /** 新增流程条目（完整 name/time/duration/note） */
  scheduleAdd?: Array<{ name: string; time?: string; duration?: string; note?: string }>;
  /** 明确要求删除的流程条目名 */
  scheduleRemoveNames?: string[];
  budgetAdd?: Array<{ name: string; qty: number; unitPrice: number | null }>;
  budgetRemoveNames?: string[];
  materialsAdd?: Array<{ category: string; name: string; qty: string }>;
  materialsRemoveNames?: string[];
  sceneTags?: string[];
  sceneStyle?: string;
  sceneExtra?: string;
}

/** AI 提出的跨模块调整建议：确认前不写入成果，只展示影响说明 */
export interface AdjustCard {
  /** 准备修改什么（一句话） */
  change: string;
  /** 会影响的方案/流程/物料/预算/布置要求条目 */
  affects: string[];
  /** 保持不变的内容 */
  keep: string[];
  /** 尚需确认的价格或条件（不虚构金额） */
  pending: string[];
  /** 会改动用户手动编辑内容的提示（无则空数组） */
  manualWarn: string[];
  /** 待写入的局部变更（确认后由 Workbench 按字段精准合并，绝不整套替换） */
  plan: AdjustPlan;
  /**
   * 触发本次建议的用户原文（范围校验：只改 X 其余不变 → 越界补丁直接拒绝）
   */
  sourceText?: string;
  /**
   * 创建卡时受影响条目的原值快照（按补丁定位键）。
   * 应用前比对：等待期间用户手工改过 → 拒绝应用并要求重新发起，不用旧建议覆盖新编辑。
   */
  orig?: {
    schedule?: Array<{ id?: string; name?: string; time?: string; duration?: string; note?: string }>;
    budget?: string[];
    materials?: string[];
    sceneStyle?: string;
    sceneExtra?: string;
    visualTheme?: string;
    themeName?: string;
  };
  /** 卡片状态：pending 待确认 / applying 应用中 / applied 已应用 / skipped 已取消 / editing 再改中 / failed 应用失败 */
  status?: 'pending' | 'applying' | 'applied' | 'skipped' | 'editing' | 'failed';
  /** 应用失败原因（failed 时展示，支持重新发起） */
  failReason?: string;
  /** 部分应用后仍未完成的字段（重试只处理这些，已应用项不重复执行） */
  undoneFields?: string[];
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  ts: number;
  /** 用户消息附带的场地照片（公开 URL，与 scene.beforeUrl 关联） */
  imageUrl?: string;
  /** 图像理解服务对 imageUrl 的真实识别结果（随消息持久化，作为后续对话的视觉上下文） */
  vision?: string;
  /** 场地布置效果图卡片（随消息持久化沉淀在对话流中，支持前后拖拽对比与材料清单） */
  sceneCard?: {
    beforeUrl?: string;
    afterUrl: string;
    style?: string;
    tags?: string[];
    density?: 'simple' | 'medium' | 'rich';
    materials?: Array<{
      name: string;
      category?: string;
      partner?: { name: string; url: string; platform: string };
    }>;
  };
  /** 成果更新标签：模块内生成任务成功写入后附加，展示「已更新到XX」与查看入口（点击切换成果栏页签） */
  actionTag?: { label: string; module: 'plan' | 'scene' | 'budget' };
  /** 本次生成失败后的手动重试入口（随消息持久化，刷新后仍可点击）：
   * 点击继续原任务类型与禁止项，不追加第二条用户请求；重新开始同任务时旧入口标记 resolved 失效 */
  retryAction?: { kind: 'theme' | 'copies' | 'scheme'; resolved?: boolean };
  /** 建议调整确认卡（AI 提出的跨模块调整，确认后才写入成果） */
  adjustCard?: AdjustCard;
  /** 主题/文案替换生成的待确认草稿：先在会话展示拟替换内容与范围，确认后才写入成果模块；
   * 随消息持久化，刷新/重进保持待确认状态，取消保留旧稿 */
  draftCard?: {
    kind: 'theme' | 'copies';
    theme?: ProjectData['theme'];
    /** 草稿创建时刻的原始主题快照：差异展示固定原值，不随当前成果漂移（历史卡不用当前值伪造历史） */
    origTheme?: ProjectData['theme'];
    copies?: ProjectData['copies'];
    status: 'pending' | 'applied' | 'skipped';
  };
}

export interface ProjectData {
  /** 项目 ID（加载时由工作区注入；AiAssistant 草稿等按此键控） */
  id?: string;
  /** 成果栏卡片展开/收起状态（按 section key 持久化；allCollapsed 为全局收起） */
  ui?: {
    collapsed?: Record<string, boolean>;
    allCollapsed?: boolean;
  };
  description?: string;
  requirements?: ProjectRequirements;
  directions?: Direction[];
  selectedDirectionId?: string;
  theme?: {
    name?: string;
    slogan?: string;
    highlights?: string[];
  };
  schedule?: ScheduleItem[];
  budget?: {
    limit?: number | null;
    items: BudgetItem[];
  };
  materials?: MaterialItem[];
  tasks?: TaskItem[];
  copies?: ProjectCopies;
  scene?: SceneState;
  /** 待确认操作（覆盖确认等）：持久化目标/范围/输入快照，刷新或重开后恢复可操作确认入口；
   * 仅记录用户尚未做出的决定，不自动确认、不自动执行；确认一次才执行，取消即清除 */
  pendingConfirm?: {
    kind: 'scheme' | 'directions';
    /** 快照的目标方向（恢复时重新核对：目标或方案被编辑则不拿过期快照覆盖，交用户重新决定） */
    directionId: string;
    /** 原触发来源（chat=对话分发，恢复执行时不再合成用户请求） */
    viaChat: boolean;
    ts: number;
  } | null;
  /** 套用案例时携带的案例封面（项目卡片封面回退用） */
  caseCoverUrl?: string;
  /** 复制来源案例 ID（旧案例副本无此字段时按描述匹配案例封面，仅渲染回退） */
  caseId?: string;
  chatLog?: ChatMessage[];
  /** 初始入口：venue = 从场地照片开始 */
  intent?: 'venue' | 'plan';
}

export interface ProjectRow {
  id: string;
  ownerId: string;
  title: string;
  coverUrl: string | null;
  data: ProjectData;
  /** 乐观锁版本号：保存时作为 expectedVersion 提交 */
  version: number;
  createTime: string;
  updateTime: string;
}

export interface ProjectListItem {
  id: string;
  title: string;
  coverUrl: string | null;
  version: number;
  updateTime: string;
  createTime: string;
  /** 项目数据（列表页判断进度 / 封面回退 / 类型标签） */
  data?: ProjectData;
}

export const emptyProjectData = (): ProjectData => ({
  description: '',
  requirements: {},
  directions: [],
  schedule: [],
  budget: { limit: null, items: [] },
  materials: [],
  tasks: [],
  copies: {},
  scene: {},
  chatLog: [],
});

/* ===================== 静态内容类型（灵感库 / 案例） ===================== */

export interface InspirationSection {
  heading: string;
  body: string;
}

export type InspirationSceneId = 'personal' | 'org' | 'campus' | 'community' | 'culture';

export interface InspirationEntry {
  id: string;
  title: string;
  /** 适用场景（多对多关联，同一条灵感可适用多个场景，不复制充数） */
  scenes: InspirationSceneId[];
  /** 内容类型：game=游戏与互动 show=节目与仪式 decor=主题与布置 props=物料与道具 food=餐饮与氛围 copy=文案与小创意 */
  contentType: 'game' | 'show' | 'decor' | 'props' | 'food' | 'copy';
  /** 一句话说明玩法/用途（浏览时即可理解点子） */
  howTo: string;
  /** 组织形式（如：分组对抗 · 10–20 分钟） */
  format: string;
  /** 空间与道具需求（如：白板与马克笔、题卡） */
  needs: string;
  /** 拓展内容（配音秀/小品/情景剧等，不作默认首推，列表沉底展示） */
  ext?: boolean;
  tags: string[];
  sections: InspirationSection[];
  /** 参考图（仅主题与布置类使用，明确为参考效果） */
  coverUrl?: string;
  refImages?: string[];
  /** 数量估算等表格（物料类使用） */
  table?: { columns: string[]; rows: string[][] };
}

/** 筹备参考文章（辅助内容，不作为灵感库主展示） */
export interface PrepNote {
  id: string;
  title: string;
  summary: string;
  scenes: InspirationSceneId[];
  sections: InspirationSection[];
}

export interface CaseTemplate {
  id: string;
  name: string;
  category: 'personal' | 'org' | 'campus' | 'community' | 'culture';
  intro: string;
  tags: string[];
  coverUrl: string;
  /** 完整案例（含完整 ProjectData 可复制创建） */
  full: boolean;
  /** 套用判断元数据：活动类型 / 人数 / 预算范围 / 时长 */
  activityType: string;
  headcountNote: string;
  budgetNote: string;
  durationNote: string;
  /** 核心亮点（3 条以内） */
  highlights: string[];
  demo: ProjectData;
}
