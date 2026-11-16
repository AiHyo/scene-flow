/** 归一化模型输出的畸形 Markdown 强调（单双星号不配对包裹，如「趣味互动」两侧星数不一）为合法加粗格式；
 * 只动「星号包裹且开尾星数不等」的短语（合法成对加粗/斜体标记原样保留），内容为纯数字不处理（保留乘号算式） */
export function normalizeEmphasis(text: string): string {
  if (!text) return text;
  return text.replace(/(\*{1,2})([^*\n]{1,40})(\*{1,2})/g, (m, a: string, inner: string, b: string) =>
    a === b || /^\d+(\.\d+)?$/.test(inner.trim()) ? m : `**${inner.trim()}**`
  );
}

/** 纯文本展示场景（草稿卡/成果字段无 Markdown 渲染管道）：去掉星号包裹残留只保留内容；
 * 内容为纯数字不处理（保留乘号算式这类合法星号），不删除文字本身 */
export function cleanEmphasisText(text: string): string {
  if (!text) return text;
  return text.replace(/\*{1,2}([^*\n]{1,40})\*{1,2}/g, (m, inner: string) =>
    /^\d+(\.\d+)?$/.test(inner.trim()) ? m : inner.trim()
  );
}
