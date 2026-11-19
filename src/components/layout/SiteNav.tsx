import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
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
  const navigate = useNavigate();
  const { isAccount, email, profile, signOut } = useAuth();
  const { visible: aiCatVisible, setVisible: setAiCatVisible } = useAiCat();

  const goLastWorkbenchOrProjects = () => {
    try {
      const last = sessionStorage.getItem('sf-last-workbench');
      navigate(last ? `/workbench/${last}` : '/projects');
    } catch {
      navigate('/projects');
    }
  };

  const openAuth = (mode: 'login' | 'register') => {
    setAuthMode(mode);
    setAuthOpen(true);
  };

  const handleSignOut = async () => {
    await signOut();
    toast.info('已退出登录，回到访客模式；本机访客数据保留，账号活动不受影响');
  };

  return (
    <header className="sticky top-0 z-40 border-b border-border/70 bg-card/85 backdrop-blur-md">
      <div className="mx-auto flex h-16 w-full max-w-7xl items-center gap-2 px-4 md:gap-3 md:px-5">
        <Link
          to="/"
          onClick={() => {
            if (window.location.pathname === '/') {
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }
          }}
          className="flex shrink-0 items-center gap-2.5"
          aria-label="SceneFlow AI 首页"
        >
          <span className="sf-pill-cobalt flex h-8.5 w-8.5 items-center justify-center rounded-xl">
            <Sparkles className="h-4.5 w-4.5" />
          </span>
          <span className="font-display text-lg font-black tracking-tight text-foreground">SceneFlow AI</span>
        </Link>

        {/* 桌面主导航：lg 以上展开，胶囊选中态与首页一致 */}
        <nav className="ml-2 hidden min-w-0 items-center gap-1 lg:flex" aria-label="主导航">
          {MAIN_NAV.filter((i) => !i.featured).map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium transition-all ${
                  isActive
                    ? 'bg-primary/10 font-semibold text-primary'
                    : 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                }`
              }
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {/* AI 共策主入口（桌面端） */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="hidden items-center gap-1.5 whitespace-nowrap rounded-full border border-primary/25 bg-[#F4F5FF] px-3.5 py-1.5 text-sm font-semibold text-primary shadow-2xs transition-all hover:border-primary/50 hover:bg-primary/15 lg:flex"
              >
                <Wand2 className="h-4 w-4 text-primary" />
                AI 共策
                <ChevronDown className="h-3.5 w-3.5 opacity-70" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-w-[calc(100%-2rem)] md:max-w-64">
              <DropdownMenuItem onClick={goLastWorkbenchOrProjects}>
                <RotateCcw className="h-4 w-4" />
                继续最近活动
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => navigate('/projects')}>
                <UserRound className="h-4 w-4" />
                我的活动
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate('/plan')}>
                <Plus className="h-4 w-4" />
                新建活动
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* 账号/访客态菜单：未登录显式标明「访客」胶囊，消除“已登录”歧义 */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              {isAccount ? (
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-full border bg-card py-1 pl-1 pr-2.5 text-sm outline-none ring-primary transition-colors hover:bg-muted/60 focus-visible:ring-2"
                  aria-label="账号菜单"
                >
                  <UserAvatar className="h-7 w-7" />
                  <span className="hidden max-w-24 truncate font-medium sm:inline">
                    {profile?.nickname?.trim() || '我的账号'}
                  </span>
                  <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              ) : (
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-full border border-dashed bg-muted/60 py-1 pl-1.5 pr-2.5 text-xs font-medium text-muted-foreground outline-none ring-primary transition-colors hover:border-primary/40 hover:text-foreground focus-visible:ring-2"
                  aria-label="访客模式菜单"
                >
                  <UserAvatar className="h-6 w-6 opacity-90" />
                  <span>{profile?.nickname?.trim() || '访客'}</span>
                  <ChevronDown className="h-3 w-3 opacity-70" />
                </button>
              )}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
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
                  <DropdownMenuLabel className="text-xs font-normal leading-relaxed text-muted-foreground">
                    当前为访客体验模式，可免登录直接策划；登录后支持跨设备同步。
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem asChild>
                    <Link to="/projects" className="flex items-center gap-2">
                      <UserRound className="h-4 w-4" />
                      我的访客活动
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setProfileOpen(true)}>
                    <UserRound className="h-4 w-4" />
                    本地资料设置
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setAiCatVisible(!aiCatVisible)}>
                    <Sparkles className="h-4 w-4" />
                    {aiCatVisible ? '隐藏 AI 助手' : '显示 AI 助手'}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => openAuth('login')}>
                    <LogIn className="h-4 w-4 text-primary" />
                    <span className="font-medium text-primary">登录 / 注册同步</span>
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>

          {!isAccount && (
            <Button size="sm" className="hidden lg:inline-flex" onClick={() => openAuth('login')}>
              <LogIn className="h-4 w-4" />
              登录 / 注册
            </Button>
          )}

          {/* 移动端 / 平板菜单 */}
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="lg:hidden" aria-label="打开菜单">
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
                      goLastWorkbenchOrProjects();
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
