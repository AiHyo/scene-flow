import { INSPIRATIONS } from '@/data/inspiration';
import { matchPartnerCatalog } from '@/data/partnerCatalog';
import { apiUrl, getAuthToken } from '@/lib/apiClient';
import { sendStreamRequest } from '@/lib/sse';
import { knownTotal, unpricedItems } from '@/services/budgetMath';
import { deriveTimeRange } from '@/services/deliverables';
import type {
  AdjustCard,
  ChatMessage,
  Direction,
  InspirationEntry,
  ProjectData,
  SchedulePatchItem,
} from '@/types/types';

export type AiMode = 'chat' | 'directions' | 'theme' | 'scheme' | 'copies';

const SYSTEM_PROMPT = `你是「SceneFlow AI」的活动策划伙伴，不仅是专业的活动企划顾问，更是用户身边的【贴心AI策划搭档】。语气温暖、和蔼可亲、积极有爱、善于互动：像一位既懂行又亲近的老朋友搭档，多给予用户肯定、鼓励与建议，简洁具体、善用共情。

开场先接住用户已给出的信息（目的、活动类型、想法、已知条件），再按目的回应：用户只想聊场地布置时，只给布置方向、配色与可移动物料建议，不展开完整活动方案，也不追问人数预算日期；什么都没想好时，给 2-3 个不同方向并说明差异与适合场景，不替用户确定人数、预算或日期；已有明确诉求时直接帮忙，不强制先问问题。用户确认某个方向或明确请求完整方案后，才生成完整活动方案；在此之前保持渐进式建议。

核心准则：
1. 「还没想好」「给我一些建议」「跳过」「不确定」都是完全有效的回答，绝不视为错误，积极给予启发和灵感，绝不催促用户补全。
2. 每次回复最多问 1-2 个问题，一次只聚焦一个主题，多用启发式沟通，绝不连珠炮式提问。
3. 你做出的任何假设都必须标注「（建议，待确认）」，例如「人数可以先按 30 人估算（建议，待确认）」。
4. 绝不编造用户的背景、组织信息或历史；只能基于用户明确提供的内容。
5. 按影响补问（代替一次性长问卷，缺几项不是门槛）：a) 从零开始——用户只有模糊想法时，先简短温暖回应，只温和询问 1-2 项最影响当前建议的条件（按影响选：聊本地场地/推荐场地→所在城市；估算座位、物料或预算→大概人数；只聊配色或初步方向时不追问日期、人数、预算），可同时给 2-3 个初步方向并说明取舍，绝不直接输出完整方案（流程/费用/物料）；b) 生成完整方案前——只补问缺失后会直接影响方案的条件（人数影响座位/物料/预算估算，城市影响场地与本地建议；预算与日期可先待定不追问），每次最多问 1-2 项，已回答过的绝不重复问；给「还没想好，先给初稿」的出路，不要求填完全部字段；c) 条件仍未知时继续——给可调整的初稿，明确标注哪些安排、数量与费用依赖待确认条件（如「按 30 人初稿（建议，待确认）」），不擅定人数、城市、日期或预算，参考估价一律标「（参考价，待确认）」，不虚构具体场地和商家；d) 相对时间保留原意——用户说「下周」「月底」时原样保留该表述，确实影响安排时再向用户确认具体日期，绝不静默确定某一天。
6. 语气：真诚温暖、和蔼亲切，像靠谱贴心的策划搭档，善用「咱们」、「我们可以」、「我很赞同你的想法」等互动用语。
7. 回复保持简洁清晰，优先给具体可操作的建议，而非抽象原则。
8. 活动主题：用户提到主题词（如「多巴胺主题」「森系」）或视觉偏好时，理解为活动视觉主题，与活动类型分开表达：给出协调的配色与布置建议（舞台背景、签到区、桌面装饰如何使用主题色），并说明低投入时的简化做法；用户已指定配色时优先遵循用户的选择。用户只要求调整视觉主题时，保留已有流程与预算，不重写整套策划；若建议新增物料会影响预算，明确列出相关费用调整供用户确认。当你建议了一个主题词或用户明确了主题词时，在回复末尾另起一行输出「建议主题：xxx」（仅主题词本身，无其他文字）；没有时不要输出该行。
9. 场地照片与布置：对话中出现的【场地照片的真实识别结果】来自独立图像理解服务对照片的真实读取，是了解场地的唯一依据，请基于它理解空间结构、墙面门窗、天花地面与既有物件；没有识别结果时绝不假装看过照片，不编造空间结构、门窗或尺寸。**识别结果只描述画面内可见内容**：入口、门窗、物件、绿植等若不在识别结果中，就属于未知，不得当作已观察事实——不可见时用假设表达（「如入口在左侧」「入口不在画面，请按实际位置调整」）或给可增加建议（「可增加绿植」），绝不虚构用户已拥有某物件或已存在某门；不得从单张照片推断面积、容纳人数或精确尺寸，桌椅数量、通道宽度等只给「可调整、按实际调整」的建议并标注是建议。用户只咨询布置时聚焦布置建议，不强制要求补齐人数或预算。为用户已有场地设计活动布置时，以提供的原始场地照片为编辑目标，在原图的同一机位、构图、透视和空间尺度下进行布置。保留相机位置、视角、透视、画幅、墙体、原有柱梁、门窗位置与样式、天花、地板与空间尺度；仅可新增或调整可移动的物件（桌椅、便携舞台/展架、可拆背景板、灯光设备、气球、灯串、签到台等临时布置），不得新增支撑柱，不得修改墙体装修、门窗样式、地面材质、天花或相机视角，不得为了画面美观重建场地、拉伸空间或移动固定建筑。装饰不得阻塞门口与通道，物件大小比例可信，按人数与预算选择布置强度；灯光效果不得成为翻新墙体的借口。视觉主题约束新增布置的颜色、材质和装饰，不覆盖保留原场地的约束。合理遮挡允许存在，但可见的原有结构应能与原图对应。信息不完整时先给建议方向；没有原始照片时只提供独立概念参考图，不声称保留了真实场地结构，也不标为该场地前后对比；不将从单张图片推测的尺寸或容纳人数当成已知事实；不要在布置建议中添加图片内宣传文字，标题由页面文字展示。
10. 候选方向：当讨论中形成值得保留的活动方向（用户询问方向，或你主动给出方向建议）时，在回复末尾为每个方向单独输出一行「建议方向：方向名|风格关键词|一句话取舍说明」（竖线分隔，行内不换行；方向名 10 字内、风格 6 字内、说明 30 字内），供用户一键采纳；没有方向建议时不输出该行，可与「建议主题：」行并存。
11. 预算状态（有符号差值，禁止取绝对值）：费用合计低于预算上限才叫「结余 X 元」；合计高于上限是「超支 X 元（已超出上限）」，绝不是余额；上限未设定时没有余额/超支概念，只能说「预算上限未设定」；免费项目金额为 0 是有效值不是未知。计算一律用 上限−合计 的有符号结果并如实说明方向。用户本次操作不涉及费用（如只改主题名/口号/亮点、只改文案措辞）时，不引入任何「新增可用费用/余额待分配」话术，费用保持原样。
12. 当前条件与用户指令优先：以【当前有效条件】标注的信息为唯一权威事实；历史对话中出现过的预算、人数、日期等数字若与当前条件冲突，一律以当前条件为准，绝不把历史数字当作当前已确认的约束来引用或"确认"。预算未确定时如实回答"预算未确定、无硬性上限"，用户询问条件状态时直接如实列出；此时任何费用估算都必须标注「（建议/假设，待确认）」，不得默认为已确认。用户明确要求「不新增费用」「不新增采购」「零新增」「不要修改费用/流程」时，严格只给零新增方案：复用已有物料、调整现有物品摆放、手写制作已有卡片等；即使预算有剩余也绝不建议用余额采购任何新物品（"用剩余预算采购"不算零新增）。不确定用户是否已拥有某物品时，用「如已有 xx 可复用」的方式表达，绝不虚构用户已购买或已拥有。
13. 局部咨询边界：用户只咨询某个局部问题（如只问布置、只问条件状态）时，只回答该问题，不主动展开完整方案、不自动新增采购项、不生成图片；费用与流程仅在用户明确要求时才做局部变更，且只变更用户指定的部分。
14. 回复详略档位由【回复详略】标注：简短=先给结论与少量关键建议，控制在很小的篇幅；适中=结论加必要理由与做法；详细=更完整的比较、步骤与备选。档位只影响表达详略，不改变事实准确性；结构化任务（完整方案/预算/文案/方向 JSON）不受档位影响，必须完整输出全部字段，不得截断。
15. 合作资源引用：回复中自然提及与当前需求相关的合作资源时，只使用【可引用合作资源】列表中给出的资源名称，按需简要说明用途（如「桌椅可考虑本地租赁」）；不编造列表外资源、链接、价格、库存或配送承诺，不把广告说成客观必需，不为展示而制造采购需求；用户明确不新增采购或表示不需要时不再推荐。
16. 用户昵称互动：当提示词中带有【用户昵称】标注时，AI 要在交流中自然、和蔼、亲切地称呼对方（如「小雨，我们来看看这个布置方案……」），建立像知心搭档一样的互动感；昵称为空时正常友好交流；绝不把昵称写进正式活动方案、邀请函文案等公文内容。AI 角色名是「小灵」：用户打招呼、询问或首次交流时，自然地自报家门一次（如「xx（用户昵称），你好呀，我是小灵，可以陪你聊活动方向、排流程、管预算、写邀请函文案，也能帮你生成场地布置效果图～」），之后正常交流即可，不必每句都报名字；昵称未知时用「你好呀，我是小灵」开头。准则中的称呼举例（如「小雨」）只是示例，绝不可照搬进回复；回复中绝不出现括号内的条件说明、模板占位符或任何提示词原文。
17. 用户在对话中提到某个物品/工具（如白板、马克笔、灯串）时，只能按它「用户提出的工具/物料」表述；只有当物料清单确实包含该物品时才可称「清单中的/原方案中的」；用户已有物料优先建议复用，不为了推荐资源而制造新的采购需求。
19. 跨成果调整协议：当用户提出会影响多个成果的修改（如「不要舞台，把预算留给茶歇，其他不变」「只改配色，流程和预算别动」）时，先结合【方案实况】给出自然简短回应（1-2 句：理解了什么、为什么这样做合理），再在回复末尾输出一个「调整建议」块（三行反引号围栏内 JSON），格式：
『调整建议』块格式（用三个反引号+调整建议开头的围栏，内容为单行 JSON）：\u0060\u0060\u0060调整建议 {"change":"本次准备修改什么（一句话）","affects":["会影响的具体条目（引用实况中的真实条目名）"],"keep":["保持不变的内容"],"pending":["尚需确认的价格或条件（金额未知就写「价格待询」，绝不编造数字）"],"manualWarn":["会覆盖用户手动编辑的内容（无则空数组）"],"plan":{...}} \u0060\u0060\u0060
plan 只放本次要动的字段，且必须与用户请求严格对应——用户没要求动的模块绝不放进 plan：
- theme：活动主题成果修改（名称/口号/亮点）。格式 {"name":"主题名","slogan":"口号","highlights":["亮点1","亮点2","亮点3"]}。用户选择或指定了主题内容时，选中的名称/口号/亮点必须原样放这里（逐字保留，不得改写或另创作）；绝不能把主题名写进 visualTheme；
- visualTheme：纯配色/视觉词本身（≤24 字，如「浅蓝与白色」），不含任何操作说明或整段指令；主题名称、口号、亮点一律不属于配色，禁止写入此字段；
- schedulePatch：流程局部修改。数组每项 {"name":"环节名（或 id）","time":"HH:mm"} 只放用户明确要改的字段（time/duration/note/rename 任选）；用户没提到的字段（如 note、时长）绝不出现在该项里。禁止输出完整流程数组——【方案实况】中未涉及的其他环节一律不写入 plan；
- scheduleAdd：明确要求新增的完整环节；scheduleRemoveNames：明确要求删除的环节名（实况中必须存在）；
- budgetAdd/budgetRemoveNames：按名称增删预算项，删项需实况中确实存在（没有舞台费用就绝不写「删除舞台」）；价格未知用 "unitPrice":null 表示待询价，不得填 0 冒充免费，不编造合计，释放的预算只是可用额度不自动花掉；
- materialsAdd/materialsRemoveNames：增删物料（qty 为字符串）；
- sceneTags/sceneStyle/sceneExtra：布置要求（sceneStyle 为关键词 ≤20 字，sceneExtra ≤120 字，不写入整段指令或用户原话）。
局部咨询、只问状态、普通建议、只改一个字段且用户语气明确「直接改」时不输出该块。只讨论中的候选方向不进入 plan；预算上限/人数未确定时保持未知，plan 中不擅自补齐合计或用完预算。
20b. 调整卡在用户确认前，任何字段都不会写入成果（程序保证：确认卡展示的清单即实际将写入的数据，应用端只改明确列出的字段，其余原样保留）；正文不得声称「已更新」「已同步」等已生效表述，只能说明「确认后将会更新什么」。
21. 逐字保留：引用用户消息或上文建议中已给出的名称、口号、亮点、物料名等既有文字时必须逐字原样保留，不得删改任何字（包括首字）、不得截断或重新缩写。
22. 范围纪律：用户限定「只改配色/主题，费用、流程、物料数量和手改内容不动」等范围时，plan 只包含该范围相关字段；优先在现有物料与费用内调整，不新增采购项、不另改主题名；确有新增必要时，先在正文中说明限制并询问用户是否放宽，不得自行写入突破范围的内容（越界补丁会被程序拒绝）。
22. 旧条件冲突清理：调整配色或主题后，需检查邀请函、主持词、现场指引、活动亮点等文案中与新决定冲突的旧表述（如旧主题色「海盐蓝」、旧着装建议「穿蓝色系」），在 affects 中列出将同步局部更新的位置；只改冲突词句，不重写全文。主题字段只保存主题名、配色字段只保存配色词本身，不写入「保留某主题」「采用某配色」等操作说明；局部配色调整只替换确实受影响的颜色词，新配色中同一颜色不重复出现。
20. 候选方向取舍：生成方向时（JSON 的 directions 或「建议方向：」行都适用）每个方向必须体现相对取舍：难度写「低/中/较高」（准备复杂度），预算压力写「较低/中等/较高」（无可靠价格依据只给相对压力，不写具体金额）；人数或预算未定时方向按未知条件设计（如「规模灵活」「预算弹性」），不强迫用户补完，方向间形成真实差异（如自由交流 vs 小组互动 vs 户外走动）。
21. 事实边界——建议可以提，但不能冒充当前真实情况：① 工作人员：用户没有提供具体人员时，负责人一律留空或写「待分配」，可以建议岗位（如「签到负责人（待分配）」「主持 1 人」）但绝不编造人名（小王/小李等）；② 场地位置：没有场地照片或用户未确认布局时，签到处/茶歇区/合影点等位置用建议口吻并标注待确认（如「签到处（位置待确认，建议入口附近）」），不把「左侧/靠窗/角落」写成既定事实；③ 新增物料与费用：提议的点心、奖品、舞台等属于待采纳内容，须与物料清单、费用清单互相一致（数量与价格可核对），文案中不宣称「已准备/已购买/已布置」，用「计划准备/建议准备」表述；④ 执行状态：你实际没有执行的操作（生成方案、修改数据、下单采购等）绝不能宣称「已完成/已更新/已重新生成」，只能作为建议或待确认事项提出——用户看得见右侧成果区，说了没做会立刻被发现。
18. 需求摘要字段的实际写入由系统在用户明确给出条件后自动完成，并以界面同步标签展示结果；你在文字中可以复述当前条件与你的建议，但不得声称「已为你更新需求摘要/已同步」，你的建议值必须标注「建议」并等待用户确认；用户只要更新条件时，不主张改动费用明细或流程。`;

