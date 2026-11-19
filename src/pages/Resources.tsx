import { useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Check, Copy, ExternalLink, Handshake, Mail, MapPin, Package, RotateCcw, Search, Send, Sparkles, Star, X } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import ReturnBar from '@/components/shared/ReturnBar';
import { usePageEntrance } from '@/hooks/usePageEntrance';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { LOCAL_GENERIC_ENTRIES, LOCAL_MERCHANTS_ONLY, PARTNER_CATALOG, amapSearchUrl, type PartnerResource } from '@/data/partnerCatalog';
import { cn } from '@/lib/utils';

/** 合作申请联系邮箱（示意邮箱；页面不代替发送，发送在邮件应用完成） */
const PARTNER_EMAIL = 'partners@sceneflow.example';

const SERVICE_TYPES = [
  '线上物料/道具',
  '场地经营方',
  '桌椅/设备租赁',
  '摄影摄像',
  '活动布置服务',
  '餐饮服务',
  '其他活动服务',
];

/** 省市二级选择数据：覆盖全国 34 个省级行政区（4 直辖市、23 省、5 自治区、2 特别行政区）及主要城市 */
const PROVINCE_CITIES: Record<string, string[]> = {
  北京市: ['北京市'],
  上海市: ['上海市'],
  天津市: ['天津市'],
  重庆市: ['重庆市'],
  河北省: ['石家庄市', '唐山市', '保定市', '廊坊市', '秦皇岛市', '邯郸市'],
  山西省: ['太原市', '大同市', '运城市', '长治市', '晋城市'],
  辽宁省: ['沈阳市', '大连市', '鞍山市', '锦州市', '营口市'],
  吉林省: ['长春市', '吉林市', '延边朝鲜族自治州', '四平市'],
  黑龙江省: ['哈尔滨市', '大庆市', '齐齐哈尔市', '牡丹江市'],
  江苏省: ['南京市', '苏州市', '无锡市', '常州市', '南通市', '徐州市', '扬州市', '镇江市'],
  浙江省: ['杭州市', '宁波市', '温州市', '嘉兴市', '湖州市', '绍兴市', '金华市', '台州市'],
  安徽省: ['合肥市', '芜湖市', '蚌埠市', '黄山市', '马鞍山市', '安庆市'],
  福建省: ['福州市', '厦门市', '泉州市', '漳州市', '莆田市', '龙岩市'],
  江西省: ['南昌市', '九江市', '赣州市', '景德镇市', '宜春市', '上饶市'],
  山东省: ['济南市', '青岛市', '烟台市', '潍坊市', '威海市', '临沂市', '淄博市'],
  河南省: ['郑州市', '洛阳市', '开封市', '南阳市', '新乡市', '许昌市'],
  湖北省: ['武汉市', '宜昌市', '襄阳市', '荆州市', '黄冈市', '十堰市'],
  湖南省: ['长沙市', '株洲市', '湘潭市', '衡阳市', '岳阳市', '常德市', '张家界市'],
  广东省: ['广州市', '深圳市', '佛山市', '东莞市', '珠海市', '中山市', '惠州市', '江门市', '汕头市'],
  海南省: ['海口市', '三亚市', '三沙市', '儋州市'],
  四川省: ['成都市', '绵阳市', '德阳市', '宜宾市', '南充市', '泸州市', '乐山市'],
  贵州省: ['贵阳市', '遵义市', '六盘水市', '安顺市', '铜仁市'],
  云南省: ['昆明市', '大理白族自治州', '丽江市', '曲靖市', '玉溪市', '西双版纳傣族自治州'],
  陕西省: ['西安市', '咸阳市', '宝鸡市', '延安市', '榆林市', '汉中市'],
  甘肃省: ['兰州市', '酒泉市', '天水市', '张掖市', '嘉峪关市'],
  青海省: ['西宁市', '海东市', '海北藏族自治州'],
  台湾省: ['台北市', '新北市', '台中市', '高雄市', '台南市'],
  内蒙古自治区: ['呼和浩特市', '包头市', '鄂尔多斯市', '赤峰市', '呼伦贝尔市'],
  广西壮族自治区: ['南宁市', '桂林市', '柳州市', '北海市', '玉林市'],
  西藏自治区: ['拉萨市', '日喀则市', '林芝市', '昌都市'],
  宁夏回族自治区: ['银川市', '石嘴山市', '吴忠市', '固原市'],
  新疆维吾尔自治区: ['乌鲁木齐市', '喀什地区', '伊犁哈萨克自治州', '克拉玛依市', '昌吉回族自治州'],
  中国香港特别行政区: ['中国香港'],
  中国澳门特别行政区: ['中国澳门'],
};

