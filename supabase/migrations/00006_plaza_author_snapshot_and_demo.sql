-- 广场：作者快照列 + 演示数据支持
-- 1) profiles RLS 仅允许本人查看，匿名浏览拿不到其他作者昵称头像 → 增加发文时刻快照列（触发器自动填充，客户端不可伪造）
-- 2) 演示作者使用固定 UUID 稳定内部 ID，无 auth 凭证、不在 profiles → 移除 posts.author_id / comments.user_id 的 FK（RLS 与全部写权限保持不变）

alter table public.plaza_posts drop constraint plaza_posts_author_id_fkey;
alter table public.plaza_comments drop constraint plaza_comments_user_id_fkey;

alter table public.plaza_posts
  add column author_nickname text,
  add column author_avatar_url text,
  add column base_like_count int not null default 0,
  add column is_demo boolean not null default false;

alter table public.plaza_comments
  add column author_nickname text,
  add column author_avatar_url text,
  add column is_demo boolean not null default false;

-- 真实用户发文时自动填充作者快照（SECURITY DEFINER 绕过 profiles RLS 读取本人资料；演示数据由种子直接提供快照）
create or replace function public.plaza_posts_fill_author_snapshot() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.author_id is not null and auth.uid() is not null then
    select p.nickname, p.avatar_url into new.author_nickname, new.author_avatar_url
    from public.profiles p where p.id = auth.uid();
  end if;
  return new;
end;
$$;

create trigger trg_plaza_posts_fill_author
before insert on public.plaza_posts
for each row execute function public.plaza_posts_fill_author_snapshot();

create or replace function public.plaza_comments_fill_author_snapshot() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.user_id is not null and auth.uid() is not null then
    select p.nickname, p.avatar_url into new.author_nickname, new.author_avatar_url
    from public.profiles p where p.id = auth.uid();
  end if;
  return new;
end;
$$;

create trigger trg_plaza_comments_fill_author
before insert on public.plaza_comments
for each row execute function public.plaza_comments_fill_author_snapshot();

-- 删除权限收紧：演示内容仅 admin 可删；真实内容仅作者本人（admin 也可）
create or replace function public.plaza_is_admin() returns boolean
language sql stable security definer set search_path = public, auth as $$
  select coalesce((select get_user_role(auth.uid()) = 'admin'::user_role), false);
$$;

drop policy plaza_posts_delete_own on public.plaza_posts;
create policy plaza_posts_delete_own on public.plaza_posts
  for delete to authenticated
  using (public.plaza_is_admin() or (not is_demo and public.is_real_account() and author_id = auth.uid()));

drop policy plaza_comments_delete_own on public.plaza_comments;
create policy plaza_comments_delete_own on public.plaza_comments
  for delete to authenticated
  using (public.plaza_is_admin() or (not is_demo and public.is_real_account() and user_id = auth.uid()));

