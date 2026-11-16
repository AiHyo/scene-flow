import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

/**
 * 进程内 FIFO 内存锁，替代默认的 navigator.locks。
 *
 * 背景：auth-js 默认用 navigator.locks 对 getSession/verifyOtp 等加锁。当多个
 * getSession() 并发（StrictMode 双调用、onAuthStateChange 内部刷新、匿名会话建立
 * 与初始化竞态）时，navigator.locks 会打出
 * “Lock “lock:<app>-auth-token” was released because another request stole it” 告警。
 *
 * 该告警本身良性、不影响功能，但会刷屏。会话本身持久化在 localStorage、跨标签页
 * 靠 storage 事件同步，这把锁只用于「同一页面进程内」串行化读写，改用内存锁即可
 * 彻底消除告警，且不改变任何鉴权行为。
 */
const lockTails = new Map<string, Promise<unknown>>();

function memoryLock<R>(name: string, _acquireTimeout: number, fn: () => Promise<R>): Promise<R> {
  const tail = lockTails.get(name) ?? Promise.resolve();
  const result = tail.then(() => fn());
  // 队列尾挂一个永不 reject 的 promise，确保即使本次 fn 抛错，后续调用仍能继续排队
  lockTails.set(name, result.then(() => undefined, () => undefined));
  return result;
}

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    lock: memoryLock,
  },
});
