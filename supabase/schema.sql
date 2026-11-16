-- ============================================================
-- SECTION: SCHEMA
-- ============================================================

--
-- PostgreSQL database dump
--


-- Dumped from database version 17.6
-- Dumped by pg_dump version 17.6

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA IF NOT EXISTS "public";


--
-- Name: SCHEMA "public"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA "public" IS 'standard public schema';


--
-- Name: pg_graphql; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";


--
-- Name: EXTENSION "pg_graphql"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "pg_graphql" IS 'pg_graphql: GraphQL support';


--
-- Name: pgcrypto; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";


--
-- Name: EXTENSION "pgcrypto"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "pgcrypto" IS 'cryptographic functions';


--
-- Name: supabase_vault; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";


--
-- Name: EXTENSION "supabase_vault"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "supabase_vault" IS 'Supabase Vault Extension';


--
-- Name: uuid-ossp; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";


--
-- Name: EXTENSION "uuid-ossp"; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION "uuid-ossp" IS 'generate universally unique identifiers (UUIDs)';


--
-- Name: user_role; Type: TYPE; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
      AND t.typname = 'user_role'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE TYPE "public"."user_role" AS ENUM (
    'user',
    'admin'
);
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: get_user_role("uuid"); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."get_user_role"("uid" "uuid") RETURNS "public"."user_role"
    LANGUAGE "sql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT role FROM public.profiles WHERE id = uid;
$$;