/** 区县级（可选第三级）：重点城市列出常见区县，未列城市按全市查找，不虚构每区都有商家 */
const CITY_DISTRICTS: Record<string, string[]> = {
  北京市: ['朝阳区', '海淀区', '东城区', '西城区', '丰台区', '昌平区', '大兴区'],
  上海市: ['浦东新区', '徐汇区', '静安区', '黄浦区', '闵行区', '长宁区', '杨浦区'],
  广州市: ['天河区', '越秀区', '海珠区', '番禺区', '白云区', '黄埔区'],
  深圳市: ['南山区', '福田区', '罗湖区', '宝安区', '龙岗区', '龙华区'],
  杭州市: ['西湖区', '上城区', '滨江区', '余杭区', '拱墅区', '萧山区'],
  南京市: ['玄武区', '鼓楼区', '建邺区', '江宁区', '栖霞区', '雨花台区'],
  成都市: ['锦江区', '青羊区', '武侯区', '高新区', '成华区', '金牛区'],
  武汉市: ['江汉区', '武昌区', '洪山区', '江岸区', '汉阳区'],
  长沙市: ['芙蓉区', '天心区', '岳麓区', '开福区', '雨花区'],
  西安市: ['碑林区', '雁塔区', '未央区', '莲湖区', '新城区', '长安区'],
  重庆市: ['渝中区', '江北区', '渝北区', '南岸区', '沙坪坝区', '九龙坡区'],
  天津市: ['和平区', '河西区', '南开区', '河东区', '河北区', '滨海新区'],
  苏州市: ['姑苏区', '工业园区', '高新区', '吴中区', '相城区'],
  郑州市: ['金水区', '二七区', '中原区', '管城回族区', '郑东新区'],
};

interface CitySel {
  province: string | null;
  city: string | null;
  /** 区县级（可选）：仅主要城市可选；空 = 按全市查找 */
  district: string | null;
}

