import { useEffect, useState } from 'react';
import { Eye, EyeOff, FolderDown, Loader2, LogIn, UserPlus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAuth } from '@/contexts/AuthContext';

interface AuthDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 打开时的初始模式 */
  initialMode?: 'login' | 'register';
}

/** 邮箱密码登录/注册（不弹强制登录；注册即登录，无需邮箱验证） */
export default function AuthDialog({ open, onOpenChange, initialMode = 'login' }: AuthDialogProps) {
  const { signIn, signUp, prevAnonUserId, migrateAnonProjects, clearPrevAnon } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [askMerge, setAskMerge] = useState(false);
  const [merging, setMerging] = useState(false);

  useEffect(() => {
    if (open) {
      setMode(initialMode);
      setEmail('');
      setPassword('');
      setNickname('');
      setShowPw(false);
      setAgreed(false);
      setError(null);
      setAskMerge(false);
    }
  }, [open, initialMode]);

  const close = () => onOpenChange(false);

  const submit = async () => {
    if (busy) return;
    setError(null);
    const em = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
      setError('请输入有效的邮箱地址');
      return;
    }
    if (password.length < 6) {
      setError('密码至少 6 位');
      return;
    }
    if (mode === 'register' && !agreed) {
      setError('请先勾选同意用户协议与隐私政策');
      return;
    }
    setBusy(true);
    try {
      if (mode === 'login') {
        await signIn(em, password);
        toast.success('登录成功');
      } else {
        await signUp(em, password, nickname.trim() || undefined);
        toast.success('注册成功，已自动登录');
      }
      /* 登录前本机有访客记录时询问是否归入账号（仅同意后关联，不覆盖已有数据） */
      if (localStorage.getItem('prev_anon_uid')) setAskMerge(true);
      else close();
    } catch (e) {
      setError(e instanceof Error ? e.message : '操作失败，请重试');
    } finally {
      setBusy(false);
    }
  };

  const merge = async () => {
    if (merging || !prevAnonUserId) {
      clearPrevAnon();
      close();
      return;
    }
    setMerging(true);
    try {
      const n = await migrateAnonProjects();
      if (n > 0) toast.success(`已将 ${n} 个访客活动保存到当前账号`);
      else toast.info('本机没有待保存的访客活动');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : '关联失败，请稍后重试');
    } finally {
      setMerging(false);
      clearPrevAnon();
      close();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[calc(100%-2rem)] md:max-w-md">
        {askMerge ? (
          <>
            <DialogHeader>
              <DialogTitle>将本机访客活动保存到当前账号？</DialogTitle>
              <DialogDescription className="text-left">
                检测到这台设备上以访客身份创建的活动。保存后可在「我的活动」中随时查看，不会覆盖账号中已有的活动；跳过则访客活动仍留在这台设备上。
              </DialogDescription>
            </DialogHeader>
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                disabled={merging}
                onClick={() => {
                  clearPrevAnon();
                  close();
                }}
              >
                暂不保存
              </Button>
              <Button onClick={merge} disabled={merging}>
                {merging ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderDown className="h-4 w-4" />}
                {merging ? '正在保存…' : '保存到我的账号'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>{mode === 'login' ? '登录 SceneFlow AI' : '注册账号'}</DialogTitle>
              <DialogDescription className="text-left">
                {mode === 'login'
                  ? '登录后可在多台设备查看你的活动；不登录也可以继续以访客身份使用全部功能。'
                  : '只需邮箱和密码即可完成注册并自动登录；昵称和头像可稍后在个人资料中设置。'}
              </DialogDescription>
            </DialogHeader>

            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <div className="flex flex-col gap-2">
                <Label htmlFor="auth-email">邮箱</Label>
                <Input
                  id="auth-email"
                  type="email"
                  inputMode="email"
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor="auth-password">密码</Label>
                <div className="relative">
                  <Input
                    id="auth-password"
                    type={showPw ? 'text' : 'password'}
                    autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                    placeholder="至少 6 位"
                    className="pr-10"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button
                    type="button"
                    aria-label={showPw ? '隐藏密码' : '显示密码'}
                    className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-muted-foreground hover:text-foreground"
                    onClick={() => setShowPw((v) => !v)}
                  >
                    {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              {mode === 'register' && (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="auth-nickname">
                    昵称<span className="ml-1 font-normal text-muted-foreground">（可选，可跳过）</span>
                  </Label>
                  <Input
                    id="auth-nickname"
                    maxLength={20}
                    placeholder="怎么称呼你"
                    value={nickname}
                    onChange={(e) => setNickname(e.target.value)}
                  />
                </div>
              )}

              {error && <p className="text-sm text-destructive" role="alert">{error}</p>}

              {mode === 'register' && (
                <label className="flex items-start gap-2 text-sm text-muted-foreground" htmlFor="auth-agree">
                  <Checkbox
                    id="auth-agree"
                    checked={agreed}
                    onCheckedChange={(v) => setAgreed(v === true)}
                    className="mt-0.5"
                  />
                  <span>
                    我已阅读并同意
                    <span className="text-foreground">《用户协议》</span>与
                    <span className="text-foreground">《隐私政策》</span>
                  </span>
                </label>
              )}

              <Button type="submit" disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === 'login' ? <LogIn className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
                {busy ? '请稍候…' : mode === 'login' ? '登录' : '注册并登录'}
              </Button>
            </form>

            <div className="flex flex-col gap-2 text-center text-sm">
              <button
                type="button"
                className="text-primary hover:underline"
                onClick={() => {
                  setMode(mode === 'login' ? 'register' : 'login');
                  setError(null);
                }}
              >
                {mode === 'login' ? '没有账号？注册一个' : '已有账号？直接登录'}
              </button>
              <button type="button" className="text-muted-foreground hover:text-foreground" onClick={close}>
                返回，继续访客体验
              </button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
