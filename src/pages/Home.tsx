import ScrollShowcase from '@/components/home/ScrollShowcase';

/** 首页：滚动舞台演示（页脚署名并入末幕收尾画面，与主内容同屏呈现，无需额外下拉） */
export default function Home() {
  return (
    <div className="w-full">
      <ScrollShowcase />
    </div>
  );
}
