// Kiểm thử backend (migration + RLS + RPC) không cần Docker: chạy Postgres trong Node bằng PGlite,
// giả lập phần auth của Supabase (auth.users, auth.uid(), role anon/authenticated).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

const SUPABASE_STUB = `
create schema auth;
create table auth.users (id uuid primary key default gen_random_uuid(), email text unique,
  raw_user_meta_data jsonb not null default '{}', raw_app_meta_data jsonb not null default '{}');
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
grant usage on schema public, auth to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`;
type Row = Record<string, any>;
const db = await PGlite.create();
await db.exec(SUPABASE_STUB);
for (const f of fs.readdirSync('supabase/migrations').sort()) await db.exec(fs.readFileSync(`supabase/migrations/${f}`, 'utf8'));

// Chạy SQL như một người dùng đã đăng nhập (uid) hoặc anon (null) — giống request qua PostgREST.
const as = async (uid: string | null, sql: string, params: unknown[] = []): Promise<Row[]> => {
  await db.query<Row>(`select set_config('request.jwt.claim.sub', $1, false)`, [uid ?? '']);
  await db.exec(`set role ${uid ? 'authenticated' : 'anon'}`);
  try { return (await db.query<Row>(sql, params)).rows; } finally { await db.exec('reset role'); }
};
const one = async (...a: Parameters<typeof as>): Promise<Row> => (await as(...a))[0];
const fails = (uid: string | null, sql: string, params: unknown[] | undefined, re: RegExp, _why?: string) => assert.rejects(as(uid, sql, params), re);

// ---- dữ liệu mẫu (tài khoản do admin cấp: vai trò đi qua app_metadata như Edge Function admin-users làm) ----
const U: Record<string, string> = {};
for (const [k, name, role, listed] of [['gv', 'Nguyễn Văn An', 'teacher', true], ['sv', 'Trần Minh Khoa', 'student', true],
  ['ad', 'Lê Thu Hà', 'admin', true], ['sv2', 'Phạm Gia Huy', 'student', true], ['sv3', 'Võ Ngọc Lan', 'student', false]] as [string, string, string, boolean][]) {
  // Giống Supabase Auth (Admin API createUser): INSERT user trước, rồi mới ghi app_metadata bằng một lệnh UPDATE riêng.
  U[k] = (await db.query<Row>(`insert into auth.users (email, raw_user_meta_data, raw_app_meta_data) values ($1, $2, '{"provider":"email"}') returning id`,
    [`${k}@demo.vn`, JSON.stringify({ name })])).rows[0].id;
  await db.query<Row>(`update auth.users set raw_app_meta_data = raw_app_meta_data || jsonb_build_object('role', $1::text) where id = $2`, [role, U[k]]);
  if (!listed) await db.query<Row>('update profiles set listed = false where id = $1', [U[k]]);
}
// Admin tạo lớp học phần (học kỳ 2026-1, nhóm 01), phân công GV, ghi danh SV.
await as(U.ad, `insert into courses (code, title, term, section, teacher_id) values
  ('IT150IU', 'Nhập môn IoT', '2026-1', '01', $1), ('IT116IU', 'Lập trình C/C++', '2026-1', '01', $1), ('IT160IU', 'Khai phá dữ liệu', '2026-1', '01', $1)`, [U.gv]);
await as(U.ad, 'insert into enrollments values ($1, 1), ($1, 2), ($1, 3), ($2, 1), ($2, 2), ($3, 1)', [U.sv, U.sv2, U.sv3]);
await as(U.gv, `insert into outcomes (course_id, code, description) values (1, 'CLO1', 'Kiến trúc IoT'), (1, 'CLO2', 'Giao thức IoT')`);
for (const [t, o, a, clo] of [['ESP32 là gì?', ['Vi điều khiển có WiFi', 'Hệ điều hành', 'CSDL'], 0, 1], ['MQTT dùng mô hình nào?', ['Request/Response', 'Publish/Subscribe'], 1, 2], ['Edge AI chạy ở đâu?', ['Tại thiết bị biên', 'Chỉ trên cloud'], 0, 1]])
  await as(U.gv, 'select add_question(1, $1, $2, $3, $4)', [t, JSON.stringify(o), a, clo]);
