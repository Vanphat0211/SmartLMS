// Quản trị tài khoản — chỉ admin. Cần service role (tạo user, đổi mật khẩu, khóa) nên phải chạy ở server,
// không bao giờ gọi Auth Admin API từ trình duyệt. Tách khỏi index.ts để kiểm thử bằng Node (tests/admin-users.test.mjs).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';

export const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

const ROLES = ['student', 'teacher', 'admin'];
const MAX_BATCH = 200;
// Lỗi tiếng Anh thường gặp của Supabase Auth → câu tiếng Việt (client dịch lại sang tiếng Anh nếu cần).
const authError = (m: string) =>
  /already been registered|already registered/i.test(m) ? 'Email đã có tài khoản'
    : /invalid format|validate email/i.test(m) ? 'Email không hợp lệ'
    : /password/i.test(m) ? 'Mật khẩu không hợp lệ (tối thiểu 6 ký tự)'
    : m;

export async function handle(req: Request, db: SupabaseClient): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });

  // 1. Xác thực người gọi: token đăng nhập hợp lệ + hồ sơ là admin đang hoạt động.
  const jwt = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const { data: auth } = jwt ? await db.auth.getUser(jwt) : { data: { user: null } };
  if (!auth.user) return json({ error: 'Phiên đăng nhập không hợp lệ' }, 401);
  const { data: me } = await db.from('profiles').select('role, active').eq('id', auth.user.id).maybeSingle();
  if (me?.role !== 'admin' || !me.active) return json({ error: 'Chỉ quản trị viên được quản lý tài khoản' }, 403);

  const body = await req.json().catch(() => ({}));
  const password = String(body.password ?? '');

  // 2. Cấp tài khoản (một hoặc nhiều người cùng vai trò, cùng mật khẩu ban đầu).
  if (body.action === 'create') {
    if (!ROLES.includes(body.role)) return json({ error: 'Vai trò không hợp lệ' }, 400);
    if (password.length < 6) return json({ error: 'Mật khẩu tối thiểu 6 ký tự' }, 400);
    const users = Array.isArray(body.users) ? body.users : [];
    if (!users.length || users.length > MAX_BATCH) return json({ error: 'Cần từ 1 đến 200 tài khoản mỗi lần' }, 400);
    const results: { email: string; ok: boolean; error?: string }[] = [];
    for (const u of users) { // tuần tự để không chạm giới hạn tốc độ của Auth
      const email = String(u?.email ?? '').trim().toLowerCase();
      const { error } = await db.auth.admin.createUser({
        email, password, email_confirm: true,                  // admin cấp → không cần xác nhận email
        user_metadata: { name: String(u?.name ?? '').trim() },
        app_metadata: { role: body.role },                      // trigger handle_new_user đọc vai trò từ đây
      });
      results.push(error ? { email, ok: false, error: authError(error.message) } : { email, ok: true });
    }
    return json({ results });
  }

  // 3. Thao tác trên một tài khoản khác (không tự khóa / tự đổi mật khẩu ở đây — dùng trang Hồ sơ).
  const target = String(body.user_id ?? '');
  if (!target) return json({ error: 'Thiếu tài khoản' }, 400);
  if (target === auth.user.id) return json({ error: 'Không thể thao tác trên chính tài khoản của bạn' }, 400);

  if (body.action === 'password') {
    if (password.length < 6) return json({ error: 'Mật khẩu tối thiểu 6 ký tự' }, 400);
    const { error } = await db.auth.admin.updateUserById(target, { password });
    return error ? json({ error: authError(error.message) }, 400) : json({ ok: true });
  }

  if (body.action === 'active') {
    const active = body.active === true;
    // Khóa = ban trong Auth (không đăng nhập / làm mới phiên được nữa). Giữ nguyên dữ liệu & nhật ký thi.
    const { error } = await db.auth.admin.updateUserById(target, { ban_duration: active ? 'none' : '876000h' });
    if (error) return json({ error: error.message }, 400);
    const { error: e2 } = await db.from('profiles').update({ active }).eq('id', target);
    return e2 ? json({ error: e2.message }, 400) : json({ ok: true });
  }

  return json({ error: 'Thao tác không hợp lệ' }, 400);
}