export default function Resources() {
  const pageRef = useRef<HTMLDivElement>(null);
  usePageEntrance(pageRef);
  const [params, setParams] = useSearchParams();
  /* 旧链接兼容：materials→online、venues→local；tab 参数本身即类别（local/online 均有效） */
  const rawTab = params.get('tab') ?? 'online';
  const tab = rawTab === 'materials' ? 'online' : rawTab === 'venues' || rawTab === 'local' ? 'local' : 'online';

  /* 地区筛选选择状态（待确认选择） */
  const [citySel, setCitySel] = useState<CitySel>({ province: null, city: null, district: null });
  /* 实际应用的地区筛选（点击搜索按钮后生效） */
  const [appliedCitySel, setAppliedCitySel] = useState<CitySel>({ province: null, city: null, district: null });
  /* 搜索关键字（可选本地服务搜索） */
  const [localSearchKeyword, setLocalSearchKeyword] = useState('');
  const [appliedKeyword, setAppliedKeyword] = useState('');
  const [localTypeFilter, setLocalTypeFilter] = useState<string>('all');
  const [localLimit, setLocalLimit] = useState(8);

  /* 申请合作弹窗 */
  const [applyOpen, setApplyOpen] = useState(false);
  const [brand, setBrand] = useState('');
  const [serviceType, setServiceType] = useState('');
  const [contact, setContact] = useState('');
  const [city, setCity] = useState('');
  const [intro, setIntro] = useState('');
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);

  const applicationText = useMemo(() => {
    const lines = [
      '【SceneFlow AI 合作申请】',
      `品牌/商家名称：${brand.trim()}`,
      `服务类别：${serviceType}`,
      `联系方式：${contact.trim()}`,
      `服务城市：${city.trim() || '未填写'}`,
      `业务介绍：${intro.trim() || '未填写'}`,
      `官网/商品链接：${link.trim() || '未填写'}`,
      '—— 来自 SceneFlow AI 合作伙伴页面',
    ];
    return lines.join('\n');
  }, [brand, serviceType, contact, city, intro, link]);

  const canSubmit = brand.trim() !== '' && serviceType !== '' && contact.trim() !== '';

  const copyText = async () => {
    try {
      await navigator.clipboard.writeText(applicationText);
      setCopied(true);
      toast.success('申请内容已复制，可粘贴到邮件或任意聊天工具');
      setTimeout(() => setCopied(false), 2500);
    } catch {
      toast.error('复制失败，请手动选择预览文本复制');
    }
  };

  /** 打开邮件草稿：不声称已投递，发送动作由用户在邮件应用中完成 */
  const openMailDraft = () => {
    const subject = `SceneFlow AI 合作申请 - ${brand.trim()}`;
    window.location.href = `mailto:${PARTNER_EMAIL}?subject=${encodeURIComponent(
      subject
    )}&body=${encodeURIComponent(applicationText)}`;
    toast.info('已在邮件应用打开草稿，请检查内容后在邮件应用中发送');
  };

  const applyRegionSearch = () => {
    setAppliedCitySel({ ...citySel });
    setAppliedKeyword(localSearchKeyword.trim());
    const regionName = [citySel.province, citySel.city, citySel.district].filter(Boolean).join(' · ');
    if (regionName) {
      toast.success(`已应用地区筛选：${regionName}`);
    } else {
      toast.info('已恢复为全国服务范围');
    }
  };

  const resetRegionSearch = () => {
    setCitySel({ province: null, city: null, district: null });
    setAppliedCitySel({ province: null, city: null, district: null });
    setLocalSearchKeyword('');
    setAppliedKeyword('');
    toast.info('已重置为全国服务范围');
  };

  const onlineFeatured = PARTNER_CATALOG.filter((r) => r.category === 'online' && r.featured);
  const onlineNormal = PARTNER_CATALOG.filter((r) => r.category === 'online' && !r.featured);
  /* ===== 地区筛选真实联动（修正：省/市/区三级各自生效，直辖市=省级即匹配） =====
   * - 选省份（含直辖市）：只显示该省商家；未选市时不限定城市（全省数据都在）
   * - 选城市：限定该市商家；区级仅影响文案与地图链接（商家数据无区字段，不假称精确定位）
   * - 具名商家为主列表；泛类别条目独立置底区，不计入商家数 */
  const ap = appliedCitySel;
  const namedAll = LOCAL_MERCHANTS_ONLY;
  /* 城市名归一化：目录用「北京」，选择器用「北京市」——去后缀后比较，直辖市/普通市均正确匹配 */
  const normCity = (s?: string | null) => (s ? s.replace(/(市|特别行政区|自治州|地区)$/, '') : '');
  const namedResources = ap.province
    ? namedAll.filter(
        (r) =>
          r.province === ap.province &&
          (!ap.city || normCity(r.city) === normCity(ap.city))
      )
    : namedAll;
  const localResources = namedResources.filter((r) => {
    const kwOk = !appliedKeyword
      || r.name.toLowerCase().includes(appliedKeyword.toLowerCase())
      || r.use.toLowerCase().includes(appliedKeyword.toLowerCase())
      || r.scenes.toLowerCase().includes(appliedKeyword.toLowerCase());
    if (!kwOk) return false;
    if (localTypeFilter === 'all') return true;
    const text = `${r.name} ${r.use} ${r.scenes}`;
    return text.includes(localTypeFilter);
  });
  const visibleLocalResources = localResources.slice(0, localLimit);
  /* 泛类别地图搜索：链接携带实际所选地区（省+市+区拼接），按钮名与目的相符 */
  const appliedRegionForSearch = [ap.city ?? ap.province, ap.district].filter(Boolean).join('') || null;

  const activeRegionText = [appliedCitySel.province, appliedCitySel.city, appliedCitySel.district]
    .filter(Boolean)
    .join(' · ');

  return (
    <div ref={pageRef} className="sf-page-body mx-auto w-full max-w-6xl px-4 py-8 md:px-6 md:py-12">
      <ReturnBar />
      <div className="sf-deco" aria-hidden="true">
        <span className="sf-blob sf-paper-purple" style={{ top: '-8%', left: '-16%', width: '30vw', height: '30vw', minWidth: 240, minHeight: 240 }} />
        <span className="sf-blob sf-paper-cream" style={{ top: '6%', right: '-14%', width: '25vw', height: '25vw', minWidth: 200, minHeight: 200 }} />
      </div>

      <div className="sf-reveal-hero mb-7 flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="sf-pill-mint inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-0.5 text-xs font-bold">
            <Handshake className="h-3.5 w-3.5" />
            供应链与本地服务
          </span>
          <h1 className="font-display text-3xl font-black tracking-tight md:text-4xl">
            合作伙伴<span className="text-primary">。</span>
          </h1>
          <p className="text-sm text-muted-foreground md:text-base">
            按需要查找线上好物与本地场所服务；提供活动相关服务的商家也欢迎申请合作。
          </p>
        </div>
        <Button size="sm" className="sf-pill-cobalt h-10 rounded-full border-0 px-5 font-semibold hover:opacity-95" onClick={() => setApplyOpen(true)}>
          <Handshake className="h-4 w-4" />
          申请合作
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setParams(v === 'online' ? {} : { tab: v })}>
        <TabsList className="mb-6 h-11 rounded-full bg-card/90 p-1 shadow-sm ring-1 ring-border/70">
          <TabsTrigger value="online" className="rounded-full px-5 font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <Package className="h-4 w-4" />
            线上好物与服务
          </TabsTrigger>
          <TabsTrigger value="local" className="rounded-full px-5 font-medium data-[state=active]:bg-primary data-[state=active]:text-primary-foreground">
            <MapPin className="h-4 w-4" />
            本地场所与服务
          </TabsTrigger>
        </TabsList>

        <TabsContent value="online" className="mt-0">
          {/* SceneFlow 优选：固定置顶 3 项，桌面三列 / 窄屏自然换行 */}
          <div className="mb-3 flex items-center gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/70 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-400">
              <Sparkles className="h-3.5 w-3.5" />
              SceneFlow 优选
            </span>
            <span className="text-xs text-muted-foreground">价格与库存以平台页面实时为准</span>
          </div>
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
            {onlineFeatured.map((r) => (
              <GoodsCard key={r.id} r={r} />
            ))}
          </div>

          {/* 普通条目：等高双列网格，确保图文对齐 */}
          <div className="mt-6 grid gap-4 md:grid-cols-2">
            {onlineNormal.map((r) => (
              <GoodsCard key={r.id} r={r} />
            ))}
          </div>
        </TabsContent>

        <TabsContent value="local" className="mt-0">
          <div className="mb-4 rounded-xl border bg-card p-3 shadow-sm md:p-4">
            <div className="flex flex-wrap items-center gap-2.5">
              <span className="flex items-center gap-1 text-sm font-medium text-foreground">
                <MapPin className="h-4 w-4 text-primary" />
                选择地区
              </span>
              <Select
                value={citySel.province ?? 'all'}
                onValueChange={(v) => {
                  const province = v === 'all' ? null : v;
                  setCitySel({ province, city: null, district: null });
                }}
              >
                <SelectTrigger className="h-9 w-36">
                  <SelectValue placeholder="全国" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="all">全国</SelectItem>
                  {Object.keys(PROVINCE_CITIES).map((p) => (
                    <SelectItem key={p} value={p}>
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {citySel.province && PROVINCE_CITIES[citySel.province] && (
                <Select
                  value={citySel.city ?? 'all'}
                  onValueChange={(v) => setCitySel((s) => ({ ...s, city: v === 'all' ? null : v, district: null }))}
                >
                  <SelectTrigger className="h-9 w-32">
                    <SelectValue placeholder="全省" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value="all">全省/全市</SelectItem>
                    {PROVINCE_CITIES[citySel.province].map((c) => (
                      <SelectItem key={c} value={c}>
                        {c}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {/* 区县级（可选）：重点城市可选；未列区县 = 按全市查找 */}
              {citySel.city && CITY_DISTRICTS[citySel.city] && (
                <Select
                  value={citySel.district ?? 'all'}
                  onValueChange={(v) => setCitySel((s) => ({ ...s, district: v === 'all' ? null : v }))}
                >
                  <SelectTrigger className="h-9 w-32">
                    <SelectValue placeholder="全市" />
                  </SelectTrigger>
                  <SelectContent className="max-h-72">
                    <SelectItem value="all">全区/县</SelectItem>
                    {CITY_DISTRICTS[citySel.city].map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <div className="relative min-w-36 flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  value={localSearchKeyword}
                  onChange={(e) => setLocalSearchKeyword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') applyRegionSearch();
                  }}
                  placeholder="搜索场地类型/服务..."
                  className="h-9 pl-8 text-xs"
                />
              </div>
              <Button onClick={applyRegionSearch} className="h-9 gap-1.5 text-xs">
                <Search className="h-3.5 w-3.5" />
                搜索并应用地区
              </Button>
              {(citySel.province || citySel.city || appliedCitySel.province || appliedCitySel.city || localSearchKeyword) && (
                <Button variant="ghost" size="sm" className="h-9 gap-1 text-xs" onClick={resetRegionSearch}>
                  <RotateCcw className="h-3.5 w-3.5" />
                  重置
                </Button>
              )}
            </div>
            {activeRegionText && (
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg bg-primary/10 px-3 py-1.5 text-xs text-primary">
                <span>
                  当前已应用地区：<strong>{activeRegionText}</strong>
                  {appliedKeyword && ` · 关键字：「${appliedKeyword}」`}（共收录具名商家 {localResources.length} 家）
                </span>
                {/* 区级选择如实说明：商家数据按市级收录，区县用于地图搜索定位 */}
                {appliedCitySel.district && (
                  <span className="text-[11px] text-muted-foreground">商家按城市收录，所选区县将用于地图搜索定位</span>
                )}
              </div>
            )}
          </div>
          <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted-foreground">
              按地区、类别与关键词筛选具名合作商家；页面底部可按类别地图搜索。
            </p>
            <div className="flex flex-wrap gap-1.5">
              {[
                { id: 'all', label: '全部类别' },
                { id: '场地', label: '场地' },
                { id: '布置', label: '布置' },
                { id: '餐饮', label: '餐饮/茶歇' },
                { id: '摄影', label: '摄影摄像' },
                { id: '租赁', label: '设备租赁' },
              ].map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setLocalTypeFilter(t.id);
                    setLocalLimit(8);
                  }}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                    localTypeFilter === t.id
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'bg-card text-muted-foreground hover:border-primary/40 hover:text-foreground'
                  )}
                >
                  {t.label}
                </button>
              ))}
            </div>
          </div>
          {localResources.length === 0 ? (
            /* 无匹配：如实空结果 + 扩大范围入口，不编造条目 */
            <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed py-12 text-muted-foreground">
              <MapPin className="h-8 w-8" />
              <p className="text-sm">
                {activeRegionText ? `${activeRegionText} 暂无收录的具名商家` : '没有匹配的具名商家'}
                {appliedKeyword ? `（关键字「${appliedKeyword}」）` : ''}
              </p>
              <div className="flex flex-wrap justify-center gap-2">
                {appliedCitySel.city && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      /* 扩大范围：清城市与区县回到全省（商家按城市收录） */
                      setCitySel((s) => ({ ...s, city: null, district: null }));
                      setAppliedCitySel((s) => ({ ...s, city: null, district: null }));
                      toast.info('已扩大到全省范围');
                    }}
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    扩大到全省
                  </Button>
                )}
                {(appliedCitySel.province || appliedCitySel.city || appliedKeyword) && (
                  <Button variant="ghost" size="sm" onClick={resetRegionSearch}>
                    查看全国
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <>
              <div className="grid gap-4 md:grid-cols-2">
                {visibleLocalResources.map((r) => (
                  <GoodsCard key={r.id} r={r} activeRegion={activeRegionText || undefined} />
                ))}
              </div>
              {localResources.length > visibleLocalResources.length && (
                <div className="mt-6 flex justify-center">
                  <Button variant="outline" onClick={() => setLocalLimit((n) => n + 8)}>
                    查看更多商家（还有 {localResources.length - visibleLocalResources.length} 家）
                  </Button>
                </div>
              )}
            </>
          )}

          {/* ===== 更多场所与服务搜索：泛类别紧凑入口（仅地图搜索，不展示评分评价，不计入商家数） ===== */}
          <div className="mt-8 rounded-xl border bg-card p-4 shadow-sm">
            <div className="mb-1.5 flex items-center gap-2">
              <Search className="h-4 w-4 text-primary" />
              <h3 className="text-sm font-semibold">搜索附近同类</h3>
            </div>
            <p className="mb-3 text-xs text-muted-foreground">
              以下为按类别查找附近同类服务的入口（非具体商家资料）
              {appliedRegionForSearch ? `，已带上「${appliedRegionForSearch}」定位` : '；可在上方选择地区后带上定位'}
              ，结果以地图实时展示为准。
            </p>
            <div className="flex flex-wrap gap-2">
              {LOCAL_GENERIC_ENTRIES.map((g) => (
                <a
                  key={g.id}
                  href={amapSearchUrl(g.name, appliedRegionForSearch)}
                  target="_blank"
                  rel="noreferrer"
                  aria-label={`在地图搜索附近同类：${g.name}`}
                  className="inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary"
                >
                  {`搜索附近 · ${g.name}`}
                  <ExternalLink className="h-3 w-3" />
                </a>
              ))}
            </div>
          </div>
        </TabsContent>
      </Tabs>

      {/* 申请合作弹窗（与两大资源分类并列无关，入口在页头） */}
      <Dialog open={applyOpen} onOpenChange={setApplyOpen}>
        <DialogContent className="max-h-[90dvh] max-w-[calc(100%-2rem)] overflow-y-auto md:max-w-3xl">
          <DialogHeader>
            <DialogTitle>申请合作</DialogTitle>
            <DialogDescription>
              当用户讨论与你的产品或服务相关的活动、物料或场地需求时，SceneFlow AI 会展示相关合作推荐，帮助用户查看产品、了解服务并联系合作伙伴。
            </DialogDescription>
          </DialogHeader>
          {/* 专属联系邮箱：显眼展示 + 一键复制（发送由你在邮件应用完成） */}
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/30 bg-primary/5 px-4 py-3">
            <Mail className="h-4.5 w-4.5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <p className="text-xs text-muted-foreground">合作联系邮箱</p>
              <p className="truncate text-sm font-semibold text-foreground">{PARTNER_EMAIL}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(PARTNER_EMAIL);
                  toast.success('邮箱已复制');
                } catch {
                  toast.error('复制失败，请手动选择复制');
                }
              }}
            >
              <Copy className="h-3.5 w-3.5" />
              复制邮箱
            </Button>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            <div className="flex flex-col gap-3.5">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="partner-brand">
                  品牌/商家名称<span className="text-destructive">*</span>
                </Label>
                <Input
                  id="partner-brand"
                  value={brand}
                  onChange={(e) => setBrand(e.target.value)}
                  placeholder="如：星野派对道具"
                  maxLength={40}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>
                  服务类别<span className="text-destructive">*</span>
                </Label>
                <Select value={serviceType} onValueChange={setServiceType}>
                  <SelectTrigger>
                    <SelectValue placeholder="选择你提供的服务" />
                  </SelectTrigger>
                  <SelectContent>
                    {SERVICE_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="partner-contact">
                  联系方式<span className="text-destructive">*</span>
                </Label>
                <Input
                  id="partner-contact"
                  value={contact}
                  onChange={(e) => setContact(e.target.value)}
                  placeholder="邮箱 / 电话 / 微信号"
                  maxLength={60}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="partner-city">服务城市（可选）</Label>
                <Input
                  id="partner-city"
                  value={city}
                  onChange={(e) => setCity(e.target.value)}
                  placeholder="如：杭州 / 全国可邮寄"
                  maxLength={30}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="partner-intro">业务介绍（可选）</Label>
                <Textarea
                  id="partner-intro"
                  value={intro}
                  onChange={(e) => setIntro(e.target.value)}
                  placeholder="主营业务、可服务的活动类型与规模"
                  rows={3}
                  maxLength={300}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="partner-link">官网/商品链接（可选）</Label>
                <Input
                  id="partner-link"
                  value={link}
                  onChange={(e) => setLink(e.target.value)}
                  placeholder="https://…"
                  maxLength={120}
                />
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <div>
                <h3 className="text-sm font-semibold">申请内容预览</h3>
                <p className="mt-1 text-xs text-muted-foreground">填写后即可复制或打开邮件草稿发送。</p>
              </div>
              <pre className="min-h-40 flex-1 whitespace-pre-wrap break-words rounded-lg bg-muted/60 p-3 text-xs leading-relaxed text-foreground">
                {canSubmit ? applicationText : '填写左侧表单后，这里会生成申请内容预览。'}
              </pre>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Button variant="outline" className="flex-1" disabled={!canSubmit} onClick={() => void copyText()}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? '已复制' : '复制申请内容'}
                </Button>
                <Button className="flex-1" disabled={!canSubmit} onClick={openMailDraft}>
                  <Send className="h-4 w-4" />
                  打开邮件草稿
                </Button>
              </div>
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Mail className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                「打开邮件草稿」会预填收件人与申请内容，检查后在邮件应用中发送即可。
              </p>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** 统一资源卡（目录资源 + 旧物料参考同构展示） */

