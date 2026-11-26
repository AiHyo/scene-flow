import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { apiRequest, getAuthToken, setAuthToken } from '@/lib/apiClient';

const CRED_KEY = 'anon_credential_id';
/** 登录前记录的访客 userId（登录后可选关联） */
const PREV_ANON_KEY = 'prev_anon_uid';
/** 访客本机资料（仅当前浏览器可见；登录账号资料存服务端，互不搬移） */
const GUEST_PROFILE_KEY = 'sf-guest-profile';

function getCredentialId(): string {
  let v = localStorage.getItem(CRED_KEY);
  if (!v) {
    v = crypto.randomUUID();
    localStorage.setItem(CRED_KEY, v);
  }
  return v;
}

export interface UserProfile {
  nickname: string | null;
  avatarUrl: string | null;
}

interface AuthUser {
  id: string;
  email: string | null;
  nickname: string | null;
  avatarUrl: string | null;
  role: string;
  isAnon: boolean;
}

interface AuthTokenResp {
  accessToken: string;
  user: AuthUser;
}

interface AuthContextType {
  userId: string | null;
  ready: boolean;
  /** 等待会话就绪 */
  waitForReady: (timeoutMs?: number) => Promise<boolean>;
  /** 是否为登录账号（false = 匿名访客会话） */
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
  /** 把本机访客名下项目转到当前账号（需登录态；以本机访客凭证证明身份） */
  migrateAnonProjects: () => Promise<number>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function readGuestProfile(): UserProfile | null {
  try {
    const raw = localStorage.getItem(GUEST_PROFILE_KEY);
    return raw ? (JSON.parse(raw) as UserProfile) : null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);
  const readyRef = useRef(false);
  useEffect(() => {
    readyRef.current = ready;
  }, [ready]);

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [prevAnonUserId, setPrevAnonUserId] = useState<string | null>(() => localStorage.getItem(PREV_ANON_KEY));
  const mountedRef = useRef(true);
  const anonSeqRef = useRef(0);

  const ensureAnonSession = useCallback(async () => {
    const seq = ++anonSeqRef.current;
    try {
      const credentialId = getCredentialId();
      const resp = await apiRequest<AuthTokenResp>('/api/v1/auth/anon', {
        method: 'POST',
        body: JSON.stringify({ credentialId }),
      });
      if (!mountedRef.current || seq !== anonSeqRef.current) return;
      setAuthToken(resp.accessToken);
      setUser(resp.user);
      setProfile(readGuestProfile());
    } catch (e) {
      console.warn('匿名会话建立失败:', e);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    const init = async () => {
      const existingToken = getAuthToken();
      if (existingToken) {
        try {
          const me = await apiRequest<AuthUser>('/api/v1/auth/me');
          if (mountedRef.current) {
            setUser(me);
            setProfile(
              me.isAnon
                ? readGuestProfile()
                : { nickname: me.nickname ?? null, avatarUrl: me.avatarUrl ?? null }
            );
            setReady(true);
          }
          return;
        } catch {
          setAuthToken(null);
        }
      }
      await ensureAnonSession();
      if (mountedRef.current) setReady(true);
    };
    void init();
    return () => {
      mountedRef.current = false;
    };
  }, [ensureAnonSession]);

  const isAccount = !!user && !user.isAnon;

  const waitForReady = useCallback(async (timeoutMs = 15000): Promise<boolean> => {
    if (readyRef.current) return true;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 200));
      if (readyRef.current) return true;
    }
    return readyRef.current;
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!user || user.isAnon) {
      setProfile(readGuestProfile());
      return;
    }
    const me = await apiRequest<AuthUser>('/api/v1/auth/me');
    setUser(me);
    setProfile({ nickname: me.nickname ?? null, avatarUrl: me.avatarUrl ?? null });
  }, [user]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      anonSeqRef.current++;
      if (user?.id && user.isAnon) {
        localStorage.setItem(PREV_ANON_KEY, user.id);
        setPrevAnonUserId(user.id);
      }
      const resp = await apiRequest<AuthTokenResp>('/api/v1/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password }),
      });
      setAuthToken(resp.accessToken);
      setUser(resp.user);
      setProfile({ nickname: resp.user.nickname ?? null, avatarUrl: resp.user.avatarUrl ?? null });
    },
    [user]
  );

  const signUp = useCallback(
    async (email: string, password: string, nickname?: string) => {
      anonSeqRef.current++;
      if (user?.id && user.isAnon) {
        localStorage.setItem(PREV_ANON_KEY, user.id);
        setPrevAnonUserId(user.id);
      }
      const resp = await apiRequest<AuthTokenResp>('/api/v1/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password, nickname: nickname?.trim() || undefined }),
      });
      setAuthToken(resp.accessToken);
      setUser(resp.user);
      setProfile({ nickname: resp.user.nickname ?? null, avatarUrl: resp.user.avatarUrl ?? null });
    },
    [user]
  );

  const signOut = useCallback(async () => {
    setAuthToken(null);
    setUser(null);
    setProfile(readGuestProfile());
    await ensureAnonSession();
  }, [ensureAnonSession]);

  const updateProfile = useCallback(
    async (p: Partial<UserProfile>) => {
      if (!user?.id) throw new Error('会话准备中，请稍候再试');
      if (user.isAnon) {
        const next: UserProfile = {
          nickname: p.nickname !== undefined ? p.nickname : profile?.nickname ?? null,
          avatarUrl: p.avatarUrl !== undefined ? p.avatarUrl : profile?.avatarUrl ?? null,
        };
        localStorage.setItem(GUEST_PROFILE_KEY, JSON.stringify(next));
        setProfile(next);
        return;
      }
      const updated = await apiRequest<AuthUser>('/api/v1/auth/me', {
        method: 'PATCH',
        body: JSON.stringify({
          ...(p.nickname !== undefined ? { nickname: p.nickname } : {}),
          ...(p.avatarUrl !== undefined ? { avatarUrl: p.avatarUrl } : {}),
        }),
      });
      setUser(updated);
      setProfile({ nickname: updated.nickname ?? null, avatarUrl: updated.avatarUrl ?? null });
    },
    [user, profile]
  );

  const migrateAnonProjects = useCallback(async () => {
    /* 以本机保存的访客凭证证明访客身份（后端不再接受裸用户 ID）；
     * 直接读取而不是 getCredentialId()，后者在缺失时会新建一个无效凭证 */
    const credentialId = localStorage.getItem(CRED_KEY);
    if (!credentialId) return 0;
    const data = await apiRequest<{ migratedCount: number }>('/api/v1/auth/migrate-project', {
      method: 'POST',
      body: JSON.stringify({ credentialId }),
    });
    return data.migratedCount ?? 0;
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
