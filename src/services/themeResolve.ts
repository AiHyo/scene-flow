import type { ProjectData } from '@/types/types';

/** 主题名候选去重：引号对（「」『』""''）与空白差异视为同一名称 */
function sameName(a: string, b: string): boolean {
  const strip = (x: string) => x.replace(/[「」『』""'']/g, '').replace(/\s+/g, '');
  return strip(a) === strip(b) && strip(a) !== '';
}

/** 从文本中提取标题部分（「：」或「:」前）——亮点条目「随机分组+趣味问答：解释文字」形态 */
function headOf(line: string): string {
  const t = line.trim().replace(/^[、·•\-–—*]+\s*/, '');
  const i = t.search(/[：:]/);
  const head = i > 0 ? t.slice(0, i) : t;
  return head.trim();
}

/**
 * 程序化解析「用户选择已有主题建议」：从会话上文 AI 消息中定位被选中的那组完整内容
 * （名称/口号/亮点全文），不经模型转述、不用短标题冒充全文。
 *
 * 匹配策略（按可靠性排序）：
 * 1. AI 消息中的候选主题块：识别「主题名」行 + 口号行 + 亮点列表（每条可带「标题：解释」），
 *    以用户点名的主题名（去引号）精确匹配块，返回该块完整内容；
 * 2. draftCard 历史草稿卡：主题名匹配则整卡原样复用；
 * 3. 无候选可定位 → 返回 null（调用方温和澄清，不让模型自由转述）。
 *
 * 用户明文给定内容（名称/口号/亮点都在用户句中出现）由调用方直接采用原文，不走本函数。
 */
export function resolveSelectedTheme(
  pickName: string,
  chatLog: ReadonlyArray<{ role: string; content: string; draftCard?: { kind: string; theme?: ProjectData['theme'] } | null }>
): { name: string; slogan: string; highlights: string[] } | null {
  if (!pickName.trim()) return null;
  /* 1. 历史草稿卡（结构化，最可靠） */
  for (let i = chatLog.length - 1; i >= 0; i--) {
    const m = chatLog[i];
    const t = m.draftCard?.theme;
    if (m.draftCard?.kind === 'theme' && t?.name && sameName(t.name, pickName)) {
      return { name: t.name, slogan: t.slogan ?? '', highlights: (t.highlights ?? []).slice() };
    }
  }
  /* 2. 从 AI 消息文本解析候选块：定位含该主题名的消息，向下收集口号与亮点 */
  for (let i = chatLog.length - 1; i >= 0; i--) {
    const m = chatLog[i];
    if (m.role !== 'assistant' || !m.content) continue;
    const lines = m.content.split('\n');
    let nameIdx = -1;
    for (let j = 0; j < lines.length; j++) {
      const head = headOf(lines[j].replace(/^[*\s]*/, ''));
      /* 候选名行：「主题一：XXX」/「1. XXX」/「XXX」含点名的名称 */
      if (sameName(head, pickName) || lines[j].includes(pickName)) {
        nameIdx = j;
        break;
      }
    }
    if (nameIdx < 0) continue;
    /* 收集块：从名称行向下到下一个候选块或空两行/结尾；口号行=含「口号」，亮点行=编号/圆点或「：」解释形态 */
    const block = lines.slice(nameIdx, nameIdx + 10).join('\n');
    let slogan = '';
    const hl: string[] = [];
    for (const ln of block.split('\n')) {
      const t = ln.trim();
      if (!t) continue;
      const sm = /(?:口号|slogan)[：:]\s*(.+)/i.exec(t);
      if (sm && !slogan) {
        slogan = sm[1].trim(); /* 逐字保留：不剥引号/符号（「充能」等用户原文原样） */
        continue;
      }
      /* 亮点行：编号/圆点开头，或「标题：解释」且标题非「口号/主题」 */
      const isBullet = /^(?:\d+[.、)]|[-•·*])\s*/.test(t);
      const hm = /^(?:亮点|活动亮点)[：:]\s*(.+)$/.exec(t);
      if (hm) {
        for (const part of hm[1].split(/[;；]/)) if (part.trim()) hl.push(part.trim());
        continue;
      }
      if (isBullet && !/^(?:口号|主题|风格|预算|时长|场地)/.test(t)) {
        const body = t.replace(/^(?:\d+[.、)]|[-•·*])\s*/, '').trim();
        if (body && !sameName(headOf(body), pickName) && !/(?:口号|slogan)/i.test(body)) hl.push(body);
      }
    }
    if (hl.length > 0 || slogan) {
      /* 名称行本身可能就是「主题一：随机分组+趣味问答：…」——取点名行内冒号后的名称 */
      const inline = /^[^：:]*[：:]\s*(.+)$/.exec(lines[nameIdx].replace(/^[*\s]*/, ''));
      const name = inline && !/^(?:主题|方向|候选)/.test(inline[1]) ? inline[1].trim() : pickName;
      return { name, slogan, highlights: hl };
    }
  }
  return null;
}