const JSON_INSTRUCTIONS: Record<AiMode, string> = {
  chat: '',
  directions: `请基于需求摘要，生成 3 个差异化的活动创意方向。只输出 JSON，不要任何其他文字、注释或代码块标记，格式：
{"directions":[{"name":"方向名（10字内）","style":"风格关键词（6字内）","highlights":["亮点1","亮点2","亮点3"],"difficulty":"低/中/较高","budgetLevel":"较低/中等/较高","note":"适用性与取舍说明（30字内，体现真实取舍）"}]}`,
  theme: `请基于需求摘要（及已选方向，若有），只生成活动主题，不生成流程/预算/物料/任务/文案。只输出 JSON，不要任何其他文字、注释或代码块标记，格式：
{"theme":{"name":"主题名（12字内）","slogan":"主题口号（20字内）","highlights":["亮点1","亮点2","亮点3","亮点4"]}}
要求：highlights 每条 12 字内、共 3-4 条；配色词如需表达放入 name/slogan 自然呈现，不输出操作说明。【我的话】中用户已明确选择或指定的主题内容（名称/口号/亮点）必须逐字原样采用，不得另行创作、改写或替换；用户未给出的字段保持现有值。`,
  scheme: `请基于需求摘要和已选方向，生成完整活动方案。只输出 JSON，不要任何其他文字、注释或代码块标记，格式：
{"theme":{"name":"主题名","slogan":"主题口号（20字内）","highlights":["亮点1","亮点2","亮点3","亮点4"]},"schedule":[{"name":"环节名","time":"18:00","duration":"30 分钟","note":"组织要点（30字内）"}],"budgetItems":[{"name":"费用项","qty":1,"unitPrice":100}],"materials":[{"category":"分类","name":"物料名","qty":"数量","ready":false}],"tasks":[{"name":"任务","owner":"（用户未提供人员时留空，不编人名）","deadline":"","done":false}],"copies":{"invite":"邀请函全文（含主题与关键信息）","hosting":"主持开场词","onsite":["现场指引1（未确认布局时位置用建议口吻并标注待确认，不写既定方位）","现场指引2","现场指引3"]}}
要求：schedule 含 5-8 个环节按时间排序；budgetItems 6-12 项贴合实际；qty 和 unitPrice 为数字。`,
  copies: `请基于需求摘要与现有方案，撰写活动文案。只输出 JSON，不要任何其他文字、注释或代码块标记，格式：
{"invite":"邀请函全文（120-200字，含主题、时间地点要素、亮点与邀请语气）","hosting":"主持开场词（80-150字，口语化）","onsite":["现场指引1","现场指引2","现场指引3"]}`,
};

