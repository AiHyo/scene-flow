import type { ReactNode } from 'react';
import { normalizeEmphasis } from '@/services/textFormat';

/** 行内标记：加粗、行内代码、链接（流式与完成态共用同一渲染，避免样式跳变）。
 * 畸形星号（单双星不配对包裹，已由 normalizeEmphasis 归一）按强调渲染，不裸露星号 */
function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*|\[[^\]\n]+\]\([^)\n]+\)|`[^`\n]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
    }
    /* 单星包裹（含模型输出的「*词**」畸形混合：split 兼容 1-2 星）→ 强调渲染，内容非纯数字才处理（不破坏 3*4*5） */
    const em = part.match(/^\*([^*\n]+)\*$/);
    if (em && !/^\d+(\.\d+)?$/.test(em[1].trim())) {
      return <strong key={i} className="font-semibold">{em[1]}</strong>;
    }
    const lm = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (lm) {
      return (
        <a key={i} href={lm[2]} target="_blank" rel="noreferrer" className="break-words text-primary underline underline-offset-2 hover:text-primary/80">
          {lm[1]}
        </a>
      );
    }
    if (part.startsWith('`') && part.endsWith('`') && part.length > 2) {
      return <code key={i} className="break-words rounded bg-muted px-1 py-0.5 text-[0.85em]">{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

/** 表格行解析：| a | b | → 单元格数组（忽略分隔行） */
function tableCells(line: string): string[] {
  return line.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
}
function isTableDivider(line: string): boolean {
  return /^\|?[\s:-]*-[\s:|-]*\|?$/.test(line.trim()) && line.includes('-');
}

/**
 * 轻量 Markdown 渲染（AI 回复专用）：标题 ###/##/#、无序与有序列表、**加粗**、
 * [链接](url)、`行内代码`、| 表格 |（横向滚动容器）。
 * 流式与完成态共用，未闭合语法按纯文本显示不闪烁；段落间距统一，避免大量空行。
 */
export default function MarkdownText({ text }: { text: string }) {
  /* 先归一化畸形星号（单双星不配对），流式与完成态都不裸露星号 */
  const lines = normalizeEmphasis(text ?? '').split('\n');
  const out: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    const t = line.trim();
    if (t === '') {
      i++;
      continue;
    }
    /* 标题（流式未闭合时下一行为空/结尾，正常渲染已完成部分） */
    const h = t.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const lvl = h[1].length;
      const cls =
        lvl <= 2
          ? 'mt-0.5 text-[15px] font-semibold leading-snug'
          : lvl === 3
            ? 'mt-0.5 text-sm font-semibold leading-snug'
            : 'text-sm font-medium leading-snug';
      out.push(<p key={key++} className={cls}>{renderInline(h[2])}</p>);
      i++;
      continue;
    }
    /* 表格：当前行含 | 且下一行是分隔行（未到分隔行时按普通文本流式显示） */
    if (t.includes('|') && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const head = tableCells(t);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].trim().includes('|') && lines[j].trim() !== '') {
        rows.push(tableCells(lines[j].trim()));
        j++;
      }
      out.push(
        <div key={key++} className="my-0.5 w-full max-w-full overflow-x-auto rounded-lg border">
          <table className="w-max min-w-full border-collapse text-left text-xs">
            <thead>
              <tr className="bg-muted/60">
                {head.map((c, ci) => (
                  <th key={ci} className="whitespace-nowrap border-b px-2.5 py-1.5 font-semibold">{renderInline(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, ri) => (
                <tr key={ri} className="odd:bg-muted/20">
                  {r.map((c, ci) => (
                    <td key={ci} className="whitespace-nowrap border-b px-2.5 py-1.5 align-top">{renderInline(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      i = j;
      continue;
    }
    /* 列表块：连续同类条目合成一个块（单项也成块，避免每条一段） */
    const bulletRe = /^\s*[-•*]\s+\S/;
    const orderedRe = /^\s*\d+[.、)）]\s*\S/;
    if (bulletRe.test(line)) {
      const items: string[] = [];
      while (i < lines.length && bulletRe.test(lines[i])) {
        items.push(lines[i].replace(bulletRe, ''));
        i++;
      }
      out.push(
        <ul key={key++} className="ml-4 list-disc space-y-1">
          {items.map((x, xi) => <li key={xi}>{renderInline(x)}</li>)}
        </ul>
      );
      continue;
    }
    if (orderedRe.test(line)) {
      const items: string[] = [];
      while (i < lines.length && orderedRe.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.、)）]\s*/, ''));
        i++;
      }
      out.push(
        <ol key={key++} className="ml-4 list-decimal space-y-1">
          {items.map((x, xi) => <li key={xi}>{renderInline(x)}</li>)}
        </ol>
      );
      continue;
    }
    /* 段落：普通行合并成段（未闭合的 ** 等按原文显示） */
    const para: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,6})\s/.test(lines[i].trim()) &&
      !bulletRe.test(lines[i]) &&
      !orderedRe.test(lines[i])
    ) {
      para.push(lines[i].trim());
      i++;
    }
    if (para.length > 0) out.push(<p key={key++} className="leading-relaxed">{renderInline(para.join(' '))}</p>);
  }
  return <div className="flex flex-col gap-1.5">{out}</div>;
}