await as(U.gv, `insert into exams (course_id, title, minutes, opens_at, closes_at) values (1, 'Giữa kỳ', 10, now() - interval '1 hour', now() + interval '1 hour')`);
await as(U.gv, `insert into assignments (course_id, title, due_at) values (2, 'Lab 6', now() + interval '1 day')`);
await db.query<Row>(`insert into devices (name, room, key_hash) values ('Camera Edge A1.101', 'A1.101', sha256_hex('dev-key-123'))`);
let sid: number;

test('profile tạo tự động: vai trò theo app_metadata (admin cấp), không có thì là sinh viên', async () => {
  const roles = Object.fromEntries((await db.query<Row>('select email, role from profiles')).rows.map((r) => [r.email, r.role]));
  assert.deepEqual([roles['gv@demo.vn'], roles['ad@demo.vn'], roles['sv@demo.vn']], ['teacher', 'admin', 'student']);
  await db.query<Row>(`insert into auth.users (email) values ('moi@demo.vn')`);
  // user_metadata do người dùng tự gửi khi đăng ký → không được dùng để nâng quyền
  await db.query<Row>(`insert into auth.users (email, raw_user_meta_data) values ('hack@demo.vn', '{"role":"admin"}')`);
  assert.deepEqual((await db.query<Row>(`select role from profiles where email in ('moi@demo.vn', 'hack@demo.vn')`)).rows.map((r) => r.role), ['student', 'student']);
});

test('phân quyền theo khóa học', async () => {
  assert.equal((await as(null, 'select * from courses')).length, 0, 'anon sees nothing');
  await fails(U.sv, `insert into courses (code, title, term) values ('X', 'x', '2026-1')`, [], /row-level security/);
  await fails(U.gv, `insert into courses (code, title, term) values ('X', 'x', '2026-1')`, [], /row-level security/, 'only admin creates courses');
  await as(U.gv, `update courses set title = 'đổi' where id = 1`); // GV không sửa được môn → không đổi gì
  assert.equal((await one(U.gv, 'select title from courses where id = 1')).title, 'Nhập môn IoT');
  assert.equal((await as(U.sv2, 'select * from courses where id = 3')).length, 0, 'not enrolled → hidden');
  assert.equal((await as(U.sv2, 'select * from courses')).length, 2);
  assert.equal((await as(U.ad, 'select * from courses')).length, 3, 'admin sees all');
  await fails(U.gv, `insert into lessons (course_id, title, url) values (1, 'x', 'javascript:alert(1)')`, [], /check constraint/);
  await fails(U.ad, 'insert into enrollments values ($1, 1)', [U.gv], /row-level security/, 'only students can be enrolled');
  await fails(U.gv, 'insert into enrollments values ($1, 3)', [U.sv2], /row-level security/, 'teachers do not enroll');
  assert.equal((await as(U.sv, 'select * from questions')).length, 0, 'students cannot browse the bank');
  assert.equal((await as(U.sv, 'select * from question_keys')).length, 0);
  assert.equal((await as(U.gv, 'select * from question_keys')).length, 3);
});

test('thi trực tuyến: bắt đầu, làm tiếp, sự kiện thiết bị', async () => {
  const st = (await one(U.sv, 'select start_exam(1) r')).r;
  sid = st.session_id;
  assert.equal(st.questions.length, 3);
  assert.ok(st.questions.every(q => !('answer' in q)), 'answers must not leak');
  assert.equal((await one(U.sv, 'select start_exam(1) r')).r.session_id, sid, 'reload resumes same session');
  await fails(U.gv, 'select start_exam(1)', [], /không có quyền/);

  await fails(null, `select device_event('wrong', $1, 'edge', 'multi_person')`, [sid], /Khóa thiết bị/);
  await as(null, `select device_event('dev-key-123', $1, 'edge', 'multi_person', '{"conf":0.9}', $2)`, [sid, Date.now() - 40]);
  await as(U.sv, `select log_client_event($1, 'tab_blur')`, [sid]);
  await fails(U.sv2, `select log_client_event($1, 'tab_blur')`, [sid], /không hợp lệ/);
  await fails(U.sv, `select log_event($1, 'server', 'fake')`, [sid], /permission denied/);
  await fails(U.sv, `insert into events (session_id, source, type) values ($1, 'server', 'fake')`, [sid], /row-level security/);

  const ev = await as(U.gv, 'select * from event_log where session_id = $1 order by seq', [sid]);
  assert.deepEqual(ev.map(e => e.type), ['session_start', 'session_resume', 'multi_person', 'tab_blur']);
  assert.ok(ev[1].alert, 'resume is flagged');
  assert.equal(ev[2].detail.device, 'Camera Edge A1.101');
  assert.ok(ev[2].latency_ms >= 0);
  assert.equal((await as(U.sv, 'select * from event_log')).length, 0, 'student cannot read log');
  assert.equal((await one(U.gv, 'select verify_chain($1) r', [sid])).r.ok, true);
});