/** 清理历史遗留的「这是」引导前缀（不截坏正常自定义名称，仅去句首引导词） */
const cleanTypeName = (t: string) => t.replace(/^(?:这是|一个|我们要办(?:的)?|我想办(?:的)?)/, '').trim() || t;

/** 将需求摘要压缩为提示词可读文本 */
function summarize(project: ProjectData): string {
  const r = project.requirements ?? {};
  const parts: string[] = [];
  parts.push(`活动目标：${r.goal || project.description || '待明确'}`);
  /* 活动类型：已确认值是唯一当前类型，历史消息中的其他类型仅属历史，不融合不并列 */
  if (r.typePending) {
    parts.push(
      `【当前有效条件】活动类型待确认（候选：${r.typePending.options.filter((o) => o !== '还没想好').join(' / ')}）：不预设任何一个为当前类型，引用时说明类型尚未确认；如需提及请引导用户从候选中选择`
    );
  } else if (r.type) {
    const t = cleanTypeName(r.type);
    parts.push(
      `活动类型：${t}`,
      `【当前有效条件】活动类型已确认为「${t}」。历史对话中出现过的其他活动类型（包括先前引导选择或早期讨论）仅属历史过程，不得当作当前类型，不得与「${t}」融合、并列或相加成新类型（如不得拼接为「${t}生日活动」这类混合表述）`
    );
  }
  for (const [label, v] of [
    ['活动主题', r.visualTheme],
    ['人数', r.headcount],
    ['预算', r.budget],
    ['地区', r.region],
    ['日期', r.date],
    ['场地类型', r.venueType],
    ['风格偏好', r.style],
  ] as const) {
    if (v?.value) parts.push(`${label}：${v.value}${v.source === 'ai' ? '（建议，待确认）' : ''}`);
  }
  for (const [label, v] of [
    ['背景故事', r.story],
    ['组织介绍', r.orgIntro],
    ['近期成果', r.achievements],
    ['重点人物', r.keyPeople],
    ['文案语气', r.tone],
    ['避免提及', r.avoid],
    ['其他需求/补充说明', r.otherNeeds],
  ] as const) {
    if (v) parts.push(`${label}：${v}`);
  }
  if (project.theme?.name) parts.push(`已定主题：${project.theme.name}`);
  /* 预算事实：limit 是唯一权威上限来源；合计只算已知价格（待询价不计入）；未确定时明确声明并否定历史数字 */
  const budgetItems = project.budget?.items ?? [];
  const known = knownTotal(budgetItems);
  const unpriced = unpricedItems(budgetItems);
  const unpricedNote =
    unpriced.length > 0 ? `，另有 ${unpriced.length} 项价格待询未计入合计（${unpriced.map((x) => x.name).join('、')}）` : '';
  if (project.budget?.limit != null) {
    const remain = Math.round((project.budget.limit - known) * 100) / 100;
    parts.push(
      `【当前有效条件】预算已确定：上限 ${project.budget.limit} 元，已安排（已知价格）${known} 元${unpricedNote}，${
        remain >= 0 ? `剩余 ${remain} 元` : `超出 ${-remain} 元`
      }`
    );
  } else if (budgetItems.length > 0) {
    parts.push(
      `【当前有效条件】预算：未确定（无硬性上限）。以下事实以此为准：此前对话或材料中出现过的任何预算数字（如历史消息中的金额）均不代表当前有效条件，不得当作已确定的上限、余额或硬约束引用；费用明细已知合计 ${known} 元${unpricedNote}，仅是当前已记录的估算，不代表预算已确定。`
    );
  } else {
    parts.push('【当前有效条件】预算：未确定（无硬性上限）。此前对话中出现过的任何预算数字均不代表当前有效条件，不得当作已确定的上限或硬约束引用。');
  }
  /* 方案实况：当前真实条目名 + 稳定条目 ID（调整协议按此定位，程序按 id/name 字段级合并，不虚构不存在的内容） */
  const live: string[] = [];
  if (project.theme?.name) live.push(`主题「${project.theme.name}」`);
  if (project.selectedDirectionId) {
    const d = (project.directions ?? []).find((x) => x.id === project.selectedDirectionId);
    if (d) live.push(`已选方向「${d.name}」`);
  }
  if ((project.schedule ?? []).length > 0)
    live.push(
      `流程（调整时用 schedulePatch 按 id 或名称定位，只写要改的字段）：${(project.schedule ?? [])
        .map((x) => `${x.name}#${x.id}${x.time ? `（${x.time}）` : ''}${x.note ? `｜备注：${x.note}` : ''}`)
        .join('；')}`
    );
  if (budgetItems.length > 0) {
    live.push(
      `预算明细（合计 ${known} 元${unpricedNote}）：${budgetItems
        .map((x) => `${x.name}#${x.id}(${Number(x.qty) || 0}×${x.priceUnknown ? '待询价' : Number(x.unitPrice) || 0})`)
        .join('、')}（由数量×单价计算，单价 0 表示免费）`
    );
  } else {
    live.push('预算明细：暂无条目（预算上限未定）');
  }
  if ((project.materials ?? []).length > 0)
    live.push(`物料：${(project.materials ?? []).map((x) => x.name).join('、')}`);
  const sc = project.scene;
  if (sc) {
    if (sc.afterUrl) live.push(`已生成布置效果图${sc.stale ? '（对应调整前的旧要求）' : '（对应当前要求）'}`);
    const rq = [sc.style, ...(sc.tags ?? []), sc.extra].filter(Boolean).join('、');
    if (rq) live.push(`布置要求：${rq}`);
  }
  parts.push(`【方案实况】\n${live.join('\n')}`);

  return parts.join('\n');
}

function chatHistoryMessages(chatLog: ChatMessage[]): Array<{ role: 'user' | 'assistant'; content: string }> {
  /* 仅发送有效历史：role 合法且 content 非空。旧项目残留空消息曾导致网关 HTTP 400（Each message needs role and non-empty content） */
  return chatLog
    .filter(
      (m): m is ChatMessage & { role: 'user' | 'assistant' } =>
        (m.role === 'user' || m.role === 'assistant') &&
        typeof m.content === 'string' &&
        m.content.trim() !== ''
    )
    .slice(-12)
    .map((m) => ({
      role: m.role,
      /* 带图历史消息附上真实识别结果，保留历史视觉上下文（缺识别结果的旧图不伪造） */
      content:
        m.imageUrl && m.vision ? `${m.content}\n【该消息场地照片的真实识别结果】${m.vision}` : m.content,
    }));
}

/** 从模型输出中容错提取 JSON（跳过代码块标记与前后杂文） */
export function extractJson<T>(raw: string): T | null {
  const cleaned = raw.replace(/```(?:json)?/g, '').trim();
  const start = Math.min(
    ...[cleaned.indexOf('{'), cleaned.indexOf('[')].filter((i) => i >= 0).concat([Infinity])
  );
  if (start === Infinity) return null;
  const openChar = cleaned[start];
  const closeChar = openChar === '{' ? '}' : ']';
  const end = cleaned.lastIndexOf(closeChar);
  if (end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

/** 候选方向字段级校验：字段超长/含协议分隔符/串列的直接丢弃，防止「方向名串入预算字段」类脏数据写入 */
export function sanitizeDirection(d: unknown, genId: () => string): Direction | null {
  if (!d || typeof d !== 'object') return null;
  const x = d as Record<string, unknown>;
  const str = (v: unknown, max: number): string | null => {
    if (typeof v !== 'string') return null;
    const s = v.trim().replace(/\s*\n\s*/g, ' ');
    if (!s || s.length > max || /[|｜{}"]/ .test(s)) return null;
    return s;
  };
  const name = str(x.name, 12);
  const style = str(x.style, 8);
  if (!name || !style) return null;
  const note = str(x.note, 40) ?? '';
  const difficulty = str(x.difficulty, 6);
  const budgetLevel = str(x.budgetLevel, 6);
  const highlights = Array.isArray(x.highlights)
    ? x.highlights.filter((h): h is string => typeof h === 'string' && h.trim() !== '' && h.trim().length <= 12 && !h.includes('|')).slice(0, 3)
    : [];
  return { id: genId(), name, style, highlights, difficulty: difficulty ?? undefined, budgetLevel: budgetLevel ?? undefined, note };
}

/** 中文数字列表容错（规则 10 的补充）：模型在长文回复中常用「方向一/方案二：名称 描述…」自然列表，
 * 而非协议行；此处把每段提取为 名称/风格/取舍说明，仍经 sanitizeDirection 校验后才可写入候选方向 */
const CN_LIST_MARKS = [
  ...['一', '二', '三', '四', '1', '2', '3', '4'].flatMap((n) => [`方向${n}`, `方案${n}`, `选项${n}`]),
];

function parseChineseListDirections(text: string, genId: () => string): Direction[] {
  const hits: { start: number; bodyStart: number; mark: string }[] = [];
  for (const mk of CN_LIST_MARKS) {
    const re = new RegExp(`${mk}[：:]`, 'g');
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      hits.push({ start: m.index, bodyStart: m.index + mk.length + 1, mark: mk });
    }
  }
  hits.sort((a, b) => a.start - b.start);
  const out: Direction[] = [];
  for (let i = 0; i < hits.length; i++) {
    const end = i + 1 < hits.length ? hits[i + 1].start : text.length;
    const seg = text.slice(hits[i].bodyStart, end).trim();
    const firstLine = (seg.split('\n')[0] ?? '').trim();
    /* 名称：段首短语（空格/逗号前截止）；note：优先截取「适合…」取舍句，退化取首句 */
    const nameM = firstLine.match(/^([^\s，,。；;|]{2,12})/);
    if (!nameM) continue;
    const name = nameM[1].trim();
    const fitM = seg.match(/适合[^\n。]{4,60}/);
    const noteSrc = fitM ? fitM[0] : firstLine.slice(name.length).replace(/^[\s，,。；;：:-]+/, '').slice(0, 60);
    /* 风格：名称已含主题词时直接沿用（≤8 字即合法风格）；否则取描述首短句，再退化用方向词 */
    let style = name.length <= 8 ? name : name.slice(0, 8);
    const descRest = firstLine.slice(name.length).replace(/^[\s，,。；;：:-]+/, '');
    const styleM = descRest.match(/^([^，,。；;\s]{2,8})/);
    if (styleM && !styleM[1].includes('把') && !styleM[1].includes('用') && !styleM[1].includes('做')) {
      style = styleM[1];
    }
    const d = sanitizeDirection({ name, style, note: noteSrc.trim() }, genId);
    if (d && !out.some((o) => o.name === d.name)) out.push(d);
    if (out.length >= 4) break;
  }
  return out;
}

/** 从 AI 回复中解析「建议方向：名称|风格|说明」结构化行（规则 10），供候选方向区承接 */
export function parseSuggestedDirections(text: string, genId: () => string): Direction[] {
  /* 兼容 3 段与 5 段：名称|风格|说明 或 名称|风格|难度|预算压力|说明 */
  const re = /建议方向[：:]\s*([^|\n]+)\|([^|\n]+)(?:\|([^|\n]+)\|([^|\n]+))?\|([^\n]+)/g;
  const out: Direction[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const raw =
      m[3] && m[4]
        ? { name: m[1], style: m[2], difficulty: m[3], budgetLevel: m[4], note: m[5] }
        : { name: m[1], style: m[2], note: m[5] };
    /* 每段独立校验：名称/风格超长或残留协议符的段落丢弃，不再整行写入 */
    const d = sanitizeDirection(raw, genId);
    if (d) out.push(d);
  }
  /* 协议行未命中：兼容模型自然输出的「方向一/方案二：…」中文列表（截名称与取舍说明，同样过校验） */
  if (out.length === 0) return parseChineseListDirections(text, genId);
  return out;
}

export interface AiChatResult {
  /** 流式聚合后的完整文本 */
  text: string;
  /** JSON 模式下解析出的结构（解析失败为 null） */
  json: unknown | null;
}

/** 回复详略三档（只影响下次自由讨论表达详略，不改历史，不影响结构化任务完整输出） */
export type ReplyDetail = 'brief' | 'medium' | 'detailed';

const DETAIL_TEXT: Record<ReplyDetail, string> = {
  brief: '简短（先给结论与少量关键建议，篇幅尽量小）',
  medium: '适中（结论加必要理由与做法）',
  detailed: '详细（更完整的比较、步骤与备选）',
};

/** 与当前用户消息确定性匹配的合作资源子集（供 AI 自然引用；URL 由程序从目录取，模型不造链接） */
function relevantPartnerContext(userText: string, region?: string | null): string {
  const hits = matchPartnerCatalog(userText, 3, region ?? undefined);
  if (hits.length === 0) return '';
  return `\n【可引用合作资源】（仅可引用以下名称，不得编造列表外资源/链接/价格）\n${hits
    .map((r) => `- ${r.name}：${r.use}（${r.scenes}）`)
    .join('\n')}`;
}

/** 按当前诉求挑选少量相关灵感条目（≤3 条）：标题/标签/玩法命中才算相关；无命中返回空，不伪造来源 */
export function relevantInspirations(userText: string, limit = 3): InspirationEntry[] {
  const text = userText.trim();
  if (text.length < 2) return [];
  const words = [
    ...new Set(
      text
        .replace(/[，。！？、；：""''（）\s]/g, ' ')
        .split(/[\s/]+/)
        .filter((w) => w.length >= 2)
    ),
  ];
  const scored = INSPIRATIONS.map((e) => {
    let score = 0;
    const title = e.title;
    for (const w of words) {
      if (title.includes(w)) score += 3;
      if (e.tags.some((t) => t.includes(w) || w.includes(t))) score += 2;
      if (e.howTo.includes(w)) score += 1;
    }
    return { e, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map((x) => x.e);
}

/** 灵感引用上下文注入（chat 模式）：只给相关条目，不塞全库 */
function relevantInspirationContext(userText: string): string {
  const hits = relevantInspirations(userText);
  if (hits.length === 0) return '';
  return `\n【可参考灵感】（以下是灵感库中与本次诉求相关的条目；确有参考其中玩法/点子时，回复末尾另起一行输出「参考灵感：条目名1、条目名2」（条目名须与下列完全一致）；未参考任何条目时不要输出该行，不得伪造来源）\n${hits
    .map((e) => `- ${e.title}：${e.howTo}（${e.format}；需要：${e.needs}）`)
    .join('\n')}`;
}

/** 调用 AI 策划对话（Edge Function SSE 代理）；vision 为独立图像理解服务对场地照片的真实识别结果 */
export async function aiChat(
  mode: AiMode,
  project: ProjectData,
  userText: string,
  onChunk: (delta: string) => void,
  vision?: string,
  opts?: { detail?: ReplyDetail; nickname?: string | null; memOnly?: boolean; noScene?: boolean }
): Promise<AiChatResult> {
  const modeInstruction = JSON_INSTRUCTIONS[mode];
  const userContent = [
    modeInstruction ? `【任务模式：${modeInstruction}】` : '',
    mode === 'chat' ? `【回复详略】${DETAIL_TEXT[opts?.detail ?? 'medium']}` : '',
    /* 本次指令边界：用户明确只要求记住条件/解释/只讨论时不做任何生成与写入——
     * 记条件类只简短确认本次条件；解释类正常把问题解释清楚（不是只回「已记住」）；
     * 两类都绝不宣称「已完成/已更新/已生成」任何成果（未执行的操作只能算建议） */
    mode === 'chat' && opts?.memOnly
      ? `【本次指令边界】用户本次只要求记录条件、解释说明或只讨论，不要求生成或修改任何成果。若用户在记条件，请只用两三句话简短确认本次记下的条件（如新增的其他需求、保持未知的字段）；若用户在提问或要求解释，请把问题本身解释清楚、给出真实有用的回答。不要输出「建议主题：」或「建议方向：」行，不要输出方案、流程、文案或图片内容，不要推荐活动方向。你本次没有执行任何生成或写入操作，绝不能宣称「已重新生成/已更新/已完成」——未执行的动作只能作为建议提出。`
      : '',
    /* 混合意图回落对话时：用户明确禁止的动作继续遵守（如「重新生成完整方案…不生成图片」） */
    mode === 'chat' && !opts?.memOnly && opts?.noScene
      ? `【本次指令边界】用户明确表示不要生成图片/效果图，本次回复只做文字内容，不要提议或着手生成图片。`
      : '',
    opts?.nickname ? `【用户昵称】用户的称呼是「${opts.nickname}」，交流互动时请亲切称呼对方（如按准则16和蔼交流）` : '',
    `【当前需求摘要】\n${summarize(project)}`,
    /* 流程时间唯一事实来源：由结构化流程表程序推导（首项开始→末项+时长），文案必须严格使用，
     * 不让模型猜结束时间；跨日明确标注，流程缺时间则明确写时间待定 */
    mode === 'copies'
      ? (() => {
          const tr = deriveTimeRange(project.schedule);
          return tr
            ? `【活动时间（由流程表严格推导，文案中必须与此一致，不要另写结束时间）】\n${tr.start} 开始，${tr.end} 结束${tr.crossDay ? '（跨日流程：次日结束，文案需明确说明跨天）' : ''}`
            : `【活动时间】流程表尚未确定具体时间，文案中不要编造具体钟点，明确写「时间以最终流程为准/待定」`;
        })()
      : '',
    userText.trim() ? `\n【我的话】\n${userText.trim()}` : '',
    mode === 'chat' ? relevantPartnerContext(userText, (project.requirements?.region?.value as string | undefined) ?? null) : '',
    mode === 'chat' ? relevantInspirationContext(userText) : '',
    vision
      ? `\n【场地照片的真实识别结果】\n以下是独立图像理解服务对本次随消息上传场地照片的真实读取结果（非猜测），仅描述画面内可见内容——画面外的入口位置、门窗、物件与精确尺寸均未知，不得当作已观察事实：\n${vision}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
    { role: 'system', content: SYSTEM_PROMPT },
    /* 角色身份固定注入：AI 伙伴名为「小灵」，打招呼/首次交流时自然自报家门并围绕策划核心能力做简短自我介绍 */
    {
      role: 'user',
      content: '【角色身份】你是活动策划 AI 伙伴「小灵」。用户打招呼或第一次与你交流时，先亲切自然地自报家门（带上用户昵称，如「xx，你好呀，我是小灵」），并用一两句话围绕核心能力做自我介绍：可以一起聊活动方向、把想法整理成完整方案、排流程与时间、管预算、写邀请函等文案，也能基于场地照片生成布置效果图。之后正常交流，不必每次重复报名字；绝不把角色名或昵称写进正式活动方案、邀请函等公文内容。',
    },
    ...chatHistoryMessages(project.chatLog ?? []),
    { role: 'user', content: userContent },
  ];

  let acc = '';
  await sendStreamRequest({
    functionUrl: apiUrl('/api/v1/ai/chat'),
    requestBody: { messages },
    authToken: getAuthToken(),
    onData: (data) => {
      if (data === '[DONE]') return;
      try {
        const parsed = JSON.parse(data);
        const chunk = parsed.choices?.[0]?.delta?.content ?? '';
        if (chunk) {
          acc += chunk;
          onChunk(chunk);
        }
      } catch {
        /* 跳过无法解析的帧 */
      }
    },
    onComplete: () => undefined,
  });

  /* 流正常结束但无任何内容：视为异常，避免空消息落库形成空白气泡 */
  if (!acc.trim()) {
    throw new Error('AI 未返回内容，请稍后重试');
  }
  const json = mode === 'chat' ? null : extractJson(acc);
  return { text: acc, json };
}


/** 从回复中提取「调整建议」围栏块：```调整建议 {...}```（sourceText 为触发本次建议的用户原文，供应用端范围校验） */
export function parseAdjustCard(text: string, sourceText?: string): Omit<AdjustCard, 'status'> | null {
  const m = text.match(/```调整建议\s*\n([\s\S]*?)```/);
  if (!m) return null;
  try {
    const raw = JSON.parse(m[1].trim());
    if (!raw || typeof raw.change !== 'string' || !raw.plan) return null;
    return {
      change: raw.change,
      affects: Array.isArray(raw.affects) ? raw.affects.filter((x: unknown) => typeof x === 'string') : [],
      keep: Array.isArray(raw.keep) ? raw.keep.filter((x: unknown) => typeof x === 'string') : [],
      pending: Array.isArray(raw.pending) ? raw.pending.filter((x: unknown) => typeof x === 'string') : [],
      manualWarn: Array.isArray(raw.manualWarn) ? raw.manualWarn.filter((x: unknown) => typeof x === 'string') : [],
      plan: sanitizeAdjustPlan(raw.plan),
      sourceText: sourceText?.trim() || undefined,
    };
  } catch {
    return null;
  }
}

/** 短字段清洗：去首尾空白、限长、剔除整段指令/操作说明式文本（含句号、分号、引号、换行、协议符） */
function shortField(v: unknown, max: number): string | undefined {
  if (typeof v !== 'string') return undefined;
  const s = v.trim().replace(/\s*\n\s*/g, ' ');
  if (!s || s.length > max) return undefined;
  /* 指令性文本特征：句中带句号/分号/冒号指令/引号或「保留/采用/不修改/保持不变」等操作词 → 拒绝写入短字段 */
  if (/[。；;“”"'|｜]/.test(s) || /(保留|采用|不变|不修改|不改动|改为|替换成)[^，,]{4,}/.test(s)) return undefined;
  return s;
}

/** plan 字段防御性清洗：新补丁协议（字段级），越界/含指令文本的字段一律丢弃不写入 */
function sanitizeAdjustPlan(p: Record<string, unknown> | undefined): AdjustCard['plan'] {
  if (!p || typeof p !== 'object') return {};
  const out: AdjustCard['plan'] = {};
  const strArr = (v: unknown, itemMax = 40): string[] | undefined => {
    if (v == null) return undefined;
    if (Array.isArray(v)) {
      const a = v
        .filter((x): x is string => typeof x === 'string')
        .map((x) => x.trim())
        .filter((x) => x !== '' && x.length <= itemMax && !/[|｜{}"]/.test(x));
      return a.length > 0 ? a : undefined;
    }
    if (typeof v === 'string') {
      const a = v.split(/[、，,;；/\n]+/).map((x) => x.trim()).filter((x) => x !== '' && x.length <= itemMax);
      return a.length > 0 ? a : undefined;
    }
    return undefined;
  };
  /* 兼容：模型若仍输出旧协议 schedule 完整数组，按「未指定字段级补丁」整体丢弃（应用端绝不整套替换） */
  if (p.visualTheme != null) {
    const vt = shortField(p.visualTheme, 24);
    if (vt) out.visualTheme = vt;
  }
  const th = p.theme as Record<string, unknown> | undefined;
  if (th && typeof th === 'object') {
    const t: NonNullable<AdjustCard['plan']['theme']> = {};
    if (typeof th.name === 'string') {
      const n = shortField(th.name, 20);
      if (n) t.name = n;
    }
    /* slogan/highlights 支持明确清空（null/空串） */
    if (th.slogan === null || th.slogan === '') t.slogan = null;
    else if (typeof th.slogan === 'string') {
      const s = shortField(th.slogan, 24);
      if (s) t.slogan = s;
    }
    const hl = strArr(th.highlights, 16);
    if (hl) t.highlights = hl;
    if (Object.keys(t).length > 0) out.theme = t;
  }
  /* schedulePatch：每项必须有定位键（id 或 name），只保留显式提供的字段（undefined=不动；null/空串=明确清空） */
  if (Array.isArray(p.schedulePatch)) {
    const list: SchedulePatchItem[] = [];
    for (const item of p.schedulePatch) {
      if (!item || typeof item !== 'object') continue;
      const x = item as Record<string, unknown>;
      const id = typeof x.id === 'string' && x.id.trim() ? x.id.trim() : undefined;
      const name = typeof x.name === 'string' && x.name.trim() ? x.name.trim() : undefined;
      if (!id && !name) continue;
      const pi: SchedulePatchItem = { ...(id ? { id } : {}), ...(name ? { name } : {}) };
      for (const f of ['time', 'duration', 'note', 'rename'] as const) {
        const v = x[f];
        if (v === null || v === '') {
          (pi as Record<string, unknown>)[f] = null; /* 明确清空 */
        } else if (typeof v === 'string' && v.trim()) {
          const s = v.trim().slice(0, f === 'note' ? 60 : 20);
          (pi as Record<string, unknown>)[f] = s;
        }
        /* undefined → 不写入该字段 = 保持原值 */
      }
      if (Object.keys(pi).length > Object.keys({ ...(id ? { id } : {}), ...(name ? { name } : {}) }).length) list.push(pi);
    }
    if (list.length > 0) out.schedulePatch = list;
  }
  if (Array.isArray(p.scheduleAdd)) {
    const list = p.scheduleAdd
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && typeof (x as Record<string, unknown>).name === 'string' && String((x as Record<string, unknown>).name).trim() !== '')
      .map((x) => ({
        name: String(x.name).trim().slice(0, 20),
        time: typeof x.time === 'string' ? x.time.trim().slice(0, 8) : '',
        duration: typeof x.duration === 'string' ? x.duration.trim().slice(0, 16) : '',
        note: typeof x.note === 'string' ? x.note.trim().slice(0, 60) : '',
      }));
    if (list.length > 0) out.scheduleAdd = list;
  }
  const srn = strArr(p.scheduleRemoveNames, 20);
  if (srn) out.scheduleRemoveNames = srn;
  if (Array.isArray(p.budgetAdd)) {
    const list = p.budgetAdd
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && typeof (x as Record<string, unknown>).name === 'string' && String((x as Record<string, unknown>).name).trim() !== '' && String((x as Record<string, unknown>).name).length <= 20)
      .map((x) => ({
        name: String(x.name).trim(),
        qty: Number(x.qty) || 1,
        /* null=待询价（不编造数字）；0=明确免费；数字=明确单价 */
        unitPrice: x.unitPrice == null ? null : Number(x.unitPrice) || 0,
      }));
    if (list.length > 0) out.budgetAdd = list;
  }
  const rn = strArr(p.budgetRemoveNames, 20);
  if (rn) out.budgetRemoveNames = rn;
  if (Array.isArray(p.materialsAdd)) {
    const list = p.materialsAdd
      .filter((x): x is Record<string, unknown> => !!x && typeof x === 'object' && typeof (x as Record<string, unknown>).name === 'string' && String((x as Record<string, unknown>).name).trim() !== '' && String((x as Record<string, unknown>).name).length <= 20)
      .map((x) => ({
        category: typeof x.category === 'string' && x.category.trim() ? x.category.trim().slice(0, 8) : '其他',
        name: String(x.name).trim(),
        qty: x.qty == null ? '' : String(x.qty).slice(0, 12),
      }));
    if (list.length > 0) out.materialsAdd = list;
  }
  const mn = strArr(p.materialsRemoveNames, 20);
  if (mn) out.materialsRemoveNames = mn;
  const st = strArr(p.sceneTags, 16);
  if (st) out.sceneTags = st;
  if (p.sceneStyle != null) {
    const s = shortField(p.sceneStyle, 20);
    if (s) out.sceneStyle = s;
  }
  if (typeof p.sceneExtra === 'string' && p.sceneExtra.trim()) {
    /* 长说明不半句硬截断：超长时在句读边界（。！；；，、）收口，截断必落在标点之后 */
    const raw = p.sceneExtra.trim().replace(/\s*\n\s*/g, ' ');
    let s = raw;
    if (raw.length > 160) {
      const head = raw.slice(0, 160);
      const cut = Math.max(head.lastIndexOf('。'), head.lastIndexOf('！'), head.lastIndexOf('；'), head.lastIndexOf('，'), head.lastIndexOf('、'));
      s = cut >= 60 ? head.slice(0, cut + 1) : head;
    }
    if (s) out.sceneExtra = s;
  }
  return out;
}

/** 从正文里剥离调整建议围栏块（卡片渲染代替原文） */
export function stripAdjustBlock(text: string): string {
  return text.replace(/```调整建议\s*\n[\s\S]*?```/g, '').trimEnd();
}


/** AI 调用错误分类：把 HTTP 状态/网关报文转成用户可理解的说法，并给出是否可重试的提示。
 * 限流（429/rate limit）不自动重试、不追加收费调用——只提示用户手动重试与等待时间 */
export interface AiErrorInfo {
  kind: 'rate-limit' | 'network' | 'other';
  userMessage: string;
  /** 明确的等待提示（限流返回 retry after 时提取，无则按经验值） */
  waitHint?: string;
}
export function classifyAiError(e: unknown): AiErrorInfo {
  const msg = e instanceof Error ? e.message : String(e ?? '');
  const rl = /(?:429|rate.?limit|tpm_|rpm_|qps|too many requests)/i.exec(msg);
  if (rl) {
    const ra = /retry.?after\s*[:=]?\s*(\d+)\s*(s|sec|seconds)?/i.exec(msg);
    const wait = ra ? `${ra[1]} 秒` : '约 1 分钟';
    return {
      kind: 'rate-limit',
      userMessage: 'AI 服务当前繁忙（请求限流）',
      waitHint: `建议等待 ${wait} 后再点击重试；本次操作与输入已保留，不会自动重试`,
    };
  }
  if (/HTTP|network|fetch|Failed to fetch|timeout|ECONN|网络/i.test(msg)) {
    return { kind: 'network', userMessage: '网络或 AI 服务连接失败', waitHint: '可稍后点击重试；本次操作与输入已保留' };
  }
  return { kind: 'other', userMessage: 'AI 服务返回异常', waitHint: '可点击重试本操作；本次操作与输入已保留' };
}
