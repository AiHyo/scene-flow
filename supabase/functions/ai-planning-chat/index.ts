/** 文心大模型 SSE 代理：将上游流式响应透传给前端 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const UPSTREAM_URL = 'https://app-ezp96b2kzksh-api-zYkZz8qovQ1L-gateway.miaoda.online/v2/chat/completions';

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  /* 1. 解析并校验请求体（content 支持纯文本或多模态数组：text / image_url） */
  type ContentPart =
    | { type: 'text'; text: string }
    | { type: 'image_url'; image_url: { url: string } };
  let messages: Array<{ role: string; content: string | ContentPart[] }>;
  let enableThinking = false;
  let model: string | undefined;

  const validContent = (c: unknown): boolean => {
    if (typeof c === 'string') return c !== '';
    if (Array.isArray(c) && c.length > 0) {
      return c.every((p) => {
        if (typeof p !== 'object' || p === null) return false;
        if (p.type === 'text' && typeof p.text === 'string') return p.text !== '';
        if (p.type === 'image_url' && typeof p.image_url?.url === 'string') return p.image_url.url !== '';
        return false;
      });
    }
    return false;
  };

  try {
    const body = await req.json();
    messages = body.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new Error('Missing or invalid messages');
    }
    for (const m of messages) {
      if (!m?.role || !validContent(m.content)) {
        throw new Error('Each message needs role and non-empty content');
      }
    }
    if (body.enable_thinking !== undefined) enableThinking = Boolean(body.enable_thinking);
    if (typeof body.model === 'string' && body.model !== '') model = body.model;
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

  /* 3. 调用上游 SSE 接口 */
  const upstream = await fetch(UPSTREAM_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Gateway-Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      messages,
      enable_thinking: enableThinking,
      /* 携图消息需视觉模型：默认模型不支持 image_url，显式传入的 model 优先 */
      ...(model
        ? { model }
        : messages.some((m) => Array.isArray(m.content) && m.content.some((p) => p.type === 'image_url'))
          ? { model: 'ernie-4.5-turbo-vl' }
          : {}),
    }),
  });

  /* 4. 转发限流 / 余额不足错误 */
  if (upstream.status === 429 || upstream.status === 402) {
    const errText = await upstream.text();
    return new Response(errText, {
      status: upstream.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!upstream.ok) {
    /* 透传上游错误详情（如 image_url_unsafe / invalid_model），便于定位真实原因 */
    const errText = await upstream.text();
    return new Response(errText || JSON.stringify({ error: `Upstream error: ${upstream.status}` }), {
      status: upstream.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
  if (!upstream.body) {
    return new Response(JSON.stringify({ error: 'Upstream error: empty body' }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  /* 5. 直接透传 SSE 流 */
  return new Response(upstream.body, {
    headers: {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
