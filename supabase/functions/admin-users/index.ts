// Edge Function admin-users. Triển khai: npx supabase functions deploy admin-users --use-api --no-verify-jwt
// (handler tự kiểm tra token + vai trò admin). SUPABASE_URL và SUPABASE_SERVICE_ROLE_KEY do Supabase cấp sẵn.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handle } from './handler.ts';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve((req) => handle(req, db));
