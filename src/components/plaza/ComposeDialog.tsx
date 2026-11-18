import { useRef, useState } from 'react';
import { ImagePlus, Loader2, Send, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { compressImage, uploadImage } from '@/services/api';
import { PLAZA_MAX_IMAGES, createPlazaPost } from '@/services/plazaApi';

interface ComposeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPublished: () => void;
}

/** 发布动态弹窗：标题 + 正文 + 多图（预览/移除）；发布失败保留输入，成功后清空并刷新列表 */
export default function ComposeDialog({ open, onOpenChange, onPublished }: ComposeDialogProps) {
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const resetForm = () => {
    setTitle('');
    setContent('');
    setImages([]);
    if (fileRef.current) fileRef.current.value = '';
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    /* 先快照 File 数组再清空 input：Chrome 的 FileList 是 live 引用，先清 value 会变成空列表 */
    const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (fileRef.current) fileRef.current.value = '';
    if (list.length === 0) {
      toast.error('请选择图片文件（JPEG/PNG/GIF/WEBP 等）');
      return;
    }
    const remain = PLAZA_MAX_IMAGES - images.length;
    if (remain <= 0) {
      toast.info(`最多上传 ${PLAZA_MAX_IMAGES} 张图片`);
      return;
    }
    const batch = list.slice(0, remain);
    if (list.length > remain) toast.info(`最多上传 ${PLAZA_MAX_IMAGES} 张，已自动截取前 ${remain} 张`);
    setUploading((n) => n + batch.length);
    for (const file of batch) {
      try {
        const processed = await compressImage(file, 1600);
        const url = await uploadImage(processed, 'plaza');
        setImages((arr) => [...arr, url]);
        if (processed.size < file.size) {
          toast.info(`图片已自动压缩至 ${(processed.size / 1024).toFixed(0)} KB`);
        }
      } catch (e) {
        console.error(e);
        toast.error(`「${file.name}」上传失败，已跳过（其余图片不受影响）`);
      } finally {
        setUploading((n) => Math.max(0, n - 1));
      }
    }
  };

  const removeImage = (url: string) => {
    setImages((arr) => arr.filter((u) => u !== url));
  };

  const handleSubmit = async () => {
    const t = title.trim();
    const c = content.trim();
    if (t.length === 0) {
      toast.error('请填写标题');
      return;
    }
    if (t.length > 60) {
      toast.error('标题请控制在 60 字以内');
      return;
    }
    if (c.length === 0) {
      toast.error('请填写正文');
      return;
    }
    if (images.length === 0) {
      toast.error('请至少上传一张图片');
      return;
    }
    if (uploading > 0) {
      toast.info('图片还在上传中，请稍候…');
      return;
    }
    if (submitting) return;
    setSubmitting(true);
    try {
      await createPlazaPost({ title: t, content: c, imgList: images });
      toast.success('发布成功，动态已出现在广场');
      resetForm();
      onOpenChange(false);
      onPublished();
    } catch (e) {
      console.error(e);
      toast.error('发布失败，填写的内容已保留，请重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] max-w-[calc(100%-2rem)] overflow-y-auto md:max-w-lg">
        <DialogHeader>
          <DialogTitle>发布动态</DialogTitle>
          <DialogDescription>分享你的活动策划、场景布置或活动照片</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="plaza-compose-title" className="text-sm font-medium">
              标题
            </label>
            <Input
              id="plaza-compose-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="一句话概括这条动态（60 字内）"
              maxLength={80}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor="plaza-compose-content" className="text-sm font-medium">
              正文
            </label>
            <Textarea
              id="plaza-compose-content"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder="聊聊这次活动的想法、布置思路或现场感受…"
              rows={5}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">图片</span>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {images.map((url) => (
                <div key={url} className="relative aspect-square overflow-hidden rounded-lg border bg-muted">
                  <img src={url} alt="已上传图片预览" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    aria-label="移除这张图片"
                    onClick={() => removeImage(url)}
                    className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-white transition-colors hover:bg-black/80"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
              {images.length < PLAZA_MAX_IMAGES && (
                <label className="flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-lg border border-dashed text-muted-foreground transition-colors hover:border-primary/50 hover:text-primary">
                  {uploading > 0 ? (
                    <>
                      <Loader2 className="h-5 w-5 animate-spin" />
                      <span className="text-[11px]">上传中…</span>
                    </>
                  ) : (
                    <>
                      <ImagePlus className="h-5 w-5" />
                      <span className="text-[11px]">添加图片</span>
                    </>
                  )}
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={(e) => void handleFiles(e.target.files)}
                  />
                </label>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              可上传 1–{PLAZA_MAX_IMAGES} 张图片（JPEG/PNG/GIF/WEBP），超过 1MB 会自动压缩
              {uploading > 0 ? `，正在上传 ${uploading} 张…` : ''}
            </p>
          </div>
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            取消
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={submitting || uploading > 0}>
            {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            {submitting ? '发布中…' : '发布'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
