// Kiểm thử Edge Function admin-users bằng Node (không cần deploy): client Supabase giả, ghi lại các lệnh gọi Auth Admin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../supabase/functions/admin-users/handler.ts';

function fakeDb(role: string | null, active = true) {
  const calls: any[][] = [];
  const db = {
    calls,
    auth: {
      getUser: async (jwt: string) => ({ data: { user: jwt === 'good' ? { id: 'me' } : null } }),
      admin: {
        createUser: async (a: any) => { calls.push(['create', a]); return { error: a.email === 'trung@x.vn' ? { message: 'A user with this email address has already been registered' } : null }; },
        updateUserById: async (id: string, a: any) => { calls.push(['auth', id, a]); return { error: null }; },
      },
    },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: role ? { role, active } : null }) }) }),
      update: (v: any) => ({ eq: async (_c: string, id: string) => { calls.push(['profile', id, v]); return { error: null }; } }),
    }),
  };
  return db;
}
const call = async (db: any, body: any, jwt = 'good') => {
  const res = await handle(new Request('http://x/admin-users', { method: 'POST', headers: { Authorization: `Bearer ${jwt}` }, body: JSON.stringify(body) }), db);
  return [res.status, await res.json()];
};

test('admin-users: chặn người không phải admin', async () => {
  assert.equal((await call(fakeDb('admin'), { action: 'create' }, ''))[0], 401, 'no token');
  assert.equal((await call(fakeDb('admin'), { action: 'create' }, 'forged'))[0], 401, 'invalid token');
  for (const role of ['teacher', 'student', null]) assert.equal((await call(fakeDb(role), { action: 'create' }))[0], 403);
  assert.equal((await call(fakeDb('admin', false), { action: 'create' }))[0], 403, 'locked admin');
});

test('admin-users: cấp nhiều tài khoản, báo lỗi từng dòng', async () => {
  const db = fakeDb('admin');
  const [status, body] = await call(db, { action: 'create', role: 'teacher', password: '123456', users: [{ email: ' GV@X.vn ', name: 'An' }, { email: 'trung@x.vn' }] });
  assert.equal(status, 200);
  assert.deepEqual(body.results, [{ email: 'gv@x.vn', ok: true }, { email: 'trung@x.vn', ok: false, error: 'Email đã có tài khoản' }]);
  const [, first] = db.calls[0];
  assert.deepEqual([first.email_confirm, first.app_metadata, first.user_metadata], [true, { role: 'teacher' }, { name: 'An' }]);
  assert.equal((await call(db, { action: 'create', role: 'root', password: '123456', users: [{ email: 'a@x.vn' }] }))[0], 400, 'bad role');
  assert.equal((await call(db, { action: 'create', role: 'student', password: '123', users: [{ email: 'a@x.vn' }] }))[0], 400, 'short password');
});

test('admin-users: khóa / đặt lại mật khẩu tài khoản khác, không tự khóa mình', async () => {
  const db = fakeDb('admin');
  assert.equal((await call(db, { action: 'active', user_id: 'me', active: false }))[0], 400);
  assert.equal((await call(db, { action: 'active', user_id: 'u1', active: false }))[0], 200);
  assert.deepEqual(db.calls, [['auth', 'u1', { ban_duration: '876000h' }], ['profile', 'u1', { active: false }]]);
  assert.equal((await call(db, { action: 'password', user_id: 'u1', password: 'moi-123' }))[0], 200);
  assert.deepEqual(db.calls.at(-1), ['auth', 'u1', { password: 'moi-123' }]);
  assert.equal((await call(db, { action: 'drop_db', user_id: 'u1' }))[0], 400);
});
