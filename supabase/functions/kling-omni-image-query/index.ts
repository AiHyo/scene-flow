/** 可灵 Omni 图像生成：任务查询 + 成功后转存 media 桶 */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const UPSTREAM_BASE = 'https://app-ezp96b2kzksh-api-79jK6nw4zxDL-gateway.miaoda.online/v1/images/omni-image';

interface UpstreamImage {
  url?: string;
}
interface UpstreamResp {
  task_status?: string;
  task_status_msg?: string;
  images?: UpstreamImage[];
}

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method Not Allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  /* 1. 解析 task_id */
  let taskId: string;
  try {
    const body = await req.json();
    if (!body.task_id || typeof body.task_id !== 'string') throw new Error('Missing task_id');
    taskId = body.task_id;
  } catch (err) {
    return new Response(JSON.stringify({ error: `Invalid request body: ${(err as Error).message}` }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  /* 2. 读取密钥 */
  const apiKey = Deno.env.get('INTEGRATIONS_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Server configuration error: missing API key' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  /* 3. 查询上游（响应为 {code, message, data:{task_status, images}} 包装，解包 data 供前端与转存逻辑使用） */
  let resp: UpstreamResp;
  let status: number;
  try {
    const upstream = await fetch(`${UPSTREAM_BASE}/${encodeURIComponent(taskId)}`, {
      headers: { 'X-Gateway-Authorization': `Bearer ${apiKey}` },
    });
    status = upstream.status;
    const body = await upstream.json().catch(() => null);
    if (!body) throw new Error('empty upstream response');
    resp = (body.data ?? body) as UpstreamResp;
    /* 上游把 images 嵌套在 task_result.images：归一化到顶层，供转存逻辑与前端统一读取 */
    const nested = (resp as UpstreamResp & { task_result?: { images?: UpstreamImage[] } }).task_result?.images;
    if (Array.isArray(nested) && nested.length > 0 && !(resp.images && resp.images.length > 0)) {
      resp.images = nested;
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: `Upstream request failed: ${(err as Error).message}` }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (status !== 200) {
    return new Response(JSON.stringify(resp), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  /* 4. 成功则转存到 media 桶（公开 URL 更稳定，可灵图床 URL 有时效） */
  if (resp.task_status === 'succeed' && resp.images?.[0]?.url) {
    const originUrl = resp.images[0].url as string;
    try {
      const imgResp = await fetch(originUrl);
      if (imgResp.ok) {
        const blob = await imgResp.blob();
        const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
        const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
        const admin = createClient(supabaseUrl, serviceKey);
        const objectPath = `generated/${crypto.randomUUID()}.jpg`;
        const { error: uploadErr } = await admin.storage
          .from('media')
          .upload(objectPath, blob, { contentType: 'image/jpeg' });
        if (!uploadErr) {
          const { data: pub } = admin.storage.from('media').getPublicUrl(objectPath);
          if (pub?.publicUrl) {
            resp.images = [{ url: pub.publicUrl }];
          }
        }
      }
    } catch (_e) {
      /* 转存失败：回退返回原始可灵 URL，前端仍可显示 */
    }
  }

  return new Response(JSON.stringify(resp), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
