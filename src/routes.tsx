import type { ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import Home from '@/pages/Home';
import Inspiration from '@/pages/Inspiration';
import Cases from '@/pages/Cases';
import PlanStart from '@/pages/PlanStart';
import SceneStart from '@/pages/SceneStart';
import Resources from '@/pages/Resources';
import Workbench from '@/pages/Workbench';
import Preview from '@/pages/Preview';
import Projects from '@/pages/Projects';
import Plaza from '@/pages/Plaza';
import NotFound from '@/pages/NotFound';

export interface RouteConfig {
  name: string;
  path: string;
  element: ReactNode;
  visible?: boolean;
  public?: boolean;
}

export const routes: RouteConfig[] = [
  { name: '首页', path: '/', element: <Home />, public: true },
  { name: '找灵感', path: '/inspiration', element: <Inspiration />, public: true },
  { name: '案例探索', path: '/cases', element: <Cases />, public: true },
  { name: '场景布置', path: '/scene', element: <SceneStart />, public: true },
  { name: '活动广场', path: '/plaza', element: <Plaza />, public: true },
  { name: 'AI 共同策划', path: '/plan', element: <PlanStart />, public: true },
  { name: '合作伙伴', path: '/resources', element: <Resources />, public: true },
  { name: '策划工作台', path: '/workbench/:id', element: <Workbench />, public: true },
  { name: '成果预览', path: '/preview/:id', element: <Preview />, public: true },
  { name: '我的活动', path: '/projects', element: <Projects />, public: true },
];

export default function AppRoutes() {
  return (
    <Routes>
      {routes.map((route) => (
        <Route key={route.path} path={route.path} element={route.element} />
      ))}
      <Route path="/sample" element={<Navigate to="/" replace />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}
