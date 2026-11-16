/** 可灵 Omni 图像生成：任务提交代理 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const UPSTREAM_URL = 'https://app-ezp96b2kzksh-api-DLEO4zbkvoea-gateway.miaoda.online/v1/images/omni-image';

interface SubmitBody {
  prompt?: string;
  image_list?: Array<{ image?: string }>;
  resolution?: string;
  aspect_ratio?: string;
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

  /* 1. 解析并校验请求体 */
  let payload: Record<string, unknown>;
  try {
    const body = (await req.json()) as SubmitBody;
    if (!body.prompt || typeof body.prompt !== 'string') {
      throw new Error('Missing prompt');
    }
    payload = { prompt: body.prompt };

    const hasImages = Array.isArray(body.image_list) && body.image_list.length > 0;
    if (hasImages) {
      const images = body.image_list
        .filter((it) => typeof it?.image === 'string' && it.image.startsWith('http'))
        .map((it) => ({ image: it.image as string }));
      if (images.length === 0) throw new Error('image_list present but no valid image url');
      payload.image_list = images;
    }

    if (body.resolution && typeof body.resolution === 'string') payload.resolution = body.resolution;
    if (body.aspect_ratio && typeof body.aspect_ratio === 'string') payload.aspect_ratio = body.aspect_ratio;
    /* 单图生成不传 series_amount（上游限制） */
  } catch (err) {
    return new Response(JSON.stringify({ error: `Invalid request body: ${(err as Error).message}` }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  /* 2. 读取平台注入的密钥 */
  const apiKey = Deno.env.get('INTEGRATIONS_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Server configuration error: missing API key' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  /* 3. 调用上游创建任务（响应为 {code, message, data:{task_id,...}} 包装，解包后返回前端） */
  try {
    const upstream = await fetch(UPSTREAM_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Gateway-Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(payload),
    });

    const body = await upstream.json().catch(() => null);
    if (!upstream.ok || !body) {
      return new Response(JSON.stringify(body ?? { error: `Upstream error: ${upstream.status}` }), {
        status: upstream.status,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    /* 解包 data：前端期望顶层 {task_id, task_status}；错误响应（无 data）原样透传 */
    const inner = body.data ?? body;
    return new Response(JSON.stringify(inner), {
      status: upstream.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Upstream request failed: ${(err as Error).message}` }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
