import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { compressImage, uploadImage } from '@/services/api';

/**
 * 待发送图片的统一状态：
 * - localUrl：选中即生成的 objectURL，先给用户看，不等上传
 * - status：uploading / ok / error，三处上传入口共用同一套语义
 * - error 时保留 file 与 localUrl，用户可单键重试，不静默清空
 */
export interface PendingImage {
  file: File;
  localUrl: string;
  status: 'uploading' | 'ok' | 'error';
  /** 上传成功后的持久 URL（仅 status === 'ok'） */
  url?: string;
  error?: string;
}

/**
 * 三处上传入口（策划起点 / 对话附件 / 场景区）共用的图片状态机。
 * - pick：校验 → 本地即时预览 → 自动压缩上传 → 成功/失败更新状态
 * - retry：用保留的 file 重新上传（不清文字、不清预览）
 * - busy：上传中（调用方必须禁用提交/发送）
 * - readyUrl：仅成功后可用，提交统一读它，杜绝闭包读到上传中的空串
 */
export function usePendingImage(bucket: string) {
  const [img, setImg] = useState<PendingImage | null>(null);
  /** 竞态序号：换图 / 移除后，旧请求的迟到写入全部作废 */
  const seqRef = useRef(0);
  const localUrlRef = useRef('');

  useEffect(
    () => () => {
      if (localUrlRef.current) URL.revokeObjectURL(localUrlRef.current);
    },
    []
  );

  const upload = useCallback(
    async (file: File, localUrl: string) => {
      const seq = ++seqRef.current;
      try {
        const processed = await compressImage(file, 1600);
        const url = await uploadImage(processed, bucket);
        if (seq !== seqRef.current) return;
        setImg((cur) => (cur && cur.localUrl === localUrl ? { ...cur, status: 'ok', url } : cur));
        toast.success(
          processed.size < file.size
            ? `照片已上传（自动压缩至 ${(processed.size / 1024 / 1024).toFixed(2)}MB）`
            : '照片已上传'
        );
      } catch (e) {
        if (seq !== seqRef.current) return;
        const msg = e instanceof Error ? e.message : '上传失败，请重试';
        setImg((cur) => (cur && cur.localUrl === localUrl ? { ...cur, status: 'error', error: msg } : cur));
        toast.error(msg);
      }
    },
    [bucket]
  );

  const pick = useCallback(
    async (file: File | undefined) => {
      if (!file) return;
      if (!file.type.startsWith('image/')) {
        toast.error('请选择图片文件');
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        toast.error('图片请控制在 10MB 以内');
        return;
      }
      seqRef.current += 1; // 使仍在途的旧上传作废
      const localUrl = URL.createObjectURL(file);
      if (localUrlRef.current) URL.revokeObjectURL(localUrlRef.current);
      localUrlRef.current = localUrl;
      setImg({ file, localUrl, status: 'uploading' });
      await upload(file, localUrl);
    },
    [upload]
  );

  const retry = useCallback(() => {
    if (!img || img.status !== 'error') return;
    setImg({ ...img, status: 'uploading' });
    void upload(img.file, img.localUrl);
  }, [img, upload]);

  const clear = useCallback(() => {
    seqRef.current += 1; // 丢弃在途结果
    if (localUrlRef.current) URL.revokeObjectURL(localUrlRef.current);
    localUrlRef.current = '';
    setImg(null);
  }, []);

  const busy = img?.status === 'uploading';
  const readyUrl = img?.status === 'ok' ? img.url : undefined;

  return { img, pick, retry, clear, busy, readyUrl };
}
