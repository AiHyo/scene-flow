import { useEffect, useState } from 'react';

/**
 * 检测是否有模态层打开（登录 / 图片大图 / 发布等 Dialog、AlertDialog、Sheet）。
 * Radix 打开时会给相应元素挂 data-state="open"，据此判断；有任一打开即返回 true。
 */
export function useModalOpen(): boolean {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const check = () => {
      const anyOpen = !!document.querySelector(
        '[role="dialog"][data-state="open"], [data-radix-popper-content-wrapper][data-state="open"]'
      );
      setOpen(anyOpen);
    };
    check();
    // Radix 打开/关闭会改动 DOM 属性，MutationObserver 监听属性与子树变化即可稳定捕获
    const mo = new MutationObserver(check);
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-state'] });
    return () => mo.disconnect();
  }, []);

  return open;
}