-- ---------- 一次性演示数据初始化（幂等：固定 ID + ON CONFLICT DO NOTHING，重复执行不重复插入、不覆盖用户内容） ----------
create or replace function public.plaza_seed_demo_content() returns void
language plpgsql security definer set search_path = public as $$
declare
  authors jsonb := '{
    "一颗松子":"00000000-0000-4000-8000-0000000000a1",
    "周五不加班":"00000000-0000-4000-8000-0000000000a2",
    "橘子汽水":"00000000-0000-4000-8000-0000000000a3",
    "阿木同学":"00000000-0000-4000-8000-0000000000a4",
    "巷口的月亮":"00000000-0000-4000-8000-0000000000a5",
    "小林慢慢来":"00000000-0000-4000-8000-0000000000a6",
    "阿北":"00000000-0000-4000-8000-0000000000a7",
    "晚风有信":"00000000-0000-4000-8000-0000000000a8",
    "夏天还没结束":"00000000-0000-4000-8000-0000000000a9",
    "小陈同学":"00000000-0000-4000-8000-0000000000aa",
    "茶还没凉":"00000000-0000-4000-8000-0000000000ab",
    "山间有风":"00000000-0000-4000-8000-0000000000ac",
    "收纳进行时":"00000000-0000-4000-8000-0000000000ad",
    "邻居小吴":"00000000-0000-4000-8000-0000000000ae",
    "懒得起昵称":"00000000-0000-4000-8000-0000000000af"
  }';
  cat_avatar text := '/images/assets/user-cat.png';
  posts jsonb := '[
    {"id":"00000000-0000-4000-8000-0000000001a1","title":"第一次负责公司年会，我决定先不急着排节目","body":"刚接到年会策划时，我第一反应是找节目、找游戏，结果越看越乱。\n\n后来换了个顺序：先确认这次更重视表彰还是轻松交流，再了解大概人数和可用时间，最后才往里面放内容。预算还没确定的部分先列选择，不急着写死。\n\n布置想把重点放在前方背景和桌面，其他地方尽量简洁。流程也留一点余量，不想让主持人整晚都在催下一个环节。\n\n第一次负责的人，最容易忽略什么？","images":["/images/plaza/01-annual.webp"],"published":"2026-10-13T10:05:00+08:00","base":52,"author":"一颗松子",
      "comments":[
        {"id":"00000000-0000-4000-8000-0000000001b1","author":"周五不加班","body":"一定要留吃饭时间，不然菜上齐了还在看节目。"},
        {"id":"00000000-0000-4000-8000-0000000001b2","author":"阿北","body":"音响和投屏提前试，视频别等开场才第一次播放。"},
        {"id":"00000000-0000-4000-8000-0000000001b3","author":"橘子汽水","body":"抽奖和合影的时间很容易超，记得留余量。"}
      ]},
    {"id":"00000000-0000-4000-8000-0000000002a1","title":"团建不想轮流上台，那就把草坪变成游园会","body":"这次团建，我最想解决的不是节目不够多，而是大家能不能自在一点。\n\n草坪分成三个区域：想动起来的去玩套圈和小游戏，想聊天的坐在树荫下，想安静待着的就拿杯饮料休息。不安排轮流自我介绍，也不要求每个人参加所有项目。\n\n彩旗、游戏道具和茶歇桌就够了，入口留一个明显的集合点。比起排满时间表，我更希望大家能找到舒服的参与方式。\n\n你们团建最想取消哪个环节？","images":["/images/plaza/02-lawn.webp"],"published":"2026-10-12T16:30:00+08:00","base":38,"author":"周五不加班",
      "comments":[
        {"id":"00000000-0000-4000-8000-0000000002b1","author":"懒得起昵称","body":"投轮流上台一票！有自由活动区真的会愿意参加。"},
        {"id":"00000000-0000-4000-8000-0000000002b2","author":"阿北","body":"建议茶歇放在休息区旁边，玩累了直接过去。"}
      ]},
    {"id":"00000000-0000-4000-8000-0000000003a1","title":"生日派对不想堆满气球，我想做一面照片墙","body":"比起很大的生日背景板，我更喜欢那些能让朋友停下来聊两句的小细节。\n\n用奶油色和浅橘色，把合照夹在墙边，再留几张空白卡片写祝福。桌上放蛋糕、小花和简单餐具，气球只点缀一角，不把整个房间塞满。\n\n照片可以按年份排，也可以故意打乱，让大家猜是哪一次聚会。\n\n目前还在纠结：祝福卡是现场写，还是提前偷偷收集更有惊喜？","images":["/images/plaza/03-birthday.webp"],"published":"2026-10-11T20:15:00+08:00","base":26,"author":"橘子汽水",
      "comments":[
        {"id":"00000000-0000-4000-8000-0000000003b1","author":"一颗松子","body":"提前收集一部分，现场再留空白卡，两种都能有。"},
        {"id":"00000000-0000-4000-8000-0000000003b2","author":"晚风有信","body":"照片背面写一句当时的故事，应该会很好玩。"}
      ]},
    {"id":"00000000-0000-4000-8000-0000000004a1","title":"毕业欢送会，想给大家留一面回忆墙","body":"空大厅看起来有点冷清，但我不想把毕业欢送会布置成正式大会。\n\n前面留合影背景，中间放座椅，侧边做照片展示和留言桌。入场时大家先写一句想说的话，结束后可以带走自己的留言卡，或者把它送给同学。\n\n深蓝和金色负责仪式感，照片和手写字负责让它像我们的毕业。\n\n座椅不会排得太满，中间和两侧都留出通道。大家自由走动、拍照、找朋友聊天，比一直坐着看节目重要。","images":["/images/plaza/04-graduation.webp"],"published":"2026-06-20T18:40:00+08:00","base":45,"author":"阿木同学",
      "comments":[
        {"id":"00000000-0000-4000-8000-0000000004b1","author":"夏天还没结束","body":"可以给每个人一个信封，最后把收到的留言一起带走。"},
        {"id":"00000000-0000-4000-8000-0000000004b2","author":"小陈同学","body":"照片展示区别离入口太近，不然一进门就堵住了。"},
        {"id":"00000000-0000-4000-8000-0000000004b3","author":"阿木同学","body":"准备放到侧墙，入口只留签到。"}
      ]},
    {"id":"00000000-0000-4000-8000-0000000005a1","title":"中秋不一定要办晚会，围坐喝茶也很好","body":"这次想做一场没有舞台、没有主持稿的中秋小聚。\n\n院子里摆几张茶桌，灯笼放在一侧，再留一张手作桌。大家可以喝茶、聊天，也可以去做点小东西，不用跟着统一流程赶场。\n\n以暖色灯光、木质桌椅和少量花艺为主，让院子本身的样子露出来，不把每个角落都装满。\n\n如果晚上风大，纸灯笼和桌面装饰还得固定好。好看之外，收拾起来方便也很重要。","images":["/images/plaza/05-courtyard.webp"],"published":"2026-09-20T19:20:00+08:00","base":31,"author":"巷口的月亮",
      "comments":[
        {"id":"00000000-0000-4000-8000-0000000005b1","author":"茶还没凉","body":"喜欢这种不用一直参与节目的小聚。"},
        {"id":"00000000-0000-4000-8000-0000000005b2","author":"山间有风","body":"可以备一些不含咖啡因的饮品。"}
      ]},
    {"id":"00000000-0000-4000-8000-0000000006a1","title":"社区旧物交换，规则清楚比装饰漂亮更重要","body":"整理旧物交换活动时，发现最容易漏掉的不是桌椅，而是东西到了现场以后怎么办。\n\n先分书籍、玩具、生活用品几个区域，每件物品贴上状态说明。交换规则放在入口，不能交换的物品提前说清楚，避免带来了才失望。\n\n布置不用复杂，分类牌、桌布和几个周转箱就能让现场清楚很多。还要留一个暂存区，别让纸箱堆在通道上。\n\n最后没换出去的东西，让原主人带回，不能默认替大家处理。","images":["/images/plaza/06-swap.webp"],"published":"2026-10-08T12:10:00+08:00","base":19,"author":"小林慢慢来",
      "comments":[
        {"id":"00000000-0000-4000-8000-0000000006b1","author":"收纳进行时","body":"状态说明很重要，尤其是缺零件和有小瑕疵的东西。"},
        {"id":"00000000-0000-4000-8000-0000000006b2","author":"邻居小吴","body":"准备几支粗头笔，现场补标签肯定用得上。"}
      ]}
  ]';
  p jsonb;
  c jsonb;
  aid uuid;
  cid uuid;
  ctime timestamptz;
  i int;
