from __future__ import annotations

import uuid

from fastapi import HTTPException, status
from sqlalchemy import asc, desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.plaza import PlazaComment, PlazaLike, PlazaPost
from app.models.profile import Profile
from app.schemas.plaza import (
    PlazaCommentCreateIn,
    PlazaCommentOut,
    PlazaLikeOut,
    PlazaPostCreateIn,
    PlazaPostDetailOut,
    PlazaPostOut,
)
from app.storage.s3 import delete_by_urls


def _to_post_out(post: PlazaPost, liked: bool) -> PlazaPostOut:
    return PlazaPostOut(
        id=post.id,
        author_id=post.author_id,
        title=post.title,
        content=post.content,
        img_list=list(post.img_list or []),
        author_nickname=post.author_nickname,
        author_avatar_url=post.author_avatar_url,
        like_count=post.like_count,
        liked_by_me=liked,
        create_time=post.create_time,
        update_time=post.update_time,
    )


async def list_posts(db: AsyncSession, user: Profile | None, limit: int = 24, offset: int = 0) -> list[PlazaPostOut]:
    """按发布时间倒序获取活动广场动态"""
    result = await db.execute(select(PlazaPost).order_by(desc(PlazaPost.create_time)).limit(limit).offset(offset))
    posts = list(result.scalars().all())
    if not posts or not user:
        return [_to_post_out(p, False) for p in posts]

    post_ids = [p.id for p in posts]
    like_res = await db.execute(
        select(PlazaLike.post_id).where(PlazaLike.user_id == user.id, PlazaLike.post_id.in_(post_ids))
    )
    liked_set = set(like_res.scalars().all())
    return [_to_post_out(p, p.id in liked_set) for p in posts]


async def get_post_detail(db: AsyncSession, user: Profile | None, post_id: uuid.UUID) -> PlazaPostDetailOut:
    """获取动态详情与按时间正序排列的评论列表"""
    post_res = await db.execute(select(PlazaPost).where(PlazaPost.id == post_id))
    post = post_res.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="动态不存在")

    liked = False
    if user:
        like_res = await db.execute(
            select(PlazaLike.post_id).where(PlazaLike.post_id == post_id, PlazaLike.user_id == user.id)
        )
        liked = like_res.scalar_one_or_none() is not None

    comments_res = await db.execute(
        select(PlazaComment).where(PlazaComment.post_id == post_id).order_by(asc(PlazaComment.create_time))
    )
    comment_list = [PlazaCommentOut.model_validate(c) for c in comments_res.scalars().all()]

    base = _to_post_out(post, liked)
    return PlazaPostDetailOut(**base.model_dump(), comment_list=comment_list)


async def create_post(db: AsyncSession, user: Profile, body: PlazaPostCreateIn) -> PlazaPostOut:
    """发布活动广场动态（冗余保存发布者昵称与头像快照）"""
    post = PlazaPost(
        author_id=user.id,
        title=body.title.strip(),
        content=body.content.strip(),
        img_list=body.img_list,
        author_nickname=user.nickname,
        author_avatar_url=user.avatar_url,
        like_count=0,
    )
    db.add(post)
    await db.commit()
    await db.refresh(post)
    return _to_post_out(post, False)


async def delete_post(db: AsyncSession, user: Profile, post_id: uuid.UUID) -> None:
    """删除本人动态并清理关联存储图片"""
    post_res = await db.execute(select(PlazaPost).where(PlazaPost.id == post_id))
    post = post_res.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="动态不存在")
    if post.author_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="仅作者本人可删除动态")

    imgs = list(post.img_list or [])
    await db.delete(post)
    await db.commit()
    if imgs:
        await delete_by_urls(imgs)


async def toggle_like(db: AsyncSession, user: Profile, post_id: uuid.UUID) -> PlazaLikeOut:
    """切换点赞状态"""
    post_res = await db.execute(select(PlazaPost).where(PlazaPost.id == post_id))
    post = post_res.scalar_one_or_none()
    if not post:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="动态不存在")

    like_res = await db.execute(select(PlazaLike).where(PlazaLike.post_id == post_id, PlazaLike.user_id == user.id))
    existing = like_res.scalar_one_or_none()
    if existing:
        await db.delete(existing)
        post.like_count = max(0, post.like_count - 1)
        liked = False
    else:
        db.add(PlazaLike(post_id=post_id, user_id=user.id))
        post.like_count += 1
        liked = True

    await db.commit()
    return PlazaLikeOut(liked=liked, like_count=post.like_count)


async def create_comment(
    db: AsyncSession, user: Profile, post_id: uuid.UUID, body: PlazaCommentCreateIn
) -> PlazaCommentOut:
    """发表单级文字评论"""
    post_res = await db.execute(select(PlazaPost.id).where(PlazaPost.id == post_id))
    if post_res.scalar_one_or_none() is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="动态不存在")

    comment = PlazaComment(
        post_id=post_id,
        author_id=user.id,
        author_nickname=user.nickname,
        author_avatar_url=user.avatar_url,
        content=body.content.strip(),
    )
    db.add(comment)
    await db.commit()
    await db.refresh(comment)
    return PlazaCommentOut.model_validate(comment)


async def delete_comment(db: AsyncSession, user: Profile, comment_id: uuid.UUID) -> None:
    """删除本人评论"""
    comment_res = await db.execute(select(PlazaComment).where(PlazaComment.id == comment_id))
    comment = comment_res.scalar_one_or_none()
    if not comment:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="评论不存在")
    if comment.author_id != user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="仅作者本人可删除评论")

    await db.delete(comment)
    await db.commit()
