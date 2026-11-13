// Smoke test end-to-end: node test.js
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

const DB = 'test.db', U = 'http://localhost:3999';
const clean = () => ['', '-wal', '-shm'].forEach(x => fs.rmSync(DB + x, { force: true }));
clean();
const srv = spawn('node', ['server.js'], { env: { ...process.env, PORT: 3999, DB }, stdio: 'ignore' });
const call = async (path, body, h = {}) => { const r = await fetch(U + '/api' + path, { method: body ? 'POST' : 'GET', headers: h, body: body && JSON.stringify(body) }); return { s: r.status, j: await r.json() }; };
try {
  await new Promise(r => setTimeout(r, 1500));
  const login = async e => (await call('/login', { email: e, password: '123' })).j.token;
  const A = t => ({ authorization: 'Bearer ' + t });
  const [sv, gv, kt, sv2] = (await Promise.all(['sv', 'gv', 'kt', 'sv2'].map(n => login(n + '@demo.vn')))).map(A);

  // quyền
  assert.equal((await call('/login', { email: 'sv@demo.vn', password: 'x' })).s, 401);
  assert.equal((await call('/courses', { code: 'X', title: 'x' }, sv)).s, 403, 'student cannot create course');
  assert.equal((await call('/courses/3', null, sv2)).s, 403, 'not enrolled → no access');
  assert.equal((await call('/courses/1', null, sv2)).s, 200);
  assert.equal((await call('/materials', { course_id: 1, title: 'x', url: 'javascript:alert(1)' }, gv)).s, 400, 'no javascript: urls');

  // thi + nhật ký
  const st = (await call('/exams/1/start', {}, sv)).j;
  assert.equal(st.questions.length, 3);
  assert.ok(!('answer' in st.questions[0]), 'answers must not leak');
  assert.equal((await call('/exams/1/start', {}, sv)).j.session_id, st.session_id, 'reload resumes same session');

  assert.equal((await call('/events', { session_id: st.session_id, source: 'edge', type: 'multi_person' })).s, 401, 'device key required');
  assert.equal((await call('/events', { session_id: st.session_id, source: 'edge', type: 'x' }, { 'x-device-key': 'wrong' })).s, 401);
  const dev = { 'x-device-key': 'dev-key-123' };
  assert.equal((await call('/events', { session_id: st.session_id, source: 'edge', type: 'multi_person', detail: { conf: 0.9 }, dts: Date.now() - 40 }, dev)).s, 200);

  const ev = (await call(`/sessions/${st.session_id}/events`, null, gv)).j;
  assert.equal(ev.chain.ok, true);
  assert.ok(ev.events.some(e => e.type === 'session_resume' && e.alert), 'resume is flagged');
  assert.equal(ev.events.find(e => e.type === 'multi_person').detail.device, 'Camera Edge A1.101');
  assert.equal((await call(`/sessions/${st.session_id}/events`, null, sv)).s, 403, 'student cannot read log');

  const r = (await call(`/sessions/${st.session_id}/submit`, { answers: { 1: 0, 2: 1, 3: 1 } }, sv)).j;
  assert.equal(r.right, 2); // 2/3 đúng
  assert.equal((await call('/exams/1/start', {}, sv)).s, 409, 'one attempt only');

  // chuẩn đầu ra: CLO1 = câu 1 (đúng) + câu 3 (sai) → 50%, CLO2 = câu 2 (đúng) → 100%
  const goals = (await call('/goals', null, sv)).j;
  assert.deepEqual(goals.map(g => [g.code, g.pct]), [['CLO1', 50], ['CLO2', 100]]);

  assert.equal((await call(`/sessions/${st.session_id}/review`, { verdict: 'suspicious', note: '2 người trong khung hình' }, kt)).s, 200);
  assert.equal((await call(`/sessions/${st.session_id}/events`, null, kt)).j.chain.ok, true, 'review appended to chain');
  const rep = (await call('/reports', null, kt)).j;
  assert.equal(rep.sessions, 1); assert.equal(rep.broken.length, 0); assert.equal(rep.latency.n, 1);
  assert.ok((await call('/events?alerts=1&type=multi', null, kt)).j.length === 1, 'event search');

  // bài tập: nộp → chấm → khóa nộp lại
  assert.equal((await call('/assignments/2/submit', { text: 'https://github.com/x/lab6' }, sv)).s, 200);
  const subs = (await call('/assignments/2/submissions', null, gv)).j.rows.find(x => x.email === 'sv@demo.vn');
  assert.equal((await call(`/submissions/${subs.id}/grade`, { grade: 11 }, gv)).s, 400, 'grade ≤ points');
  assert.equal((await call(`/submissions/${subs.id}/grade`, { grade: 9, feedback: 'ok' }, gv)).s, 200);
  assert.equal((await call('/assignments/2/submit', { text: 'again' }, sv)).s, 409, 'graded → locked');
  assert.equal((await call('/grades', null, sv)).j.find(g => g.item === 'Lab 6').score, 9);
  assert.equal((await call('/assignments/2/submissions', null, sv)).s, 403);

  // thiết bị: chỉ khảo thí cấp/thu hồi khóa
  assert.equal((await call('/devices', { name: 'x', room: 'y' }, gv)).s, 403);
  const key = (await call('/devices', { name: 'Cảm biến A1.102', room: 'A1.102' }, kt)).j.key;
  assert.equal((await call('/ping', {}, { 'x-device-key': key })).s, 200);
  const d = (await call('/devices', null, kt)).j.find(x => x.room === 'A1.102');
  assert.equal(d.online, true);
  await call(`/devices/${d.id}/revoke`, {}, kt);
  assert.equal((await call('/ping', {}, { 'x-device-key': key })).s, 401, 'revoked key rejected');

  // cổng thông tin
  assert.equal((await call('/tasks', { title: 'Ôn bài', due: '2026-11-20' }, sv)).s, 200);
  assert.equal((await call('/tasks', null, sv)).j.length, 1);
  assert.equal((await call('/tasks', null, gv)).j.length, 0, 'tasks are private');
  assert.equal((await call('/calendar', null, sv)).j[0].kind, 'task');
  assert.ok((await call('/calendar', null, sv)).j.some(x => x.kind === 'assignment' && x.title === 'Lab 6' && x.done));
  assert.equal((await call('/messages', { course_id: 1, to: 'teachers', subject: 'Hỏi bài', body: 'x' }, sv)).j.sent, 1);
  assert.equal((await call('/messages', null, gv)).j.inbox.length, 1);
  assert.equal((await call('/messages', { course_id: 1, to: 'nobody@x', subject: 'a', body: 'b' }, sv)).s, 400);
  assert.equal((await call('/messages', { course_id: 3, to: 'all', subject: 'a' }, sv2)).s, 403, 'email only within own course');
  assert.equal((await call('/users?f=role&q=teach', null, sv)).j.length, 1);
  assert.equal((await call('/users?q=Lan', null, sv)).j.length, 0, 'unlisted user hidden');
  assert.equal((await call('/users?f=name;drop&q=x', null, sv)).s, 200, 'field is whitelisted');
  assert.equal((await call('/announcements', { title: 't', body: 'b' }, sv)).s, 403);
  assert.equal((await call('/announcements', { title: 'Toàn trường', body: 'b' }, kt)).s, 200);
  assert.ok((await call('/announcements', null, sv2)).j.some(a => a.title === 'Toàn trường' && a.course_id === null));
  assert.equal((await call('/me', { name: 'SV', old: 'sai', password: '123456' }, sv)).s, 400, 'old password checked');

  // sửa DB → chuỗi băm phải gãy
  const db = new DatabaseSync(DB);
  db.prepare("update events set type='nothing' where type='multi_person'").run();
  db.close();
  const after = (await call(`/sessions/${st.session_id}/events`, null, gv)).j;
  assert.equal(after.chain.ok, false, 'tampering detected');
  assert.equal((await call('/reports', null, kt)).j.broken.length, 1);
  console.log('OK — tất cả kiểm tra đạt');
} finally { srv.kill(); setTimeout(clean, 300); }
