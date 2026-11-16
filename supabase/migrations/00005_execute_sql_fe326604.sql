DO $$
DECLARE
  uid uuid;
  pid uuid;
  cnt int;
BEGIN
  SELECT id INTO uid FROM profiles LIMIT 1;
  IF uid IS NULL THEN RAISE EXCEPTION 'no profile found'; END IF;
  INSERT INTO plaza_posts (author_id, title, content, images) VALUES (uid, '验证用动态-已清理', '触发器与级联验证', '{}') RETURNING id INTO pid;

  -- 点赞 → 计数 +1
  INSERT INTO plaza_likes (post_id, user_id) VALUES (pid, uid);
  SELECT like_count INTO cnt FROM plaza_posts WHERE id = pid;
  IF cnt <> 1 THEN RAISE EXCEPTION 'like_count expected 1, got %', cnt; END IF;

  -- 重复点赞必须被主键拒绝
  BEGIN
    INSERT INTO plaza_likes (post_id, user_id) VALUES (pid, uid);
    RAISE EXCEPTION 'duplicate like should be rejected';
  EXCEPTION WHEN unique_violation THEN NULL; END;

  -- 取消点赞 → 计数归零
  DELETE FROM plaza_likes WHERE post_id = pid AND user_id = uid;
  SELECT like_count INTO cnt FROM plaza_posts WHERE id = pid;
  IF cnt <> 0 THEN RAISE EXCEPTION 'like_count expected 0, got %', cnt; END IF;

  -- 评论 → 计数 +1
  INSERT INTO plaza_comments (post_id, user_id, content) VALUES (pid, uid, '验证评论-已清理');
  SELECT comment_count INTO cnt FROM plaza_posts WHERE id = pid;
  IF cnt <> 1 THEN RAISE EXCEPTION 'comment_count expected 1, got %', cnt; END IF;

  -- 删动态 → 点赞与评论级联清除
  INSERT INTO plaza_likes (post_id, user_id) VALUES (pid, uid);
  DELETE FROM plaza_posts WHERE id = pid;
  SELECT count(*) INTO cnt FROM plaza_likes WHERE post_id = pid;
  IF cnt <> 0 THEN RAISE EXCEPTION 'likes should cascade'; END IF;
  SELECT count(*) INTO cnt FROM plaza_comments WHERE post_id = pid;
  IF cnt <> 0 THEN RAISE EXCEPTION 'comments should cascade'; END IF;

  RAISE NOTICE 'ALL CHECKS PASSED';
END $$;