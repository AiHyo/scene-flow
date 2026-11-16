import { useEffect } from 'react';
import { BrowserRouter, useLocation } from 'react-router-dom';
import { AuthProvider } from '@/contexts/AuthContext';
import { AiCatProvider } from '@/contexts/AiCatContext';
import SiteNav from '@/components/layout/SiteNav';
import FloatingCat from '@/components/cat/FloatingCat';
import { Toaster } from '@/components/ui/sonner';
import AppRoutes from '@/routes';

/** 路由切换时回到页面顶部（页内状态切换如灵感详情由页面自行管理滚动） */
function ScrollToTop() {
  const { pathname, search } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname, search]);
  return null;
}

/** 工作台 / 成果预览等沉浸页隐藏全局导航 */
function GlobalChrome() {
  const location = useLocation();
  const immersive = /^\/(workbench|preview)\//.test(location.pathname);
  if (immersive) return null;
  return <SiteNav />;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AiCatProvider>
        <ScrollToTop />
        <div className="app-surface flex min-h-screen w-full flex-col">
          <GlobalChrome />
          <main className="flex-1">
            <AppRoutes />
          </main>
          {/* 悬浮小猫 AI 助手：挂路由外层，切页不重复挂载，隐藏页不渲染 */}
          <FloatingCat />
          {/* 全局通知：不挂载时所有 toast.* 静默失效（此前上传失败/校验提示均无反馈的根因） */}
          <Toaster />
        </div>
        </AiCatProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
