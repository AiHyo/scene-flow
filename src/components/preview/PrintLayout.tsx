import { createPortal } from 'react-dom';
import { knownTotal, subtotalLabel, unitPriceLabel, unpricedItems } from '@/services/budgetMath';
import { REQ_VAL_FIELDS, isUnknownReqValue, type PendingItem } from '@/services/deliverables';
import type { ProjectData, RequirementValue } from '@/types/types';

/** 活动安排 PDF 导出视图：读取当前真实数据（不重调 AI、不含聊天）；打印时浏览器「另存为 PDF」 */
export default function PrintLayout({
  title,
  data,
  pendings,
}: {
  title: string;
  data: ProjectData;
  pendings: PendingItem[];
}) {
  const d = data;
  const req = d.requirements ?? {};
  const items = d.budget?.items ?? [];
  /* 统一计算源（budgetMath）：未知=待询价不计合计，0=免费是有效金额 */
  const total = knownTotal(items);
  const unpriced = unpricedItems(items);
  const dir = (d.directions ?? []).find((x) => x.id === d.selectedDirectionId);
  const txt = (v?: RequirementValue) =>
    v?.value == null || String(v.value).trim() === '' ? '—' : String(v.value);
  /* 值本身是未知占位（还没想好/待定，兼容旧活动）时不是已确认事实：统一（待确认）；
   * 真实数值/0 仍按来源标签（0 预算是有效金额，未设定是 null 走未定） */
  const src = (v?: RequirementValue) =>
    isUnknownReqValue(v) ? '（待确认）' : v?.source === 'confirmed' ? '（已确认）' : v?.source === 'ai' ? '（AI 建议，待确认）' : '（未定）';
  const genAt = d.scene?.lastReq?.at ? new Date(d.scene.lastReq.at).toLocaleString('zh-CN') : '';

  return createPortal(
    <div id="print-root">
      <div className="print-page">
        <h1>{title} · 活动安排</h1>
        <p className="print-meta">
          导出时间：{new Date().toLocaleString('zh-CN')} · 由 SceneFlow AI 按当前活动数据生成（不含聊天记录，费用按数量×单价实际计算）
        </p>

        <section className="print-avoid-break">
          <h2>活动主题与方向</h2>
          {d.theme ? (
            <p>
              <strong>{d.theme.name}</strong>
              {d.theme.slogan ? `「${d.theme.slogan}」` : ''}
              {dir ? `；已选方向：${dir.name}（${dir.style}）` : ''}
            </p>
          ) : (
            <p>活动方案尚未生成。</p>
          )}
          {(d.theme?.highlights ?? []).length > 0 && <p>亮点：{d.theme?.highlights?.join('、')}</p>}
        </section>

        <section className="print-avoid-break">
          <h2>活动要求</h2>
          <ul style={{ margin: 0, paddingLeft: '18px' }}>
            {req.goal && <li>活动目标：{req.goal}</li>}
            {req.type && <li>活动类型：{req.type}</li>}
            {REQ_VAL_FIELDS.map((f) => (
              <li key={f.key}>
                {f.label}：{txt(req[f.key])} {req[f.key] ? src(req[f.key]) : '（未定）'}
              </li>
            ))}
            {req.otherNeeds && <li>其他要求：{req.otherNeeds}</li>}
          </ul>
        </section>

        {(d.schedule ?? []).length > 0 && (
          <section>
            <h2>活动流程</h2>
            <ol style={{ margin: 0, paddingLeft: '18px' }}>
              {d.schedule?.map((s) => (
                <li key={s.id}>
                  {s.time ? `【${s.time}】` : ''}
                  {s.name}
                  {s.duration ? `（${s.duration}）` : ''}
                  {s.note ? `：${s.note}` : ''}
                </li>
              ))}
            </ol>
          </section>
        )}

        {(d.copies?.invite || d.copies?.hosting || (d.copies?.onsite ?? []).length > 0) && (
          <section>
            <h2>活动文案</h2>
            {d.copies?.invite && <p>邀请函：{d.copies.invite}</p>}
            {d.copies?.hosting && <p>主持词：{d.copies.hosting}</p>}
            {(d.copies?.onsite ?? []).length > 0 && <p>现场指引：{d.copies?.onsite?.join('；')}</p>}
          </section>
        )}

        {((d.materials ?? []).length > 0 || (d.tasks ?? []).length > 0) && (
          <section>
            <h2>物料与准备任务</h2>
            <table className="print-table">
              <thead>
                <tr>
                  <th>类别</th>
                  <th>名称／负责人</th>
                  <th>数量／期限</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {(d.materials ?? []).map((m) => (
                  <tr key={m.id}>
                    <td>{m.category}</td>
                    <td>{m.name}</td>
                    <td>{m.qty}</td>
                    <td>{m.ready ? '已就绪' : '未就绪'}</td>
                  </tr>
                ))}
                {(d.tasks ?? []).map((t) => (
                  <tr key={t.id}>
                    <td>任务</td>
                    <td>
                      {t.name}
                      {t.owner ? `（${t.owner}）` : ''}
                    </td>
                    <td>{t.deadline || '—'}</td>
                    <td>{t.done ? '已完成' : '未完成'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <section>
          <h2>费用明细</h2>
          {items.length > 0 ? (
            <table className="print-table">
              <thead>
                <tr>
                  <th>项目</th>
                  <th>数量</th>
                  <th>单价</th>
                  <th>小计</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.id}>
                    <td>{it.name}</td>
                    <td>{Number(it.qty) || 0}</td>
                    <td>{it.priceUnknown ? '价格待询' : unitPriceLabel(it)}</td>
                    <td>{it.priceUnknown ? '—' : subtotalLabel(it)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p>暂无费用条目。</p>
          )}
          <p>
            费用合计：¥{total.toLocaleString()}（按数量×单价实际计算，待询价项未计入）
            {d.budget?.limit != null ? `；预算上限：¥${d.budget.limit.toLocaleString()}` : '；预算上限：未设定'}
          </p>
          {unpriced.length > 0 && <p>未计价事项（价格待询）：{unpriced.map((x) => x.name).join('、')}</p>}
        </section>

        <section className="print-avoid-break">
          <h2>场地原图／布置效果</h2>
          {d.scene?.beforeUrl ? (
            <>
              <p>场地原图：</p>
              <img src={d.scene.beforeUrl} alt="场地原图" />
              {d.scene.afterUrl ? (
                <>
                  <p>
                    布置效果{genAt ? `（生成于 ${genAt}）` : ''}
                    {d.scene.stale ? '：对应调整前的要求，最新要求尚未生成效果' : ''}
                    {d.scene.lastReq?.beforeUrl && d.scene.lastReq.beforeUrl !== d.scene.beforeUrl
                      ? '：基于生成时的原场地原图（当前原图已更换，如需新原图效果请重新生成）'
                      : ''}
                    ：
                  </p>
                  <img src={d.scene.afterUrl} alt="布置效果" />
                </>
              ) : (
                <p>布置效果图尚未生成。</p>
              )}
            </>
          ) : (
            <p>暂无场地图片。</p>
          )}
        </section>

        <section className="print-avoid-break">
          <h2>待确认事项</h2>
          {pendings.length > 0 ? (
            <ol style={{ margin: 0, paddingLeft: '18px' }}>
              {pendings.map((p, i) => (
                <li key={i}>{p.text}</li>
              ))}
            </ol>
          ) : (
            <p>各项内容已就绪。</p>
          )}
        </section>

        <p className="print-foot">本安排由 SceneFlow AI 生成；「AI 建议」与「未定」内容以工作区最新确认为准。</p>
      </div>
    </div>,
    document.body
  );
}
