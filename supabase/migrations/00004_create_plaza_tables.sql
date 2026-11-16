-- 活动广场：动态 / 点赞 / 评论 三表（轻量社区模块，浏览匿名可读，写入需真实账号）

create table public.plaza_posts (
  id uuid primary key default gen_random_uuid(),
  author_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 60),
  content text not null default '' check (char_length(content) <= 5000),
  images text[] not null default '{}',
  like_count int not null default 0,
  comment_count int not null default 0,
  created_at timestamptz not null default now()
);

create table public.plaza_likes (
  post_id uuid not null references public.plaza_posts(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (post_id, user_id)
);

create table public.plaza_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.plaza_posts(id) on delete cascade,
  user_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  content text not null check (char_length(content) between 1 and 1000),
  created_at timestamptz not null default now()
);

create index idx_plaza_posts_created_at on public.plaza_posts (created_at desc);
create index idx_plaza_comments_post_id on public.plaza_comments (post_id, created_at asc);

-- 真实账号判断（匿名会话 is_anonymous=true，不算「已登录」，发帖/点赞/评论均拒绝）
create or replace function public.is_real_account() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select coalesce(
    (select u.is_anonymous = false from auth.users u where u.id = auth.uid()),
    false
  );
$$;

-- 点赞计数冗余维护（security definer 绕过 RLS 更新计数列）
create or replace function public.plaza_like_count_sync() returns trigger
language plpgsql security definer as $$
begin
  if (tg_op = 'INSERT') then
    update public.plaza_posts set like_count = like_count + 1 where id = new.post_id;
  elsif (tg_op = 'DELETE') then
    update public.plaza_posts set like_count = greatest(like_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end;
$$;

create trigger trg_plaza_like_count
after insert or delete on public.plaza_likes
for each row execute function public.plaza_like_count_sync();

-- 评论计数冗余维护
create or replace function public.plaza_comment_count_sync() returns trigger
language plpgsql security definer as $$
begin
  if (tg_op = 'INSERT') then
    update public.plaza_posts set comment_count = comment_count + 1 where id = new.post_id;
  elsif (tg_op = 'DELETE') then
    update public.plaza_posts set comment_count = greatest(comment_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end;
$$;

create trigger trg_plaza_comment_count
after insert or delete on public.plaza_comments
for each row execute function public.plaza_comment_count_sync();

-- ---------- RLS ----------
alter table public.plaza_posts enable row level security;
alter table public.plaza_likes enable row level security;
alter table public.plaza_comments enable row level security;

-- 动态：所有人可读；真实账号可发（作者列自动填充）；仅作者本人可删；不开放 UPDATE（无编辑功能）
create policy plaza_posts_select_all on public.plaza_posts
  for select to anon, authenticated using (true);
create policy plaza_posts_insert_own on public.plaza_posts
  for insert to authenticated with check (public.is_real_account() and author_id = auth.uid());
create policy plaza_posts_delete_own on public.plaza_posts
  for delete to authenticated using (public.is_real_account() and author_id = auth.uid());

-- 点赞：所有人可读（判断当前用户是否已赞）；真实账号可赞/取消；主键约束保证每人每帖仅一次
create policy plaza_likes_select_all on public.plaza_likes
  for select to anon, authenticated using (true);
create policy plaza_likes_insert_own on public.plaza_likes
  for insert to authenticated with check (public.is_real_account() and user_id = auth.uid());
create policy plaza_likes_delete_own on public.plaza_likes
  for delete to authenticated using (public.is_real_account() and user_id = auth.uid());

-- 评论：所有人可读；真实账号可发；仅评论作者本人可删
create policy plaza_comments_select_all on public.plaza_comments
  for select to anon, authenticated using (true);
create policy plaza_comments_insert_own on public.plaza_comments
  for insert to authenticated with check (public.is_real_account() and user_id = auth.uid());
create policy plaza_comments_delete_own on public.plaza_comments
  for delete to authenticated using (public.is_real_account() and user_id = auth.uid());