/**
 * 合作商品卡（线上/本地通用）：
 * - 优选条目：顶部大图（3:2），突出展示；
 * - 普通有图条目：左侧方形小缩略图 + 右侧文字，紧凑不撑屏；
 * - 无图条目：纯文字卡。均自然高度，不留空图位。
 */
function GoodsCard({ r, activeRegion }: { r: PartnerResource; activeRegion?: string }) {
  const badges = (
    <div className="flex flex-wrap items-center gap-1.5">
      {r.featured && (
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/70 bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-400">
          <Sparkles className="h-3 w-3" />
          SceneFlow 优选
        </span>
      )}
      <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">推广</span>
      {r.city && (
        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">{r.city}</span>
      )}
      {activeRegion && r.category === 'local' && !r.city && (
        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
          {activeRegion}·已定位
        </span>
      )}
    </div>
  );
  const titleRow = (
    <div className="flex items-baseline justify-between gap-2">
      <h3 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{r.name}</h3>
      {r.priceNote && <span className="shrink-0 text-sm font-semibold text-primary">{r.priceNote}</span>}
    </div>
  );
  const metaLine = (
    <p className="truncate text-xs text-muted-foreground">
      {r.merchant}
      {r.merchant && <span className="mx-1 text-border">·</span>}
      {r.capacity && <>容纳 {r.capacity} · </>}
      {r.scenes}
    </p>
  );
  return (
    <div
      className={cn(
        'flex flex-col gap-1.5 rounded-xl border bg-card p-3.5 shadow-sm transition-shadow hover:shadow-md md:p-4',
        r.featured && 'gap-2 border-amber-200/70 dark:border-amber-500/30'
      )}
    >
      {r.image && r.featured && (
        <div className="-mx-4 -mt-4 mb-1 overflow-hidden rounded-t-xl border-b">
          <img src={r.image} alt={`${r.name}商品图`} loading="lazy" className="aspect-[3/2] w-full object-cover" />
        </div>
      )}
      {badges}
      {!r.featured ? (
        /* 普通条目：统一左侧方形图/图标占位 + 右侧文字，保证双列对齐 */
        <div className="flex items-start gap-2.5">
          <div className="flex aspect-square w-20 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted/40 md:w-24">
            {r.image ? (
              <img src={r.image} alt={`${r.name}商品图`} loading="lazy" className="h-full w-full object-cover" />
            ) : r.category === 'local' ? (
              <MapPin className="h-6 w-6 text-primary/50" />
            ) : (
              <Package className="h-6 w-6 text-primary/50" />
            )}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            {titleRow}
            {metaLine}
          </div>
        </div>
      ) : (
        <>
          {titleRow}
          {metaLine}
        </>
      )}
      <p className="text-xs leading-relaxed text-muted-foreground line-clamp-2">{r.use}</p>
      <div className="flex items-center justify-between gap-2 pt-0.5">
        {r.rating != null ? (
          <span className="flex min-w-0 items-center gap-1 text-xs text-amber-600 dark:text-amber-400">
            <Star className="h-3.5 w-3.5 shrink-0 fill-current" aria-hidden />
            <span className="font-medium">{r.rating.toFixed(1)}</span>
            {r.reviews != null && (
              <span className="truncate text-muted-foreground">{r.reviews.toLocaleString('zh-CN')} 条评价</span>
            )}
            {r.servedCount != null && (
              <span className="truncate text-muted-foreground">已服务 {r.servedCount.toLocaleString('zh-CN')}+ 场</span>
            )}
          </span>
        ) : (
          <span />
        )}
        <a
          href={r.url}
          target="_blank"
          rel="noreferrer"
          className="inline-flex shrink-0 items-center gap-1 rounded-full border border-primary/40 bg-primary/5 px-2.5 py-1 text-xs font-medium text-primary transition-colors hover:bg-primary/10"
        >
          {r.urlLabel}
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>
    </div>
  );
}