test('nộp bài thi, chuẩn đầu ra, rà soát, báo cáo', async () => {
  const r = (await one(U.sv, `select submit_exam($1, '{"1":0,"2":1,"3":1}') r`, [sid])).r;
  assert.equal(r.right, 2); assert.equal(r.score, 6.7);
  await fails(U.sv, 'select start_exam(1)', [], /đã làm/);
  await fails(U.sv, `select submit_exam($1, '{}')`, [sid], /Đã nộp/);
  await fails(null, `select device_event('dev-key-123', $1, 'edge', 'x')`, [sid], /đã kết thúc/);

  // CLO1 = câu 1 (đúng) + câu 3 (sai) → 50%, CLO2 = câu 2 (đúng) → 100%
  assert.deepEqual((await as(U.sv, 'select code, pct from outcome_performance()')).map(g => [g.code, g.pct]), [['CLO1', 50], ['CLO2', 100]]);

  await fails(U.sv, `select review_session($1, 'valid')`, [sid], /Không có quyền/);
  await as(U.ad, `select review_session($1, 'suspicious', '2 người trong khung hình')`, [sid]);
  assert.equal((await one(U.ad, 'select review from session_overview where id = $1', [sid])).review, 'suspicious');
  assert.equal((await one(U.ad, 'select verify_chain($1) r', [sid])).r.ok, true, 'review appended to chain');

  const rep = (await one(U.ad, 'select system_report() r')).r;
  assert.equal(rep.sessions, 1); assert.deepEqual(rep.broken, []); assert.equal(rep.latency.n, 1);
  await fails(U.sv, 'select system_report()', [], /Không có quyền/);
  assert.equal((await as(U.ad, `select * from event_log where alert and type ilike '%multi%'`)).length, 1);
});

test('bài tập: nộp → chấm → khóa nộp lại', async () => {
  await as(U.sv, `select submit_assignment(1, 'https://github.com/x/lab6')`);
  await fails(U.sv3, `select submit_assignment(1, 'x')`, [], /không có quyền/, 'not enrolled in course 2');
  const { id } = await one(U.gv, 'select id from submissions where user_id = $1', [U.sv]);
  await fails(U.gv, 'select grade_submission($1, 11)', [id], /Điểm phải từ 0 đến 10/);
  await fails(U.sv, 'select grade_submission($1, 10)', [id], /Không có quyền/);
  await as(U.sv, 'update submissions set grade = 10 where id = $1', [id]); // không có policy → không đổi gì
  await as(U.gv, `select grade_submission($1, 9, 'Tốt')`, [id]);
  await fails(U.sv, `select submit_assignment(1, 'again')`, [], /đã được chấm/);
  assert.equal(Number((await as(U.sv, 'select * from grade_book()')).find(g => g.item === 'Lab 6')!.score), 9);
  assert.equal((await as(U.sv, 'select * from grade_book()')).every(g => g.student === 'Trần Minh Khoa'), true, 'student sees only own grades');
  assert.ok((await as(U.sv, 'select * from my_agenda()')).some(x => x.kind === 'assignment' && x.done));
});

