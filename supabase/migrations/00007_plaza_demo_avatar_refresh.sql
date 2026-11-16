-- 演示作者头像接入：微信风格头像精选（15 人）。仅更新演示作者(is_demo)头像快照，稳定作者ID绑定，幂等可重复执行。
-- 昵称 → 头像文件（/images/plaza-avatars/ 下项目资源，不依赖热链）

CREATE OR REPLACE FUNCTION pg_temp.nick_to_avatar() RETURNS TABLE(nickname text, avatar text) AS $$
VALUES
  ('一颗松子',     '/images/plaza-avatars/01-67580-01.jpg'),
  ('周五不加班',   '/images/plaza-avatars/02-67570-01.jpg'),
  ('橘子汽水',     '/images/plaza-avatars/03-67463-07.jpg'),
  ('阿木同学',     '/images/plaza-avatars/04-67582-05.jpg'),
  ('巷口的月亮',   '/images/plaza-avatars/05-67463-09.jpg'),
  ('小林慢慢来',   '/images/plaza-avatars/06-67582-10.jpg'),
  ('阿北',         '/images/plaza-avatars/07-67570-09.jpg'),
  ('懒得起昵称',   '/images/plaza-avatars/08-67582-04.jpg'),
  ('晚风有信',     '/images/plaza-avatars/09-67580-03.jpg'),
  ('夏天还没结束', '/images/plaza-avatars/10-67463-02.jpg'),
  ('小陈同学',     '/images/plaza-avatars/11-67570-05.jpg'),
  ('茶还没凉',     '/images/plaza-avatars/12-67580-09.jpg'),
  ('山间有风',     '/images/plaza-avatars/13-67570-07.jpg'),
  ('收纳进行时',   '/images/plaza-avatars/14-67463-03.jpg'),
  ('邻居小吴',     '/images/plaza-avatars/15-67582-08.jpg');
$$ LANGUAGE sql;

-- 更新演示帖子的作者头像快照（仅 is_demo，绑稳定 author_id，nickname 匹配映射）
UPDATE plaza_posts p
SET author_avatar_url = m.avatar
FROM pg_temp.nick_to_avatar() m
WHERE p.is_demo = true AND p.author_nickname = m.nickname;

-- 更新演示评论的作者头像快照（评论作者列是 user_id，nickname 匹配映射）
UPDATE plaza_comments c
SET author_avatar_url = m.avatar
FROM pg_temp.nick_to_avatar() m
WHERE c.is_demo = true AND c.author_nickname = m.nickname;