begin
  for p in select * from jsonb_array_elements(posts) loop
    aid := (authors ->> (p->>'author'))::uuid;
    insert into public.plaza_posts (id, author_id, title, content, images, like_count, base_like_count, is_demo, author_nickname, author_avatar_url, created_at)
    values (
      (p->>'id')::uuid, aid, p->>'title', p->>'body',
      (select array_agg(x #>> '{}') from jsonb_array_elements(p->'images') x),
      0, (p->>'base')::int, true, p->>'author', cat_avatar,
      (p->>'published')::timestamptz
    )
    on conflict (id) do nothing;

    i := 0;
    for c in select * from jsonb_array_elements(coalesce(p->'comments', '[]'::jsonb)) loop
      i := i + 1;
      cid := (authors ->> (c->>'author'))::uuid;
      -- 评论时间：帖子发布后 5 分钟起逐条递增（+5、+15、+25 分钟…）固定保存
      ctime := (p->>'published')::timestamptz + make_interval(mins => 5 + 10 * (i - 1));
      insert into public.plaza_comments (id, post_id, user_id, content, is_demo, author_nickname, author_avatar_url, created_at)
      values ((c->>'id')::uuid, (p->>'id')::uuid, cid, c->>'body', true, c->>'author', cat_avatar, ctime)
      on conflict (id) do nothing;
    end loop;
  end loop;
end;
$$;

-- 立即执行一次性初始化
select public.plaza_seed_demo_content();