test('quản trị tài khoản: chỉ admin đổi vai trò, có chốt an toàn', async () => {
  await fails(U.gv, `select admin_set_role($1, 'teacher')`, [U.sv2], /Chỉ quản trị viên/);
  await fails(U.sv, `select admin_set_role($1, 'admin')`, [U.sv], /Chỉ quản trị viên/, 'student cannot self-promote');
  await fails(U.ad, `select admin_set_role($1, 'student')`, [U.ad], /chính mình/);
  await fails(U.ad, `select admin_set_role($1, 'student')`, [U.gv], /đang phụ trách khóa học/);
  await as(U.ad, `select admin_set_role($1, 'teacher')`, [U.sv2]);
  assert.equal((await db.query<Row>('select role from profiles where id = $1', [U.sv2])).rows[0].role, 'teacher');
  await as(U.ad, `select admin_set_role($1, 'student')`, [U.sv2]);
  assert.equal((await as(U.ad, 'select * from profiles')).length, 7, 'admin lists every account, listed or not');
});

test('bài học & tiến độ học tập', async () => {
  await as(U.gv, `insert into lessons (course_id, title, body, position) values (1, 'Bài 1 — Kiến trúc IoT', 'Nội dung', 1), (1, 'Bài 2 — MQTT', '', 2)`);
  await fails(U.sv, `insert into lessons (course_id, title) values (1, 'x')`, [], /row-level security/);
  const [l1] = await as(U.sv, 'select id from lessons where course_id = 1 order by position');
  await as(U.sv, 'insert into lesson_progress (lesson_id) values ($1)', [l1.id]);
  await fails(U.sv2, 'insert into lesson_progress (lesson_id, user_id) values ($1, $2)', [l1.id, U.sv], /row-level security/, 'cannot mark for others');
  await fails(U.gv, 'insert into lesson_progress (lesson_id) values ($1)', [l1.id], /row-level security/, 'only students');
  const l3 = (await one(U.gv, `insert into lessons (course_id, title) values (3, 'Bài DM') returning id`)).id;
  await fails(U.sv2, 'insert into lesson_progress (lesson_id) values ($1)', [l3], /row-level security/, 'not enrolled in course 3');

  const mine = await as(U.sv, 'select * from course_progress(1)');
  assert.equal(mine.length, 1, 'student sees only own row');
  assert.deepEqual([mine[0].lessons_done, mine[0].lessons_total, mine[0].exams_done, mine[0].exams_total], [1, 2, 1, 1]);
  assert.equal((await as(U.gv, 'select * from course_progress(1)')).length, 3, 'teacher sees the class');
  assert.equal((await as(U.ad, 'select * from course_progress()')).length, 6, 'admin sees every enrollment');
  assert.equal((await as(U.sv2, 'select * from lesson_progress')).length, 0, 'progress is private');
  assert.equal((await as(U.gv, 'select * from lesson_progress')).length, 1, 'teacher sees class progress');
  await as(U.sv, 'delete from lesson_progress where lesson_id = $1', [l1.id]);
  assert.equal((await one(U.sv, 'select lessons_done from course_progress(1)')).lessons_done, 0);
});

test('điểm bài thi: chấm ngay, GV chọn cho xem hoặc ẩn đến khi công bố', async () => {
  const x2 = (await one(U.gv, `insert into exams (course_id, title, minutes, opens_at, closes_at, show_score)
    values (1, 'Cuối kỳ', 10, now() - interval '1 hour', now() + interval '1 hour', false) returning id`)).id;
  const s2 = (await one(U.sv2, 'select start_exam($1) r', [x2])).r.session_id;
  const res = (await one(U.sv2, `select submit_exam($1, '{"1":0,"2":1,"3":0}') r`, [s2])).r;
  assert.deepEqual(res, { hidden: true, late: false }, 'no score returned while hidden');
  // mọi đường đọc điểm của SV đều bị che
  await fails(U.sv2, 'select score from exam_sessions', [], /permission denied/);
  assert.equal((await one(U.sv2, 'select score from session_overview where id = $1', [s2])).score, null);
  assert.equal((await one(U.sv2, 'select session_score($1) v', [s2])).v, null);
  assert.equal((await as(U.sv2, 'select * from grade_book()')).find((g) => g.item === 'Cuối kỳ')!.score, null);
  assert.equal((await as(U.sv2, 'select * from outcome_performance()')).every((o) => o.attempts === 0), true, 'CLO results hidden too');
  assert.equal(Number((await one(U.gv, 'select score from session_overview where id = $1', [s2])).score), 10, 'teacher always sees');
  assert.equal((await one(U.sv2, 'select session_score($1) v', [sid])).v, null, "cannot read a classmate's score");
  // trang kết quả của GV: cả lớp, kể cả chưa làm
  const rs = await as(U.gv, 'select * from exam_results($1)', [x2]);
  assert.deepEqual(rs.map((r) => [r.student, r.status, r.score == null ? null : Number(r.score)]),
    [['Phạm Gia Huy', 'done', 10], ['Trần Minh Khoa', 'absent', null], ['Võ Ngọc Lan', 'absent', null]]);
  assert.equal((await as(U.sv, 'select * from exam_results($1)', [x2])).length, 0, 'students get nothing');
  // công bố điểm
  await as(U.gv, 'update exams set show_score = true where id = $1', [x2]);
  assert.equal(Number((await one(U.sv2, 'select score from session_overview where id = $1', [s2])).score), 10);
});

