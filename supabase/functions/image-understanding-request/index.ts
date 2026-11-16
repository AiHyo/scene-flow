/** 图像理解提交代理：图片 URL + 问题 → 上游返回 task_id（轮询由前端执行，EF 不等待结果） */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const UPSTREAM_URL =
  'https://app-ezp96b2kzksh-api-DYJwo27V85oa-gateway.miaoda.online/rest/2.0/image-classify/v1/image-understanding/request';

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return new Response('Method Not Allowed', { status: 405, headers: corsHeaders });
  }

  let question: string;
  let image: string | undefined;
  let url: string | undefined;
  try {
    const body = await req.json();
    question = body.question;
    if (typeof question !== 'string' || question === '') throw new Error('Missing question');
    /* 接口限制：question ≤ 100 字符 */
    if (question.length > 100) throw new Error('question 长度需在 100 字符以内');
    if (typeof body.image === 'string' && body.image !== '') image = body.image;
    if (typeof body.url === 'string' && body.url !== '') url = body.url;
    if (!image && !url) throw new Error('Missing image or url');
  } catch (err) {
    return new Response(JSON.stringify({ error: `Invalid request body: ${(err as Error).message}` }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const apiKey = Deno.env.get('INTEGRATIONS_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'Server configuration error: missing API key' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const requestBody: Record<string, string> = image ? { question, image } : { question, url: url as string };
  const upstream = await fetch(UPSTREAM_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Gateway-Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(requestBody),
  });

  /* 限流 / 余额不足原样透传 */
  if (upstream.status === 429 || upstream.status === 402) {
    const errText = await upstream.text();
    return new Response(errText, {
      status: upstream.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  if (!upstream.ok) {
    const errText = await upstream.text();
    return new Response(errText || JSON.stringify({ error: `Upstream error: ${upstream.status}` }), {
      status: upstream.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  const data = await upstream.json();
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
});
