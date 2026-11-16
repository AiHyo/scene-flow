import { useEffect, useRef, useState } from 'react';
import { ImageUp, Loader2, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { UserIcon } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { usePreloadedSrc } from '@/components/auth/Avatars';
import { compressImage, uploadImage } from '@/services/api';
import { ASSETS } from '@/data/assets';

/** 个人中心：昵称与头像（登录 = 随账号保存；访客 = 本机资料，默认小猫兜底） */
export default function ProfileDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { isAccount, email, profile, updateProfile } = useAuth();
  const [nickname, setNickname] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setNickname(profile?.nickname ?? '');
      setAvatarUrl(profile?.avatarUrl ?? null);
      setError(null);
      setSaved(false);
    }
  }, [open, profile]);

  const pickAvatar = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('请选择图片文件');
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      setError('图片请控制在 5MB 以内');
      return;
    }
    setUploading(true);
    setError(null);
    try {
      const processed = await compressImage(file, 512);
      const url = await uploadImage(processed, 'avatar');
      setAvatarUrl(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : '上传失败，请重试');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError(null);
    try {
      await updateProfile({ nickname: nickname.trim() || null, avatarUrl });
      /* 保存成功不自动关窗：行内展示成功状态 + toast，让用户明确看到结果后再关闭 */
      setSaved(true);
      toast.success('资料已保存');
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  };

  const previewSrc = avatarUrl ?? ASSETS.userCat;
  /* 预加载守卫：新头像加载完成前保持当前预览，不闪兜底图 */
  const previewShown = usePreloadedSrc(previewSrc);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md">
        <DialogHeader>
          <DialogTitle>个人中心</DialogTitle>
          <DialogDescription className="text-left">
            {isAccount
              ? '昵称与头像随账号保存，可随时修改；不填则继续使用默认形象。'
              : '当前为访客：昵称与头像保存在本浏览器，仅当前设备可见；登录后资料随账号保存。'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5">
          <div className="flex items-center gap-4">
            <Avatar className="h-20 w-20">
              <AvatarImage src={previewShown} alt="头像预览" />
              <AvatarFallback className="bg-muted">
                {/* 兜底同样使用默认小猫，与导航头像一致，不再出现通用人形图标 */}
                <img src={ASSETS.userCat} alt="默认头像" className="h-full w-full object-cover" />
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => void pickAvatar(e.target.files?.[0])}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
              >
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageUp className="h-4 w-4" />}
                {uploading ? '上传中…' : '上传头像'}
              </Button>
              {avatarUrl && (
                <Button variant="ghost" size="sm" onClick={() => setAvatarUrl(null)}>
                  <RotateCcw className="h-4 w-4" />
                  恢复默认
                </Button>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="profile-nickname">昵称</Label>
            <Input
              id="profile-nickname"
              maxLength={20}
              placeholder="怎么称呼你（留空使用默认）"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
            />
            {isAccount && email ? (
              <p className="text-xs text-muted-foreground">账号邮箱：{email}</p>
            ) : (
              <p className="text-xs text-muted-foreground">访客身份 · 昵称与头像仅保存在本浏览器</p>
            )}
          </div>

          {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
          {saved && !error && (
            <p className="text-sm font-medium text-primary" role="status">
              资料已保存，可继续调整或关闭窗口
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              取消
            </Button>
            <Button onClick={() => void save()} disabled={saving || uploading}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              {saving ? '保存中…' : '保存'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