test('môn học theo học kỳ: admin quản lý, nhập đăng ký từ edu, tự ghi danh, điều chuyển lớp', async () => {
  const c4 = (await one(U.ad, `insert into courses (code, title, term, section, schedule, room, teacher_id)
    values ('IT150IU', 'Nhập môn IoT', '2026-1', '02', 'Thứ 4 · Ca 3', 'A2.201', $1) returning id`, [U.gv])).id;
  await fails(U.ad, `insert into courses (code, title, term, section) values ('IT150IU', 'x', '2026-1', '02')`, [], /duplicate key/, 'code+term+section unique');
  await fails(U.ad, `update courses set teacher_id = $1 where id = $2`, [U.sv, c4], /row-level security/, 'teacher must be a teacher');
  const rows = [
    { email: 'SV3@demo.vn ', code: 'it116iu' },              // môn chỉ có 1 nhóm → không cần ghi nhóm
    { email: 'moi2@demo.vn', code: 'IT116IU' },              // chưa có tài khoản
    { email: 'sv3@demo.vn', code: 'IT150IU' },               // môn có 2 nhóm → thiếu nhóm
    { email: 'sv3@demo.vn', code: 'IT150IU', section: '02' },
    { email: 'gv@demo.vn', code: 'IT116IU' },
    { email: 'khong-hop-le', code: 'IT116IU' },
    { email: 'sv@demo.vn', code: 'NOPE101' },
  ];
  await fails(U.gv, `select * from import_registrations('2026-1', $1)`, [JSON.stringify(rows)], /Chỉ quản trị viên/);
  await fails(U.ad, `select * from import_registrations('HK1', $1)`, [JSON.stringify(rows)], /Học kỳ không hợp lệ/);
  const r = await as(U.ad, `select * from import_registrations('2026-1', $1)`, [JSON.stringify(rows)]);
  assert.deepEqual(r.map((x) => x.status), ['enrolled', 'pending', 'ambiguous', 'enrolled', 'not_student', 'invalid', 'no_course']);
  assert.deepEqual((await as(U.sv3, 'select id from courses order by id')).map((c) => Number(c.id)), [1, 2, c4], 'sv3 now sees registered courses');
  // tài khoản tạo sau → tự có môn đã đăng ký
  const moi2 = (await db.query<Row>(`insert into auth.users (email) values ('moi2@demo.vn') returning id`)).rows[0].id;
  assert.deepEqual((await as(moi2, 'select code from courses')).map((c) => c.code), ['IT116IU']);
  const before = (await db.query<Row>('select count(*)::int n from enrollments')).rows[0].n;
  await as(U.ad, `select * from import_registrations('2026-1', $1)`, [JSON.stringify(rows)]);
  assert.equal((await db.query<Row>('select count(*)::int n from enrollments')).rows[0].n, before, 're-import adds nothing');
  // điều chuyển sang ca khác
  await fails(U.gv, 'select move_student($1, 2, $2)', [moi2, c4], /Chỉ quản trị viên/);
  await as(U.ad, 'select move_student($1, 2, $2)', [moi2, c4]);
  assert.deepEqual((await as(moi2, 'select id from courses')).map((c) => Number(c.id)), [c4]);
  assert.deepEqual((await db.query<Row>(`select course_id from registrations where email = 'moi2@demo.vn'`)).rows.map((x) => Number(x.course_id)), [c4]);
  await fails(U.ad, 'select move_student($1, 2, $2)', [moi2, c4], /không thuộc lớp/);
});

