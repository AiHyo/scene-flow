import { useState } from 'react';
import { Link, NavLink, useLocation } from 'react-router-dom';
import {
  ChevronDown,
  Handshake,
  Home,
  ImagePlus,
  Layers,
  Lightbulb,
  LogIn,
  LogOut,
  Menu,
  Plus,
  RotateCcw,
  Sparkles,
  UserRound,
  UsersRound,
  Wand2,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import AuthDialog from '@/components/auth/AuthDialog';
import ProfileDialog from '@/components/auth/ProfileDialog';
import { UserAvatar } from '@/components/auth/Avatars';
import { useAuth } from '@/contexts/AuthContext';
import { useAiCat } from '@/contexts/AiCatContext';

const MAIN_NAV = [
  { to: '/', label: '首页', icon: Home },
  { to: '/plan', label: '携手与AI共同策划', icon: Wand2, featured: true },
  { to: '/inspiration', label: '找灵感', icon: Lightbulb },
  { to: '/cases', label: '案例探索', icon: Layers },
  { to: '/scene', label: '场景布置', icon: ImagePlus },
  { to: '/plaza', label: '活动广场', icon: UsersRound },
  { to: '/resources', label: '合作伙伴', icon: Handshake },
];

export default function SiteNav() {
  const [open, setOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register'>('login');
  const [profileOpen, setProfileOpen] = useState(false);
  const location = useLocation();
  const { isAccount, email, profile, signOut } = useAuth();
  const { visible: aiCatVisible, setVisible: setAiCatVisible } = useAiCat();

  const openAuth = (mode: 'login' | 'register') => {
    setAuthMode(mode);
    setAuthOpen(true);
  };

  const handleSignOut = async () => {
    await signOut();
    toast.info('已退出登录，回到访客模式；本机访客数据保留，账号活动不受影响');
  };

  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-2 px-4 md:gap-3 md:px-5">
        <Link
          to="/"
          onClick={() => {
            /* 已在首页时点击 Logo：确实回到第一幕（滚到 pinned 舞台顶部，ScrollTrigger 还原到幕1），
               不是只向上移动一小段或停在中间 */
            if (window.location.pathname === '/') {
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }
          }}
          className="flex shrink-0 items-center gap-2"
          aria-label="SceneFlow AI 首页"
        >
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Sparkles className="h-4.5 w-4.5" />
          </span>
          <span className="gradient-text text-lg font-bold tracking-tight">SceneFlow AI</span>
        </Link>

        {/* 桌面主导航：全部功能入口集中于左侧，仅账户菜单留右侧 */}
        <nav className="ml-2 hidden min-w-0 items-center gap-1 md:flex" aria-label="主导航">
          {MAIN_NAV.filter((i) => !i.featured).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-2 text-sm font-medium transition-colors hover:text-primary hover:bg-primary/5 ${
                  isActive ? 'text-primary' : 'text-muted-foreground'
                }`
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {/* AI 共策主入口（桌面端）：移至右侧头像旁，作为独立主行动按钮 */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="hidden items-center gap-1.5 whitespace-nowrap rounded-lg bg-primary/10 px-2 py-2 text-sm font-medium text-foreground transition-colors hover:bg-primary/15 data-[state=open]:text-primary md:flex"
              >
                <Wand2 className="h-4 w-4 text-primary" />
                携手与AI共同策划
                <ChevronDown className="h-3.5 w-3.5 opacity-60" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-w-[calc(100%-2rem)] md:max-w-64">
              <DropdownMenuItem
                onClick={() => {
                  try {
                    const last = sessionStorage.getItem('sf-last-workbench');
                    if (last) window.location.assign(`/workbench/${last}`);
                    else window.location.assign('/projects');
                  } catch {
                    window.location.assign('/projects');
                  }
                }}
              >
                <RotateCcw className="h-4 w-4" />
                继续最近活动
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => window.location.assign('/projects')}>
                <UserRound className="h-4 w-4" />
                我的活动
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => window.location.assign('/plan')}>
                <Plus className="h-4 w-4" />
                新建活动
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          {/* 头像菜单：登录=昵称/邮箱+资料+退出；访客=登录/注册 */}
          <DropdownMenu>
            <DropdownMenuTrigger
              className="rounded-full outline-none ring-primary focus-visible:ring-2"
              aria-label="账号菜单"
            >
              <UserAvatar className="h-9 w-9 border" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-60">
              {isAccount ? (
                <>
                  <DropdownMenuLabel className="flex items-center gap-2 py-2">
                    <UserAvatar className="h-9 w-9" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {profile?.nickname?.trim() || '未设置昵称'}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">{email}</span>
                    </span>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link to="/projects" className="flex items-center gap-2">
                      <UserRound className="h-4 w-4" />
                      我的活动
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setProfileOpen(true)}>
                    <UserRound className="h-4 w-4" />
                    个人中心
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setAiCatVisible(!aiCatVisible)}>
                    <Sparkles className="h-4 w-4" />
                    {aiCatVisible ? '隐藏 AI 助手' : '显示 AI 助手'}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => void handleSignOut()}>
                    <LogOut className="h-4 w-4" />
                    退出登录
                  </DropdownMenuItem>
                </>
              ) : (
                <>
                  <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                    当前为访客模式，功能可用；登录后多设备同步活动
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setProfileOpen(true)}>
                    <UserRound className="h-4 w-4" />
                    个人中心
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setAiCatVisible(!aiCatVisible)}>
                    <Sparkles className="h-4 w-4" />
                    {aiCatVisible ? '隐藏 AI 助手' : '显示 AI 助手'}
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          {/* 访客：登录/注册直接露出在头像右侧（桌面端），不再收进下拉框 */}
          {!isAccount && (
            <div className="hidden items-center gap-2 md:flex">
              <Button variant="outline" size="sm" onClick={() => openAuth('login')}>
                <LogIn className="h-4 w-4" />
                登录
              </Button>
              <Button size="sm" onClick={() => openAuth('register')}>
                注册
              </Button>
            </div>
          )}

          {/* 移动端菜单 */}
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="md:hidden" aria-label="打开菜单">
                <Menu className="h-5 w-5" />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72 overflow-y-auto">
              <SheetHeader>
                <SheetTitle className="flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" />
                  SceneFlow AI
                </SheetTitle>
              </SheetHeader>
              <nav className="flex flex-col gap-1 px-4" aria-label="移动端导航">
                {/* AI 共策主入口（移动端）：继续最近 / 切换 / 新建 */}
                <div className="mb-1 rounded-lg bg-primary/10 p-1">
                  <p className="flex min-h-10 items-center gap-2 px-3 pt-1 text-xs font-medium text-muted-foreground">
                    <Wand2 className="h-3.5 w-3.5 text-primary" />
                    携手与AI共同策划
                  </p>
                  <button
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      try {
                        const last = sessionStorage.getItem('sf-last-workbench');
                        window.location.assign(last ? `/workbench/${last}` : '/projects');
                      } catch {
                        window.location.assign('/projects');
                      }
                    }}
                    className="flex min-h-11 w-full items-center gap-2 rounded-md px-6 text-sm font-medium text-foreground transition-colors hover:bg-background"
                  >
                    <RotateCcw className="h-4 w-4 text-primary" />
                    继续最近活动
                  </button>
                  <NavLink
                    to="/projects"
                    onClick={() => setOpen(false)}
                    className="flex min-h-11 items-center gap-2 rounded-md px-6 text-sm font-medium text-foreground transition-colors hover:bg-background"
                  >
                    <UserRound className="h-4 w-4 text-primary" />
                    我的活动
                  </NavLink>
                  <NavLink
                    to="/plan"
                    onClick={() => setOpen(false)}
                    className="flex min-h-11 items-center gap-2 rounded-md px-6 text-sm font-medium text-foreground transition-colors hover:bg-background"
                  >
                    <Plus className="h-4 w-4 text-primary" />
                    新建活动
                  </NavLink>
                </div>
                {MAIN_NAV.filter((i) => !i.featured).map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === '/'}
                    onClick={() => setOpen(false)}
                    className={({ isActive }) =>
                      `flex min-h-12 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors ${
                        isActive ? 'bg-primary/10 text-primary' : 'text-foreground hover:bg-muted'
                      }`
                    }
                  >
                    <item.icon className="h-4 w-4" />
                    {item.label}
                  </NavLink>
                ))}

                <div className="mt-4 border-t pt-3">
                  {isAccount ? (
                    <>
                      <div className="mb-2 flex items-center gap-2 px-4">
                        <UserAvatar className="h-9 w-9" />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">
                            {profile?.nickname?.trim() || '未设置昵称'}
                          </span>
                          <span className="block truncate text-xs text-muted-foreground">{email}</span>
                        </span>
                      </div>
                      <button
                        type="button"
                        className="flex min-h-12 w-full items-center gap-2 rounded-lg px-4 text-sm font-medium text-foreground hover:bg-muted"
                        onClick={() => {
                          setOpen(false);
                          setProfileOpen(true);
                        }}
                      >
                        <UserRound className="h-4 w-4" />
                        个人中心
                      </button>
                      <button
                        type="button"
                        className="flex min-h-12 w-full items-center gap-2 rounded-lg px-4 text-sm font-medium text-foreground hover:bg-muted"
                        onClick={() => {
                          setOpen(false);
                          void handleSignOut();
                        }}
                      >
                        <LogOut className="h-4 w-4" />
                        退出登录
                      </button>
                    </>
                  ) : (
                    <div className="flex gap-2 px-4">
                      <Button
                        variant="outline"
                        className="flex-1"
                        onClick={() => {
                          setOpen(false);
                          openAuth('login');
                        }}
                      >
                        <LogIn className="h-4 w-4" />
                        登录
                      </Button>
                      <Button
                        className="flex-1"
                        onClick={() => {
                          setOpen(false);
                          openAuth('register');
                        }}
                      >
                        注册
                      </Button>
                    </div>
                  )}
                </div>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      <AuthDialog open={authOpen} onOpenChange={setAuthOpen} initialMode={authMode} />
      <ProfileDialog open={profileOpen} onOpenChange={setProfileOpen} />
    </header>
  );
}
