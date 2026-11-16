/** 访客项目关联账号：登录后把本机访客会话名下的活动转到当前账号（service role，校验调用者身份） */

import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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

  try {
    /* 1. 从 Authorization JWT 解出当前登录用户（目标账号） */
    const authHeader = req.headers.get('Authorization') ?? '';
    const token = authHeader.replace('Bearer', '').trim();
    if (!token) {
      return new Response(JSON.stringify({ error: 'Missing authorization' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user?.id) {
      return new Response(JSON.stringify({ error: 'Invalid session' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const toUserId = userData.user.id;

    /* 2. 解析请求体：from_user_id = 本机原访客（匿名会话）用户 id */
    const body = await req.json().catch(() => null);
    const fromUserId = body?.from_user_id;
    if (typeof fromUserId !== 'string' || !/^[0-9a-f-]{36}$/i.test(fromUserId)) {
      return new Response(JSON.stringify({ error: 'Missing or invalid from_user_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    if (fromUserId === toUserId) {
      return new Response(JSON.stringify({ migrated: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    /* 3. 仅迁移该访客名下项目（UPDATE 幂等；不触碰账号已有项目） */
    const { data: updated, error: updateErr } = await admin
      .from('projects')
      .update({ owner_id: toUserId })
      .eq('owner_id', fromUserId)
      .select('id');
    if (updateErr) {
      return new Response(JSON.stringify({ error: 'Migration failed' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ migrated: updated?.length ?? 0 }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message ?? 'Unexpected error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
