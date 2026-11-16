import { createClient } from 'jsr:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface MapRow {
  credential_id: string;
  auth_uid: string;
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

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const admin = createClient(supabaseUrl, serviceKey);

    const { credential_id: credentialId } = await req.json();
    if (!credentialId || typeof credentialId !== 'string' || credentialId.length < 8) {
      return new Response(JSON.stringify({ error: 'Missing or invalid credential_id' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    /* 1. 查映射 */
    let map = ((
      await admin.from('anon_credential_map').select('credential_id, auth_uid').eq('credential_id', credentialId).maybeSingle()
    ).data as MapRow | null) ?? null;

    /* 2. 无映射则创建 auth 用户 + 写映射 */
    if (!map) {
      const email = `anon_${credentialId}@scene.local`;
      const password = crypto.randomUUID() + crypto.randomUUID();
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
      if (createErr || !created?.user) {
        return new Response(
          JSON.stringify({ error: `Failed to create anon user: ${createErr?.message ?? 'unknown'}` }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      const { error: insertErr } = await admin
        .from('anon_credential_map')
        .insert({ credential_id: credentialId, auth_uid: created.user.id });
      if (insertErr) {
        return new Response(JSON.stringify({ error: `Failed to save mapping: ${insertErr.message}` }), {
          status: 500,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      map = { credential_id: credentialId, auth_uid: created.user.id };
    }

    /* 3. 生成 magiclink 令牌哈希 */
    const email = `anon_${credentialId}@scene.local`;
    const { data, error: linkErr } = await admin.auth.admin.generateLink({ type: 'magiclink', email });
    if (linkErr || !data?.properties?.hashed_token) {
      return new Response(JSON.stringify({ error: `Failed to generate link: ${linkErr?.message ?? 'unknown'}` }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ hashed_token: data.properties.hashed_token, auth_uid: map.auth_uid }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
