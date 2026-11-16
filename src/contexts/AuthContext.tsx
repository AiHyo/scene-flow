import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '@/lib/supabase';

const CRED_KEY = 'anon_credential_id';
/** 登录前记录的访客 userId（登录后可选关联） */
const PREV_ANON_KEY = 'prev_anon_uid';
/** anon-auth Edge Function 创建匿名用户使用的邮箱域名后缀 */
const ANON_EMAIL_SUFFIX = '@scene.local';
/** 访客本机资料（仅当前浏览器可见；登录账号资料存 profiles 表，互不搬移） */
const GUEST_PROFILE_KEY = 'sf-guest-profile';

/** 匿名访问凭证：首次生成 UUID v4 并持久化在 localStorage */
function getCredentialId(): string {
  let v = localStorage.getItem(CRED_KEY);
  if (!v) {
    v = crypto.randomUUID();
    localStorage.setItem(CRED_KEY, v);
  }
  return v;
}

const isAnonUser = (u: User | null | undefined) => !!u?.email?.endsWith(ANON_EMAIL_SUFFIX);

export interface UserProfile {
  nickname: string | null;
  avatarUrl: string | null;
}

interface AuthContextType {
  userId: string | null;
  ready: boolean;
  /** 等待会话就绪（访客匿名会话建立需 1~3 秒网络往返；超时返回 false 不再无限等） */
  waitForReady: (timeoutMs?: number) => Promise<boolean>;
  /** 是否为登录账号（false = 匿名访客会话，功能完全等价） */
  isAccount: boolean;
  email: string | null;
  profile: UserProfile | null;
  /** 登录前本机访客 userId（用于「将访客活动保存到账号」） */
  prevAnonUserId: string | null;
  clearPrevAnon: () => void;
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (email: string, password: string, nickname?: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshProfile: () => Promise<void>;
  updateProfile: (p: Partial<UserProfile>) => Promise<void>;
  /** 把访客名下项目转到当前账号（Edge Function，需登录态） */
  migrateAnonProjects: (anonId: string) => Promise<number>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  /* ready 的同步镜像：waitForReady 轮询用（state 闭包读不到最新值） */
  const readyRef = useRef(false);
  useEffect(() => {
    readyRef.current = ready;
  }, [ready]);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [prevAnonUserId, setPrevAnonUserId] = useState<string | null>(() => localStorage.getItem(PREV_ANON_KEY));
  const triedRef = useRef(false);
  const mountedRef = useRef(true);
  /** 匿名会话建立代际：账号登录/新请求都会使其失效，防止迟到的 verifyOtp 覆盖账号会话 */
  const anonSeqRef = useRef(0);

  const ensureAnonSession = useCallback(async () => {
    if (triedRef.current) return;
    triedRef.current = true;
    const seq = ++anonSeqRef.current;
    try {
      const credentialId = getCredentialId();
      const { data, error } = await supabase.functions.invoke('anon-auth', {
        body: { credential_id: credentialId },
      });
      if (error || !data?.hashed_token) return;
      /* 双重守卫（退出后用户已重新登录的竞态）：
       * 1) 代际已变 → 有更新的匿名请求或账号登录，本次作废；
       * 2) 当前已有账号会话 → 绝不 verifyOtp（迟到的匿名会话会覆盖账号，导致数据读回错乱）。 */
      if (seq !== anonSeqRef.current) return;
      const cur = await supabase.auth.getSession();
      const curUser = cur.data.session?.user;
      if (curUser && !isAnonUser(curUser)) return;
      const { error: verifyError } = await supabase.auth.verifyOtp({
        token_hash: data.hashed_token,
        type: 'magiclink',
      });
      if (verifyError) console.warn('匿名会话建立失败:', verifyError.message);
    } catch (e) {
      console.warn('匿名会话建立失败:', e);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    supabase.auth.getSession().then(async ({ data }: { data: { session: Session | null } }) => {
      if (data.session?.user) {
        if (mountedRef.current) setUser(data.session.user);
      } else {
        await ensureAnonSession();
      }
      if (mountedRef.current) setReady(true);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (!mountedRef.current) return;
      setUser(session?.user ?? null);
      /* 账号会话出现（登录/注册成功）→ 在途匿名会话建立立即作废，防止迟到的 verifyOtp 覆盖账号会话 */
      if (session?.user && !isAnonUser(session.user)) anonSeqRef.current++;
      /* 退出登录 → 回到访客态：重建匿名会话，同浏览器访客数据保留 */
      if (event === 'SIGNED_OUT') {
        setProfile(null);
        triedRef.current = false;
        void ensureAnonSession();
      }
    });

    return () => {
      mountedRef.current = false;
      sub.subscription.unsubscribe();
    };
  }, [ensureAnonSession]);

  const isAccount = !!user && !isAnonUser(user);

  /* 等待会话就绪：匿名会话建立期间的点击不立即报错（自动等最多 timeoutMs）。
   * 纯文字用户不必靠"先传一张图"的时间窗口来等会话建立 */
  const waitForReady = useCallback(async (timeoutMs = 15000): Promise<boolean> => {
    if (readyRef.current) return true;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 200));
      if (readyRef.current) return true;
    }
    return readyRef.current;
  }, []);

  /* 档案加载：登录账号读云端档案；访客读本机资料（准确区分，不伪称云同步） */
  const refreshProfile = useCallback(async () => {
    const uid = user?.id;
    if (!uid || isAnonUser(user)) {
      try {
        const raw = localStorage.getItem(GUEST_PROFILE_KEY);
        setProfile(raw ? (JSON.parse(raw) as UserProfile) : null);
      } catch {
        setProfile(null);
      }
      return;
    }
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('nickname, avatar_url')
        .eq('id', uid)
        .maybeSingle();
      if (error) throw error;
      setProfile({ nickname: data?.nickname ?? null, avatarUrl: data?.avatar_url ?? null });
    } catch (e) {
      console.warn('档案加载失败:', e);
      setProfile(null);
    }
  }, [user]);

  useEffect(() => {
    void refreshProfile();
  }, [refreshProfile]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      /* 登录动作先使在途匿名会话建立失效：退出后立即重新登录时，
       * 迟到的匿名 verifyOtp 会覆盖刚建立的账号会话（数据读回错乱的根因） */
      anonSeqRef.current++;
      /* 登录前：当前为匿名会话 → 记录访客 userId，供登录后可选关联 */
      if (user?.id && isAnonUser(user)) {
        localStorage.setItem(PREV_ANON_KEY, user.id);
        setPrevAnonUserId(user.id);
      }
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) {
        if (/invalid login credentials/i.test(error.message)) throw new Error('邮箱或密码不正确，请检查后重试');
        throw new Error(error.message);
      }
    },
    [user]
  );

  const signUp = useCallback(
    async (email: string, password: string, nickname?: string) => {
      if (user?.id && isAnonUser(user)) {
        localStorage.setItem(PREV_ANON_KEY, user.id);
        setPrevAnonUserId(user.id);
      }
      const { data, error } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: nickname ? { data: { nickname } } : undefined,
      });
      if (error) {
        if (/already registered/i.test(error.message)) throw new Error('该邮箱已注册，请直接登录');
        if (/password/i.test(error.message) && /at least/i.test(error.message)) throw new Error('密码至少 6 位');
        throw new Error(error.message);
      }
      /* 验证已关闭：注册即登录。未返回会话则提示直接登录 */
      if (!data.session) throw new Error('注册会话未建立，请用刚才的邮箱直接登录');
      if (nickname?.trim()) {
        /* 昵称同步档案（profiles 行由注册触发器创建） */
        try {
          await supabase.from('profiles').update({ nickname: nickname.trim() }).eq('id', data.session.user.id);
        } catch {
          /* 档案昵称写入失败不阻塞注册流程 */
        }
      }
    },
    [user]
  );

  const signOut = useCallback(async () => {
    /* local scope：仅登出当前浏览器，不撤销其他设备的 refresh token */
    await supabase.auth.signOut({ scope: 'local' });
    /* 退出后回到访客：恢复本机访客资料（若有），账号数据不暴露 */
    try {
      const raw = localStorage.getItem(GUEST_PROFILE_KEY);
      setProfile(raw ? (JSON.parse(raw) as UserProfile) : null);
    } catch {
      setProfile(null);
    }
  }, []);

  const updateProfile = useCallback(
    async (p: Partial<UserProfile>) => {
      const uid = user?.id;
      if (!uid) throw new Error('会话准备中，请稍候再试');
      /* 访客：仅写入本机资料（当前浏览器可见；不搬移、不覆盖任何账号数据） */
      if (isAnonUser(user)) {
        const next: UserProfile = {
          nickname: p.nickname !== undefined ? p.nickname : profile?.nickname ?? null,
          avatarUrl: p.avatarUrl !== undefined ? p.avatarUrl : profile?.avatarUrl ?? null,
        };
        localStorage.setItem(GUEST_PROFILE_KEY, JSON.stringify(next));
        setProfile(next);
        return;
      }
      const { error } = await supabase
        .from('profiles')
        .update({
          ...(p.nickname !== undefined ? { nickname: p.nickname } : {}),
          ...(p.avatarUrl !== undefined ? { avatar_url: p.avatarUrl } : {}),
        })
        .eq('id', uid);
      if (error) throw new Error('保存失败，请重试');
      await refreshProfile();
    },
    [user, profile, refreshProfile]
  );

  const migrateAnonProjects = useCallback(async (anonId: string) => {
    const { data, error } = await supabase.functions.invoke<{ migrated: number }>('migrate-projects', {
      body: { from_user_id: anonId },
    });
    if (error || !data) throw new Error('关联失败，请稍后重试');
    return data.migrated ?? 0;
  }, []);

  const clearPrevAnon = useCallback(() => {
    localStorage.removeItem(PREV_ANON_KEY);
    setPrevAnonUserId(null);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        userId: user?.id ?? null,
        ready,
      waitForReady,
        isAccount,
        email: isAccount ? (user?.email ?? null) : null,
        profile,
        prevAnonUserId,
        clearPrevAnon,
        signIn,
        signUp,
        signOut,
        refreshProfile,
        updateProfile,
        migrateAnonProjects,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
