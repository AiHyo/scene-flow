import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

type AiCatContextValue = {
  visible: boolean;
  setVisible: (v: boolean) => void;
};

const AiCatContext = createContext<AiCatContextValue | null>(null);

/** 悬浮小猫 AI 助手可见性：隐藏仅当前会话生效，刷新恒定重新出现（不持久化） */
export function AiCatProvider({ children }: { children: ReactNode }) {
  const [visible, setVisible] = useState(true);

  const value = useMemo(() => ({ visible, setVisible }), [visible, setVisible]);
  return <AiCatContext.Provider value={value}>{children}</AiCatContext.Provider>;
}

export function useAiCat(): AiCatContextValue {
  const ctx = useContext(AiCatContext);
  if (!ctx) throw new Error('useAiCat 必须在 AiCatProvider 内使用');
  return ctx;
}