--
-- Name: handle_new_user(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  INSERT INTO public.profiles (id, email, phone, role)
  VALUES (NEW.id, NEW.email, NEW.phone, 'user'::public.user_role);
  RETURN NEW;
END;
$$;


--
-- Name: is_real_account(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."is_real_account"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
  select coalesce(
    (select u.is_anonymous = false from auth.users u where u.id = auth.uid()),
    false
  );
$$;


--
-- Name: plaza_comment_count_sync(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."plaza_comment_count_sync"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  if (tg_op = 'INSERT') then
    update public.plaza_posts set comment_count = comment_count + 1 where id = new.post_id;
  elsif (tg_op = 'DELETE') then
    update public.plaza_posts set comment_count = greatest(comment_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end;
$$;


--
-- Name: plaza_comments_fill_author_snapshot(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."plaza_comments_fill_author_snapshot"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.user_id is not null and auth.uid() is not null then
    select p.nickname, p.avatar_url into new.author_nickname, new.author_avatar_url
    from public.profiles p where p.id = auth.uid();
  end if;
  return new;
end;
$$;


--
-- Name: plaza_is_admin(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."plaza_is_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
  select coalesce((select get_user_role(auth.uid()) = 'admin'::user_role), false);
$$;


--
-- Name: plaza_like_count_sync(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."plaza_like_count_sync"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    AS $$
begin
  if (tg_op = 'INSERT') then
    update public.plaza_posts set like_count = like_count + 1 where id = new.post_id;
  elsif (tg_op = 'DELETE') then
    update public.plaza_posts set like_count = greatest(like_count - 1, 0) where id = old.post_id;
  end if;
  return null;
end;
$$;


--
-- Name: plaza_posts_fill_author_snapshot(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."plaza_posts_fill_author_snapshot"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.author_id is not null and auth.uid() is not null then
    select p.nickname, p.avatar_url into new.author_nickname, new.author_avatar_url
    from public.profiles p where p.id = auth.uid();
  end if;
  return new;
end;
$$;


--
-- Name: plaza_seed_demo_content(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."plaza_seed_demo_content"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


--
-- Name: touch_updated_at(); Type: FUNCTION; Schema: public; Owner: -
--

CREATE OR REPLACE FUNCTION "public"."touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;


SET default_tablespace = '';

SET default_table_access_method = "heap";

--
-- Name: anon_credential_map; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."anon_credential_map" (
    "credential_id" "uuid" NOT NULL,
    "auth_uid" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: plaza_comments; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."plaza_comments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "post_id" "uuid" NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "content" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "author_nickname" "text",
    "author_avatar_url" "text",
    "is_demo" boolean DEFAULT false NOT NULL,
    CONSTRAINT "plaza_comments_content_check" CHECK ((("char_length"("content") >= 1) AND ("char_length"("content") <= 1000)))
);


--
-- Name: plaza_likes; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."plaza_likes" (
    "post_id" "uuid" NOT NULL,
    "user_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: plaza_posts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."plaza_posts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "author_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "title" "text" NOT NULL,
    "content" "text" DEFAULT ''::"text" NOT NULL,
    "images" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "like_count" integer DEFAULT 0 NOT NULL,
    "comment_count" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "author_nickname" "text",
    "author_avatar_url" "text",
    "base_like_count" integer DEFAULT 0 NOT NULL,
    "is_demo" boolean DEFAULT false NOT NULL,
    CONSTRAINT "plaza_posts_content_check" CHECK (("char_length"("content") <= 5000)),
    CONSTRAINT "plaza_posts_title_check" CHECK ((("char_length"("title") >= 1) AND ("char_length"("title") <= 60)))
);


--
-- Name: profiles; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "email" "text",
    "phone" "text",
    "role" "public"."user_role" DEFAULT 'user'::"public"."user_role" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "nickname" "text",
    "avatar_url" "text"
);


--
-- Name: projects; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE IF NOT EXISTS "public"."projects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "owner_id" "uuid" DEFAULT "auth"."uid"() NOT NULL,
    "title" "text" NOT NULL,
    "cover_url" "text",
    "data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


--
-- Name: anon_credential_map anon_credential_map_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'anon_credential_map_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'anon_credential_map'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."anon_credential_map"
    ADD CONSTRAINT "anon_credential_map_pkey" PRIMARY KEY ("credential_id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: plaza_comments plaza_comments_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'plaza_comments_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'plaza_comments'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."plaza_comments"
    ADD CONSTRAINT "plaza_comments_pkey" PRIMARY KEY ("id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: plaza_likes plaza_likes_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'plaza_likes_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'plaza_likes'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."plaza_likes"
    ADD CONSTRAINT "plaza_likes_pkey" PRIMARY KEY ("post_id", "user_id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: plaza_posts plaza_posts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'plaza_posts_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'plaza_posts'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."plaza_posts"
    ADD CONSTRAINT "plaza_posts_pkey" PRIMARY KEY ("id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: profiles profiles_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'profiles_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'profiles'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: projects projects_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'projects_pkey'
      AND n.nspname = 'public'
      AND c.relname = 'projects'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_pkey" PRIMARY KEY ("id");
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: idx_plaza_comments_post_id; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "idx_plaza_comments_post_id" ON "public"."plaza_comments" USING "btree" ("post_id", "created_at");


--
-- Name: idx_plaza_posts_created_at; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX IF NOT EXISTS "idx_plaza_posts_created_at" ON "public"."plaza_posts" USING "btree" ("created_at" DESC);


--
-- Name: projects projects_touch_updated_at; Type: TRIGGER; Schema: public; Owner: -
--

CREATE OR REPLACE TRIGGER "projects_touch_updated_at" BEFORE UPDATE ON "public"."projects" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();


--
-- Name: plaza_comments trg_plaza_comment_count; Type: TRIGGER; Schema: public; Owner: -
--

CREATE OR REPLACE TRIGGER "trg_plaza_comment_count" AFTER INSERT OR DELETE ON "public"."plaza_comments" FOR EACH ROW EXECUTE FUNCTION "public"."plaza_comment_count_sync"();


--
-- Name: plaza_comments trg_plaza_comments_fill_author; Type: TRIGGER; Schema: public; Owner: -
--

CREATE OR REPLACE TRIGGER "trg_plaza_comments_fill_author" BEFORE INSERT ON "public"."plaza_comments" FOR EACH ROW EXECUTE FUNCTION "public"."plaza_comments_fill_author_snapshot"();


--
-- Name: plaza_likes trg_plaza_like_count; Type: TRIGGER; Schema: public; Owner: -
--

CREATE OR REPLACE TRIGGER "trg_plaza_like_count" AFTER INSERT OR DELETE ON "public"."plaza_likes" FOR EACH ROW EXECUTE FUNCTION "public"."plaza_like_count_sync"();


--
-- Name: plaza_posts trg_plaza_posts_fill_author; Type: TRIGGER; Schema: public; Owner: -
--

CREATE OR REPLACE TRIGGER "trg_plaza_posts_fill_author" BEFORE INSERT ON "public"."plaza_posts" FOR EACH ROW EXECUTE FUNCTION "public"."plaza_posts_fill_author_snapshot"();


--
-- Name: anon_credential_map anon_credential_map_auth_uid_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'anon_credential_map_auth_uid_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'anon_credential_map'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."anon_credential_map"
    ADD CONSTRAINT "anon_credential_map_auth_uid_fkey" FOREIGN KEY ("auth_uid") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: plaza_comments plaza_comments_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'plaza_comments_post_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'plaza_comments'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."plaza_comments"
    ADD CONSTRAINT "plaza_comments_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."plaza_posts"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: plaza_likes plaza_likes_post_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'plaza_likes_post_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'plaza_likes'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."plaza_likes"
    ADD CONSTRAINT "plaza_likes_post_id_fkey" FOREIGN KEY ("post_id") REFERENCES "public"."plaza_posts"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: plaza_likes plaza_likes_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'plaza_likes_user_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'plaza_likes'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."plaza_likes"
    ADD CONSTRAINT "plaza_likes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'profiles_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'profiles'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: projects projects_owner_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint con
    JOIN pg_class c ON c.oid = con.conrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE con.conname = 'projects_owner_id_fkey'
      AND n.nspname = 'public'
      AND c.relname = 'projects'
  ) THEN
    EXECUTE $pg_schema_sql$
ALTER TABLE ONLY "public"."projects"
    ADD CONSTRAINT "projects_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: profiles Admins have full access to profiles; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'Admins have full access to profiles'
      AND n.nspname = 'public'
      AND c.relname = 'profiles'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "Admins have full access to profiles" ON "public"."profiles" TO "authenticated" USING (("public"."get_user_role"("auth"."uid"()) = 'admin'::"public"."user_role")) WITH CHECK (("public"."get_user_role"("auth"."uid"()) = 'admin'::"public"."user_role"));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: projects Admins have full access to projects; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'Admins have full access to projects'
      AND n.nspname = 'public'
      AND c.relname = 'projects'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "Admins have full access to projects" ON "public"."projects" TO "authenticated" USING (("public"."get_user_role"("auth"."uid"()) = 'admin'::"public"."user_role")) WITH CHECK (("public"."get_user_role"("auth"."uid"()) = 'admin'::"public"."user_role"));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: projects Users can delete own projects; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'Users can delete own projects'
      AND n.nspname = 'public'
      AND c.relname = 'projects'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "Users can delete own projects" ON "public"."projects" FOR DELETE TO "authenticated" USING (("owner_id" = "auth"."uid"()));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: projects Users can insert own projects; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'Users can insert own projects'
      AND n.nspname = 'public'
      AND c.relname = 'projects'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "Users can insert own projects" ON "public"."projects" FOR INSERT TO "authenticated" WITH CHECK (("owner_id" = "auth"."uid"()));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: projects Users can update own projects; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'Users can update own projects'
      AND n.nspname = 'public'
      AND c.relname = 'projects'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "Users can update own projects" ON "public"."projects" FOR UPDATE TO "authenticated" USING (("owner_id" = "auth"."uid"())) WITH CHECK (("owner_id" = "auth"."uid"()));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: profiles Users can update their own profile; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'Users can update their own profile'
      AND n.nspname = 'public'
      AND c.relname = 'profiles'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "Users can update their own profile" ON "public"."profiles" FOR UPDATE TO "authenticated" USING (("auth"."uid"() = "id")) WITH CHECK ((NOT ("role" IS DISTINCT FROM "public"."get_user_role"("auth"."uid"()))));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: projects Users can view own projects; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'Users can view own projects'
      AND n.nspname = 'public'
      AND c.relname = 'projects'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "Users can view own projects" ON "public"."projects" FOR SELECT TO "authenticated" USING ((("owner_id" = "auth"."uid"()) OR ("public"."get_user_role"("auth"."uid"()) = 'admin'::"public"."user_role")));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: profiles Users can view their own profile; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'Users can view their own profile'
      AND n.nspname = 'public'
      AND c.relname = 'profiles'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "Users can view their own profile" ON "public"."profiles" FOR SELECT TO "authenticated" USING (("auth"."uid"() = "id"));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: anon_credential_map; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."anon_credential_map" ENABLE ROW LEVEL SECURITY;

--
-- Name: plaza_comments; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."plaza_comments" ENABLE ROW LEVEL SECURITY;

--
-- Name: plaza_comments plaza_comments_delete_own; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'plaza_comments_delete_own'
      AND n.nspname = 'public'
      AND c.relname = 'plaza_comments'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "plaza_comments_delete_own" ON "public"."plaza_comments" FOR DELETE TO "authenticated" USING (("public"."plaza_is_admin"() OR ((NOT "is_demo") AND "public"."is_real_account"() AND ("user_id" = "auth"."uid"()))));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: plaza_comments plaza_comments_insert_own; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'plaza_comments_insert_own'
      AND n.nspname = 'public'
      AND c.relname = 'plaza_comments'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "plaza_comments_insert_own" ON "public"."plaza_comments" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_real_account"() AND ("user_id" = "auth"."uid"())));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: plaza_comments plaza_comments_select_all; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'plaza_comments_select_all'
      AND n.nspname = 'public'
      AND c.relname = 'plaza_comments'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "plaza_comments_select_all" ON "public"."plaza_comments" FOR SELECT TO "authenticated", "anon" USING (true);
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: plaza_likes; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."plaza_likes" ENABLE ROW LEVEL SECURITY;

--
-- Name: plaza_likes plaza_likes_delete_own; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'plaza_likes_delete_own'
      AND n.nspname = 'public'
      AND c.relname = 'plaza_likes'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "plaza_likes_delete_own" ON "public"."plaza_likes" FOR DELETE TO "authenticated" USING (("public"."is_real_account"() AND ("user_id" = "auth"."uid"())));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: plaza_likes plaza_likes_insert_own; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'plaza_likes_insert_own'
      AND n.nspname = 'public'
      AND c.relname = 'plaza_likes'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "plaza_likes_insert_own" ON "public"."plaza_likes" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_real_account"() AND ("user_id" = "auth"."uid"())));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: plaza_likes plaza_likes_select_all; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'plaza_likes_select_all'
      AND n.nspname = 'public'
      AND c.relname = 'plaza_likes'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "plaza_likes_select_all" ON "public"."plaza_likes" FOR SELECT TO "authenticated", "anon" USING (true);
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: plaza_posts; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."plaza_posts" ENABLE ROW LEVEL SECURITY;

--
-- Name: plaza_posts plaza_posts_delete_own; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'plaza_posts_delete_own'
      AND n.nspname = 'public'
      AND c.relname = 'plaza_posts'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "plaza_posts_delete_own" ON "public"."plaza_posts" FOR DELETE TO "authenticated" USING (("public"."plaza_is_admin"() OR ((NOT "is_demo") AND "public"."is_real_account"() AND ("author_id" = "auth"."uid"()))));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: plaza_posts plaza_posts_insert_own; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'plaza_posts_insert_own'
      AND n.nspname = 'public'
      AND c.relname = 'plaza_posts'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "plaza_posts_insert_own" ON "public"."plaza_posts" FOR INSERT TO "authenticated" WITH CHECK (("public"."is_real_account"() AND ("author_id" = "auth"."uid"())));
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: plaza_posts plaza_posts_select_all; Type: POLICY; Schema: public; Owner: -
--

DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'plaza_posts_select_all'
      AND n.nspname = 'public'
      AND c.relname = 'plaza_posts'
  ) THEN
    EXECUTE $pg_schema_sql$
CREATE POLICY "plaza_posts_select_all" ON "public"."plaza_posts" FOR SELECT TO "authenticated", "anon" USING (true);
$pg_schema_sql$;
  END IF;
END
$pg_schema_restore$;


--
-- Name: profiles; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;

--
-- Name: projects; Type: ROW SECURITY; Schema: public; Owner: -
--

ALTER TABLE "public"."projects" ENABLE ROW LEVEL SECURITY;

--
-- PostgreSQL database dump complete
--




-- ============================================================
-- SECTION: DIFF FILTER OBJECTS
-- ============================================================
-- Objects that match diff-filter.json but cannot be represented
-- precisely by pg_dump --filter.

-- auth.users trigger: on_auth_user_created
DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE NOT t.tgisinternal
      AND t.tgname = 'on_auth_user_created'
      AND n.nspname = 'auth'
      AND c.relname = 'users'
  ) THEN
    EXECUTE 'CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();';
  END IF;
END
$pg_schema_restore$;
-- policy: "Authenticated users can upload to media" on storage.objects
DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'Authenticated users can upload to media'
      AND n.nspname = 'storage'
      AND c.relname = 'objects'
  ) THEN
    EXECUTE 'CREATE POLICY "Authenticated users can upload to media" ON storage.objects AS PERMISSIVE FOR INSERT TO authenticated WITH CHECK (((bucket_id = ''media''::text) AND (owner = auth.uid())));';
  END IF;
END
$pg_schema_restore$;
-- policy: "Media bucket objects are publicly readable" on storage.objects
DO $pg_schema_restore$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE pol.polname = 'Media bucket objects are publicly readable'
      AND n.nspname = 'storage'
      AND c.relname = 'objects'
  ) THEN
    EXECUTE 'CREATE POLICY "Media bucket objects are publicly readable" ON storage.objects AS PERMISSIVE FOR SELECT TO PUBLIC USING ((bucket_id = ''media''::text));';
  END IF;
END
$pg_schema_restore$;

-- ============================================================
-- SECTION: STORAGE BUCKETS DATA
-- ============================================================

INSERT INTO "storage"."buckets" ("id", "name", "owner", "created_at", "updated_at", "public", "avif_autodetection", "file_size_limit", "allowed_mime_types", "owner_id", "type") VALUES ('media', 'media', NULL, '2026-10-10 11:13:20.128874+00', '2026-10-10 11:13:20.128874+00', 'true', 'false', NULL, NULL, NULL, 'STANDARD') ON CONFLICT ("id") DO UPDATE SET "name" = EXCLUDED."name", "owner" = EXCLUDED."owner", "created_at" = EXCLUDED."created_at", "updated_at" = EXCLUDED."updated_at", "public" = EXCLUDED."public", "avif_autodetection" = EXCLUDED."avif_autodetection", "file_size_limit" = EXCLUDED."file_size_limit", "allowed_mime_types" = EXCLUDED."allowed_mime_types", "owner_id" = EXCLUDED."owner_id", "type" = EXCLUDED."type";

-- ============================================================
-- SECTION: CRON JOBS
-- ============================================================
-- 用户自定义 pg_cron 任务。