test('thiết bị: chỉ admin cấp/thu hồi khóa, khóa không lộ', async () => {
  await fails(U.gv, `select register_device('x', 'y')`, [], /Chỉ quản trị viên/);
  const key = (await one(U.ad, `select register_device('Cảm biến A1.102', 'A1.102') k`)).k;
  await as(null, 'select device_ping($1)', [key]);
  const d = await one(U.ad, `select id, name, room, last_seen from devices where room = 'A1.102'`);
  assert.ok(d.last_seen);
  await fails(U.ad, 'select key_hash from devices', [], /permission denied/);
  assert.equal((await as(U.sv, 'select id from devices')).length, 0);
  await as(U.ad, 'delete from devices where id = $1', [d.id]);
  await fails(null, 'select device_ping($1)', [key], /Khóa thiết bị/);
});

test('cổng thông tin: công việc, email, danh bạ, thông báo', async () => {
  await as(U.sv, `insert into tasks (title, due) values ('Ôn bài', '2026-11-20')`);
  assert.equal((await as(U.sv, 'select * from tasks')).length, 1);
  assert.equal((await as(U.gv, 'select * from tasks')).length, 0, 'tasks are private');

  assert.equal((await one(U.sv, `select send_message(1, 'teachers', 'Hỏi bài', 'x') n`)).n, 1);
  assert.equal((await as(U.gv, 'select * from messages where to_id = $1', [U.gv])).length, 1);
  await fails(U.sv, `select send_message(1, 'nobody@x', 'a')`, [], /Không có người nhận/);
  await fails(U.sv2, `select send_message(3, 'all', 'a')`, [], /không thuộc khóa học/);
  assert.equal((await as(U.sv2, 'select * from messages')).length, 0);

  assert.equal((await as(U.sv, `select * from profiles where listed and name ilike '%Lan%'`)).length, 0, 'unlisted hidden from directory');
  assert.equal((await as(U.sv, 'select * from course_members(1)')).length, 4, 'roster includes unlisted classmates');
  assert.equal((await as(U.sv2, 'select * from course_members(3)')).length, 0);
  await fails(U.sv, `update profiles set role = 'admin' where id = $1`, [U.sv], /permission denied/);
  await fails(U.sv, `update profiles set active = true where id = $1`, [U.sv], /permission denied/);
  await as(U.sv, `update profiles set name = 'Khoa', listed = false where id = $1`, [U.sv]);
  assert.equal((await db.query<Row>('select name from profiles where id = $1', [U.sv])).rows[0].name, 'Khoa');

  await fails(U.sv, `insert into announcements (title) values ('x')`, [], /row-level security/);
  await fails(U.gv, `insert into announcements (title) values ('x')`, [], /row-level security/, 'teacher posts to own course only');
  await as(U.gv, `insert into announcements (course_id, title) values (1, 'Lớp IoT')`);
  await as(U.ad, `insert into announcements (title) values ('Toàn trường')`);
  const seen = (await as(U.sv2, 'select title from announcements')).map(a => a.title).sort();
  assert.deepEqual(seen, ['Lớp IoT', 'Toàn trường']);
  assert.equal((await as(U.sv3, 'select * from announcements where course_id = 2')).length, 0);
});

test('sửa nhật ký trong DB → chuỗi băm gãy', async () => {
  await as(U.sv, `update events set type = 'nothing'`); // qua API: không có policy → không đổi gì
  assert.equal((await one(U.ad, 'select verify_chain($1) r', [sid])).r.ok, true);
  await db.query<Row>(`update events set type = 'nothing' where type = 'multi_person'`); // quản trị DB sửa trực tiếp
  const v = (await one(U.ad, 'select verify_chain($1) r', [sid])).r;
  assert.deepEqual(v, { ok: false, broken_at: 3 });
  assert.equal((await one(U.ad, 'select system_report() r')).r.broken.length, 1);
});
