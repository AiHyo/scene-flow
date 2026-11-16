import { useState } from 'react';
import { CalendarClock, ExternalLink, MapPin, Search, ShoppingBag, Star, Wrench } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getVenueMatches } from '@/data/resources';
import type { MaterialResource, ResourceLink } from '@/data/resources';

function LinkButtons({ links }: { links: ResourceLink[] }) {
  return (
    <div className="flex flex-wrap gap-2">
      {links.map((l) => (
        <a
          key={l.url}
          href={l.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
        >
          {l.label}
          <ExternalLink className="h-3 w-3" />
        </a>
      ))}
    </div>
  );
}

/** 物料推荐卡：名称 / 对应物品图 / 用途 / 规格 / 替代方式 / 平台入口（真实外链） */
export function MaterialCard({ r, compact = false }: { r: MaterialResource; compact?: boolean }) {
  return (
    <div className={compact ? 'rounded-xl border bg-background p-3' : 'rounded-xl border bg-background p-4'}>
      <div className="flex items-start gap-3">
        {r.image && (
          <div className="w-20 shrink-0 overflow-hidden rounded-lg md:w-24">
            <img src={r.image} alt={`${r.name}参考图`} loading="lazy" className="aspect-square w-full object-cover" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <div className="mb-1 flex flex-wrap items-center justify-between gap-1.5">
            <span className="text-sm font-semibold">{r.name}</span>
            <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{r.platform}</span>
          </div>
          {r.rating != null && (
            <p className="mb-1.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="flex items-center gap-1 font-medium text-amber-600 dark:text-amber-400">
                <Star className="h-3.5 w-3.5 fill-current" aria-hidden />
                {r.rating.toFixed(1)}
              </span>
              <span>{r.reviews != null ? `${r.reviews.toLocaleString('zh-CN')} 条评价` : ''}</span>
              {r.servedCount != null && <span>已服务 {r.servedCount.toLocaleString('zh-CN')}+ 场活动</span>}
            </p>
          )}
          <p className="text-xs leading-relaxed text-muted-foreground">
            <ShoppingBag className="mr-1 inline h-3 w-3 align-[-1px]" />
            {r.usage}
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">规格：{r.spec}</p>
          {!compact && (
            <>
              {r.alternatives && (
                <p className="mt-1.5 rounded-lg bg-muted/60 px-2 py-1.5 text-xs leading-relaxed text-muted-foreground">
                  <Wrench className="mr-1 inline h-3 w-3 align-[-1px]" />
                  替代方式：{r.alternatives}
                </p>
              )}
              {r.deliveryNote && (
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground/90">
                  <CalendarClock className="mr-1 inline h-3 w-3 align-[-1px]" />
                  {r.deliveryNote}
                </p>
              )}
            </>
          )}
        </div>
      </div>
      <div className="mt-2.5">
        <LinkButtons links={r.links} />
      </div>
    </div>
  );
}

/**
 * 场地推荐区：城市未知先给通用选址建议与平台入口；
 * 可补城市查看具体入口（当前配置了杭州演示入口），不强制定位、不随机推荐其他城市。
 */
export function VenueSection({ city: cityProp }: { city?: string }) {
  const [cityInput, setCityInput] = useState(cityProp ?? '');
  const [city, setCity] = useState<string | undefined>(cityProp);
  const { venues, tips, entries } = getVenueMatches(city);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={cityInput}
          onChange={(e) => setCityInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') setCity(cityInput.trim() || undefined);
          }}
          placeholder="输入城市（如：杭州）查看场地入口"
          className="h-8 w-48 text-xs"
        />
        <Button size="sm" className="h-8 text-xs" onClick={() => setCity(cityInput.trim() || undefined)}>
          <Search className="h-3 w-3" />
          查看
        </Button>
        {city && (
          <button
            type="button"
            onClick={() => {
              setCity(undefined);
              setCityInput('');
            }}
            className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          >
            清除城市
          </button>
        )}
      </div>
      <ul className="ml-4 list-disc space-y-1 text-xs leading-relaxed text-muted-foreground">
        {tips.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      {venues.map((v) => (
        <div key={v.id} className="rounded-xl border bg-background p-4">
          <div className="mb-1 flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-semibold">{v.title}</span>
          </div>
          <p className="text-xs leading-relaxed text-muted-foreground">类型：{v.venueType}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">容量：{v.capacity}（来源：{v.capacitySource}）</p>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">用途：{v.usage}</p>
          <div className="mt-2.5">
            <LinkButtons links={v.links} />
          </div>
        </div>
      ))}
      {entries.length > 0 && (
        <div className="rounded-xl border bg-background p-4">
          <p className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
            <MapPin className="h-3.5 w-3.5 text-primary" />
            场地平台入口
          </p>
          <p className="mb-2 text-xs text-muted-foreground">进入平台后选择你的城市，按人数与预算筛选场地</p>
          <LinkButtons links={entries} />
        </div>
      )}
    </div>
  );
}
