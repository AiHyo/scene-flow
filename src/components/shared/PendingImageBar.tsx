import { Loader2, RotateCcw, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { PendingImage } from '@/hooks/usePendingImage';
import { cn } from '@/lib/utils';

interface PendingImageBarProps {
  img: PendingImage;
  onRetry: () => void;
  onRemove: () => void;
  /** 上传成功时的说明（如“将随下一条消息发送给 AI”） */
  okHint?: string;
}

/**
 * 待发送图片的统一预览条：本地即时缩略图 + 上传中遮罩 + 失败重试。
 * 失败时保留选图与用户输入，绝不静默清空。
 */
export function PendingImageBar({ img, onRetry, onRemove, okHint }: PendingImageBarProps) {
  return (
    <div
      className={cn(
        'flex items-center gap-2.5 rounded-xl border bg-background p-2',
        img.status === 'error' && 'border-destructive/40 bg-destructive/5'
      )}
    >
      <div className="relative h-12 w-16 shrink-0 overflow-hidden rounded-lg bg-muted md:h-14 md:w-20">
        <img src={img.localUrl} alt="已选择的场地照片" className="h-full w-full object-cover" />
        {img.status === 'uploading' && (
          <div className="absolute inset-0 flex items-center justify-center bg-background/70">
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          </div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'text-xs font-medium leading-relaxed',
            img.status === 'error' ? 'text-destructive' : 'text-foreground'
          )}
        >
          {img.status === 'uploading'
            ? '照片上传中…（完成后会自动带上）'
            : img.status === 'error'
              ? `上传失败：${img.error ?? '网络异常'}`
              : okHint ?? '照片已就绪，将随下一条消息发送给 AI'}
        </p>
        {img.status === 'error' && (
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            可重试或移除照片；你的文字输入不会丢失
          </p>
        )}
      </div>
      {img.status === 'error' && (
        <Button variant="outline" size="sm" className="h-7 shrink-0 gap-1 px-2.5 text-xs" onClick={onRetry}>
          <RotateCcw className="h-3 w-3" />
          重试
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 shrink-0"
        aria-label="移除照片"
        onClick={onRemove}
      >
        <X className="h-4 w-4" />
      </Button>
    </div>
  );
}
