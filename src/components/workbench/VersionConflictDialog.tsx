import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';

interface VersionConflictDialogProps {
  open: boolean;
  /** 加载服务端最新版本；本地改动由调用方另存为冲突备份 */
  onLoadLatest: () => Promise<void>;
  /** 以服务端当前版本号重新提交本窗口的内容 */
  onOverwrite: () => Promise<void>;
}

/**
 * 乐观锁冲突弹窗：同一活动在其他窗口/设备已保存过更新的版本。
 * 两个选项都必须显式点击——ESC 与点击遮罩不会关闭，避免误操作导致静默覆盖或丢失改动。
 */
export default function VersionConflictDialog({ open, onLoadLatest, onOverwrite }: VersionConflictDialogProps) {
  const [busy, setBusy] = useState<'latest' | 'overwrite' | null>(null);

  const run = async (kind: 'latest' | 'overwrite') => {
    setBusy(kind);
    try {
      await (kind === 'latest' ? onLoadLatest() : onOverwrite());
    } finally {
      setBusy(null);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={() => undefined}>
      <AlertDialogContent
        className="max-w-[calc(100%-2rem)] md:max-w-md"
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <AlertDialogHeader>
          <AlertDialogTitle className="text-left text-base font-semibold">这个活动已在其他窗口更新</AlertDialogTitle>
          <AlertDialogDescription className="text-left text-xs leading-relaxed text-muted-foreground">
            你在另一个窗口或设备上保存过更新的版本。为避免互相覆盖，本窗口已暂停保存，请选择接下来怎么做：
          </AlertDialogDescription>
        </AlertDialogHeader>
        <ul className="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
          <li>
            <span className="font-medium text-foreground">加载最新版本</span>
            ：显示另一个窗口保存的内容；本窗口的改动会备份在这台设备上，不会丢失。
          </li>
          <li>
            <span className="font-medium text-foreground">用我的版本覆盖</span>
            ：以本窗口的内容为准，另一个窗口保存的改动将被替换。
          </li>
        </ul>
        <AlertDialogFooter className="mt-4 flex-row items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="text-xs"
            disabled={busy !== null}
            onClick={() => run('overwrite')}
          >
            {busy === 'overwrite' && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            用我的版本覆盖
          </Button>
          <Button type="button" size="sm" className="text-xs" disabled={busy !== null} onClick={() => run('latest')}>
            {busy === 'latest' && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
            加载最新版本
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
