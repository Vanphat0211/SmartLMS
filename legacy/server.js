// SmartLMS: LMS + IoT + Edge AI demo server. Zero dependencies: Node 24+ (node:sqlite).
import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const PORT = process.env.PORT || 3000;
// Sự kiện cần cán bộ rà soát. Hệ thống chỉ gắn cờ, không tự kết luận gian lận.
const ALERTS = ['multi_person', 'no_face', 'tab_blur', 'window_blur', 'copy_paste', 'fullscreen_exit', 'session_resume', 'late_submit', 'room_noise_high'];
const QA = ALERTS.map(() => '?').join();

const db = new DatabaseSync(process.env.DB || 'smartlms.db');
// ponytail: 1 tiến trình Node + SQLite WAL (~vài nghìn sự kiện/s); vượt mức đó → MQTT broker + Postgres/TimescaleDB.
db.exec(`
pragma journal_mode=wal; pragma synchronous=normal;
create table if not exists users(id integer primary key, name text, email text unique, pw text, role text, listed int default 1);
create table if not exists courses(id integer primary key, code text, title text, teacher_id int);
create table if not exists enroll(user_id int, course_id int, primary key(user_id, course_id));
create table if not exists materials(id integer primary key, course_id int, title text, url text);
create table if not exists assignments(id integer primary key, course_id int, title text, body text, due text, points real);
create table if not exists submissions(id integer primary key, assignment_id int, user_id int, text text, ts int, grade real, feedback text, unique(assignment_id, user_id));
create table if not exists outcomes(id integer primary key, course_id int, code text, text text);
create table if not exists questions(id integer primary key, course_id int, text text, options text, answer int, outcome_id int);
create table if not exists exams(id integer primary key, course_id int, title text, minutes int, date text);
create table if not exists sessions(id integer primary key, exam_id int, user_id int, started int, deadline int, submitted int, score real, status text, answers text, review text);
create table if not exists announcements(id integer primary key, course_id int, title text, body text, author text, ts int);
create table if not exists tasks(id integer primary key, user_id int, title text, due text, done int default 0);
create table if not exists cal(id integer primary key, user_id int, title text, date text);
create table if not exists contacts(id integer primary key, user_id int, name text, email text, phone text);
create table if not exists messages(id integer primary key, course_id int, from_name text, from_email text, to_email text, subject text, body text, ts int);
create table if not exists devices(id integer primary key, name text, room text, key text unique, last_seen int);
create table if not exists events(id integer primary key, session_id int, ts int, dts int, source text, type text, detail text, prev text, hash text);
create index if not exists ev_session on events(session_id);
`);

const all = (s, ...a) => db.prepare(s).all(...a);
const one = (s, ...a) => db.prepare(s).get(...a);
const run = (s, ...a) => db.prepare(s).run(...a);
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const hashPw = (p, salt = crypto.randomBytes(8).toString('hex')) => salt + ':' + crypto.scryptSync(p, salt, 32).toString('hex');
const checkPw = (p, h) => hashPw(p, h.split(':')[0]) === h;
const err = (code, msg) => Object.assign(new Error(msg), { code });
const need = (v, what) => { const s = String(v ?? '').trim(); if (!s) throw err(400, 'Thiếu ' + what); return s; };
const day = (n = 0) => new Date(Date.now() + n * 864e5).toLocaleDateString('sv'); // YYYY-MM-DD, giờ địa phương
const IN = (ids) => `(${ids.map(Number).join() || 'null'})`; // chỉ id số từ DB
const pattern = (q) => { const s = String(q.get('q') || '').replace(/[%_]/g, ''); return { equals: s, starts: s + '%' }[q.get('op')] ?? `%${s}%`; };
const shuffle = (a) => { for (let i = a.length; i > 1;) { const j = crypto.randomInt(i--); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const OK = { ok: 1 };

if (!one('select 1 from users')) {
  for (const [n, e, r, l = 1] of [['Nguyễn Văn An', 'gv@demo.vn', 'teacher'], ['Trần Minh Khoa', 'sv@demo.vn', 'student'], ['Lê Thu Hà', 'kt@demo.vn', 'proctor'], ['Phạm Gia Huy', 'sv2@demo.vn', 'student'], ['Võ Ngọc Lan', 'sv3@demo.vn', 'student', 0]])
    run('insert into users(name,email,pw,role,listed) values(?,?,?,?,?)', n, e, hashPw('123'), r, l);
  for (const [c, t] of [['IT150IU', 'Nhập môn IoT'], ['IT116IU', 'Lập trình C/C++'], ['IT160IU', 'Khai phá dữ liệu']]) run('insert into courses(code,title,teacher_id) values(?,?,1)', c, t);
  for (const [u, c] of [[2, 1], [2, 2], [2, 3], [4, 1], [4, 2], [5, 1]]) run('insert into enroll values(?,?)', u, c);
  run("insert into materials(course_id,title,url) values(1,'Slide tuần 1 — Kiến trúc IoT','https://example.com/w1.pdf')");
  run("insert into outcomes(course_id,code,text) values(1,'CLO1','Trình bày được kiến trúc thiết bị IoT'),(1,'CLO2','Vận dụng được giao thức truyền thông IoT')");
  for (const [t, o, a, clo] of [['ESP32 là gì?', ['Vi điều khiển có WiFi', 'Hệ điều hành', 'Cơ sở dữ liệu'], 0, 1], ['MQTT dùng mô hình nào?', ['Request/Response', 'Publish/Subscribe', 'Peer-to-peer'], 1, 2], ['Edge AI chạy ở đâu?', ['Tại thiết bị biên', 'Chỉ trên cloud', 'Trên giấy'], 0, 1]])
    run('insert into questions(course_id,text,options,answer,outcome_id) values(1,?,?,?,?)', t, JSON.stringify(o), a, clo);
  run("insert into exams(course_id,title,minutes,date) values(1,'Kiểm tra giữa kỳ',10,?)", day());
  for (const [c, t, d] of [[2, 'Lab 5', day(-8) + 'T10:30'], [2, 'Lab 6', day() + 'T23:59'], [1, 'Báo cáo đo cảm biến nhiệt độ', day(5) + 'T23:59'], [3, 'Bài tập 1 — Tiền xử lý dữ liệu', day(9) + 'T23:59']])
    run("insert into assignments(course_id,title,body,due,points) values(?,?,'Nộp link mã nguồn và báo cáo ngắn.',?,10)", c, t, d);
  const now = Date.now();
  run("insert into submissions(assignment_id,user_id,text,ts,grade,feedback) values(1,2,'https://github.com/demo/lab5',?,8.5,'Tốt, cần thêm chú thích.')", now - 9 * 864e5);
  for (const [c, t, b, a, ago] of [[null, 'Lịch thi giữa kỳ học kỳ 1', 'Các kỳ thi trực tuyến được giám sát bằng camera Edge AI và cảm biến phòng thi. Sinh viên kiểm tra webcam trước giờ thi.', 'Phòng Khảo thí', 2],
    [1, 'Chào mừng đến với Nhập môn IoT', 'Kỳ kiểm tra giữa kỳ mở hôm nay, làm bài 10 phút, có giám sát IoT + Edge AI.', 'Nguyễn Văn An', 0], [2, 'Điểm giữa kỳ', 'Điểm Lab 5 đã có trong mục Kết quả học tập.', 'Nguyễn Văn An', 1]])
    run('insert into announcements(course_id,title,body,author,ts) values(?,?,?,?,?)', c, t, b, a, now - ago * 864e5);
  run("insert into devices(name,room,key) values('Camera Edge A1.101','A1.101',?)", sha('dev-key-123'));
}

// Hash-chained event log: editing/deleting any row breaks verification.
function logEvent(sid, source, type, detail, dts) {
  const ts = Date.now();
  const prev = one('select hash from events where session_id=? order by id desc', sid)?.hash || '';
  const d = JSON.stringify(detail || {});
  run('insert into events(session_id,ts,dts,source,type,detail,prev,hash) values(?,?,?,?,?,?,?,?)',
    sid, ts, dts || ts, source, type, d, prev, sha(prev + sid + ts + source + type + d));
}
function verify(sid) {
  let prev = '';
  for (const e of all('select * from events where session_id=? order by id', sid)) {
    if (e.prev !== prev || e.hash !== sha(prev + sid + e.ts + e.source + e.type + e.detail)) return { ok: false, brokenAt: e.id };
    prev = e.hash;
  }
  return { ok: true };
}

// ---- Quyền theo khóa học ----
const courseIds = (u) => (u.role === 'proctor' ? all('select id from courses')
  : u.role === 'teacher' ? all('select id from courses where teacher_id=?', u.id)
  : all('select course_id id from enroll where user_id=?', u.id)).map((r) => r.id);
const inCourse = (u, cid) => { if (!courseIds(u).includes(Number(cid))) throw err(403, 'Bạn không thuộc khóa học này'); return Number(cid); };
const teaches = (u, cid) => { if (!one('select 1 from courses where id=? and teacher_id=?', Number(cid) || 0, u.id)) throw err(403, 'Không phải khóa học của bạn'); return Number(cid); };
const sessionFor = (u, id) => {
  const s = one('select s.*, x.course_id, x.title exam, us.name student from sessions s join exams x on x.id=s.exam_id join users us on us.id=s.user_id where s.id=?', id);
  if (!s) throw err(404, 'Không có phiên thi');
  inCourse(u, s.course_id); return s;
};

const tokens = new Map();
const routes = [];
const R = (m, p, roles, fn) => routes.push([m, new RegExp('^' + p.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), roles, fn]);
const ANY = ['teacher', 'student', 'proctor'], STAFF = ['teacher', 'proctor'];

R('POST', '/api/login', null, ({ b }) => {
  const u = one('select * from users where email=?', b.email);
  if (!u || !checkPw(b.password || '', u.pw)) throw err(401, 'Sai email hoặc mật khẩu');
  const token = crypto.randomUUID();
  tokens.set(token, { id: u.id, name: u.name, role: u.role, email: u.email });
  return { token, user: { name: u.name, role: u.role, email: u.email } };
});
R('GET', '/api/me', ANY, ({ u }) => one('select name,email,role,listed from users where id=?', u.id));
R('POST', '/api/me', ANY, ({ u, b }) => {
  if (b.password) {
    if (String(b.password).length < 6) throw err(400, 'Mật khẩu mới tối thiểu 6 ký tự');
    if (!checkPw(b.old || '', one('select pw from users where id=?', u.id).pw)) throw err(400, 'Mật khẩu cũ không đúng');
    run('update users set pw=? where id=?', hashPw(b.password), u.id);
  }
  u.name = need(b.name, 'họ tên');
  run('update users set name=?, listed=? where id=?', u.name, b.listed ? 1 : 0, u.id);
  return OK;
});

// ---- Khóa học, học liệu, bài tập, chuẩn đầu ra ----
const roster = (cid) => all(`select name,email,role from users where id in (select user_id from enroll where course_id=?) or id=(select teacher_id from courses where id=?) order by role desc, name`, cid, cid);
R('GET', '/api/courses', ANY, ({ u }) => all(`select c.*, t.name teacher from courses c left join users t on t.id=c.teacher_id where c.id in ${IN(courseIds(u))} order by c.code`)
  .map((c) => ({ ...c, news: all('select id,title from announcements where course_id=? order by ts desc limit 2', c.id) })));
R('GET', '/api/courses/:id', ANY, ({ u, p }) => {
  const id = inCourse(u, p.id);
  return {
    ...one('select c.*, t.name teacher from courses c left join users t on t.id=c.teacher_id where c.id=?', id),
    materials: all('select * from materials where course_id=?', id),
    news: all('select * from announcements where course_id=? order by ts desc', id),
    assignments: all(`select a.*, s.ts sub_ts, s.text sub_text, s.grade, s.feedback, (select count(*) from submissions where assignment_id=a.id) subs
      from assignments a left join submissions s on s.assignment_id=a.id and s.user_id=? where a.course_id=? order by a.due`, u.id, id),
    exams: all('select * from exams where course_id=? order by date', id),
    outcomes: all('select o.*, (select count(*) from questions where outcome_id=o.id) nq from outcomes o where course_id=? order by code', id),
    questions: one('select count(*) n from questions where course_id=?', id).n,
    roster: roster(id),
  };
});
R('POST', '/api/courses', ['teacher'], ({ u, b }) => ({ id: Number(run('insert into courses(code,title,teacher_id) values(?,?,?)', need(b.code, 'mã môn'), need(b.title, 'tên khóa học'), u.id).lastInsertRowid) }));
R('POST', '/api/courses/:id/enroll', ['teacher'], ({ u, p, b }) => {
  const st = one("select id from users where email=? and role='student'", b.email);
  if (!st) throw err(400, 'Không tìm thấy sinh viên có email này');
  run('insert or ignore into enroll values(?,?)', st.id, teaches(u, p.id)); return OK;
});
R('POST', '/api/materials', ['teacher'], ({ u, b }) => {
  if (!/^https?:\/\//i.test(b.url || '')) throw err(400, 'URL phải bắt đầu bằng http:// hoặc https://');
  run('insert into materials(course_id,title,url) values(?,?,?)', teaches(u, b.course_id), need(b.title, 'tên học liệu'), b.url); return OK;
});
R('POST', '/api/assignments', ['teacher'], ({ u, b }) => {
  const pts = Number(b.points) || 10;
  run('insert into assignments(course_id,title,body,due,points) values(?,?,?,?,?)', teaches(u, b.course_id), need(b.title, 'tiêu đề'), String(b.body || ''), need(b.due, 'hạn nộp'), pts); return OK;
});
R('POST', '/api/assignments/:id/submit', ['student'], ({ u, p, b }) => {
  const a = one('select * from assignments where id=?', p.id);
  if (!a) throw err(404, 'Không có bài tập');
  inCourse(u, a.course_id);
  if (one('select grade from submissions where assignment_id=? and user_id=?', a.id, u.id)?.grade != null) throw err(409, 'Bài đã được chấm, không thể nộp lại');
  run('insert into submissions(assignment_id,user_id,text,ts) values(?,?,?,?) on conflict(assignment_id,user_id) do update set text=excluded.text, ts=excluded.ts', a.id, u.id, need(b.text, 'nội dung bài nộp'), Date.now());
  return OK;
});
R('GET', '/api/assignments/:id/submissions', ['teacher'], ({ u, p }) => {
  const a = one('select * from assignments where id=?', p.id);
  if (!a) throw err(404, 'Không có bài tập');
  teaches(u, a.course_id);
  return { assignment: a, rows: all('select u.name, u.email, s.* from enroll e join users u on u.id=e.user_id left join submissions s on s.assignment_id=? and s.user_id=u.id where e.course_id=? order by u.name', a.id, a.course_id) };
});
R('POST', '/api/submissions/:id/grade', ['teacher'], ({ u, p, b }) => {
  const s = one('select s.id, a.course_id, a.points from submissions s join assignments a on a.id=s.assignment_id where s.id=?', p.id);
  if (!s) throw err(404, 'Không có bài nộp');
  teaches(u, s.course_id);
  const g = Number(b.grade);
  if (b.grade === '' || !(g >= 0 && g <= s.points)) throw err(400, `Điểm phải từ 0 đến ${s.points}`);
  run('update submissions set grade=?, feedback=? where id=?', g, String(b.feedback || ''), s.id); return OK;
});
R('POST', '/api/outcomes', ['teacher'], ({ u, b }) => {
  run('insert into outcomes(course_id,code,text) values(?,?,?)', teaches(u, b.course_id), need(b.code, 'mã chuẩn đầu ra'), need(b.text, 'mô tả')); return OK;
});

// ---- Ngân hàng câu hỏi & thi trực tuyến ----
// ponytail: một ngân hàng câu hỏi / khóa, mọi kỳ thi dùng toàn bộ; thêm bảng exam_questions khi cần đề riêng từng kỳ.
R('POST', '/api/questions', ['teacher'], ({ u, b }) => {
  const cid = teaches(u, b.course_id), o = b.options;
  if (!Array.isArray(o) || o.length < 2 || o.some((x) => !String(x).trim()) || !Number.isInteger(b.answer) || b.answer < 0 || b.answer >= o.length) throw err(400, 'Câu hỏi không hợp lệ (≥2 đáp án, chọn đáp án đúng)');
  const oid = b.outcome_id ? one('select id from outcomes where id=? and course_id=?', b.outcome_id, cid)?.id ?? null : null;
  run('insert into questions(course_id,text,options,answer,outcome_id) values(?,?,?,?,?)', cid, need(b.text, 'nội dung câu hỏi'), JSON.stringify(o.map(String)), b.answer, oid); return OK;
});
R('POST', '/api/exams', ['teacher'], ({ u, b }) => {
  run('insert into exams(course_id,title,minutes,date) values(?,?,?,?)', teaches(u, b.course_id), need(b.title, 'tên kỳ thi'), Math.max(1, Number(b.minutes) || 10), b.date || day()); return OK;
});
R('GET', '/api/exams', ANY, ({ u }) => all(`select x.*, c.code, c.title course, (select count(*) from questions q where q.course_id=x.course_id) nq,
  s.id sid, s.status, s.score, s.deadline, s.submitted from exams x join courses c on c.id=x.course_id left join sessions s on s.exam_id=x.id and s.user_id=?
  where x.course_id in ${IN(courseIds(u))} order by x.date desc`, u.id));

R('POST', '/api/exams/:id/start', ['student'], ({ u, p }) => {
  const ex = one('select * from exams where id=?', p.id);
  if (!ex) throw err(404, 'Không có kỳ thi');
  inCourse(u, ex.course_id);
  if (ex.date && ex.date !== day()) throw err(403, `Kỳ thi chỉ mở trong ngày ${ex.date}`);
  const now = Date.now();
  let s = one('select * from sessions where exam_id=? and user_id=?', ex.id, u.id);
  if (s && (s.submitted || now > s.deadline)) throw err(409, 'Bạn đã làm bài thi này');
  if (s) logEvent(s.id, 'server', 'session_resume', {}); // tải lại trang / mất kết nối: cho làm tiếp nhưng gắn cờ
  else {
    s = { id: Number(run('insert into sessions(exam_id,user_id,started,deadline,status) values(?,?,?,?,?)', ex.id, u.id, now, now + ex.minutes * 60000, 'running').lastInsertRowid), deadline: now + ex.minutes * 60000 };
    logEvent(s.id, 'server', 'session_start', { exam: ex.title });
  }
  const questions = shuffle(all('select id,text,options from questions where course_id=?', ex.course_id)).map((q) => ({ ...q, options: JSON.parse(q.options) }));
  return { session_id: s.id, deadline: s.deadline, title: ex.title, questions };
});
R('POST', '/api/sessions/:id/submit', ['student'], ({ u, p, b }) => {
  const s = one('select * from sessions where id=? and user_id=?', p.id, u.id);
  if (!s) throw err(404, 'Không có phiên thi');
  if (s.submitted) throw err(409, 'Đã nộp bài');
  const now = Date.now(), late = now > s.deadline + 5000; // 5s ân hạn
  const qs = all('select id,answer from questions where course_id=(select course_id from exams where id=?)', s.exam_id);
  const answers = Object.fromEntries(qs.map((q) => [q.id, Number.isInteger(b.answers?.[q.id]) ? b.answers[q.id] : null]));
  const right = qs.filter((q) => answers[q.id] === q.answer).length;
  const score = qs.length ? Math.round(right / qs.length * 100) / 10 : 0;
  if (late) logEvent(s.id, 'server', 'late_submit', { overBy: now - s.deadline });
  logEvent(s.id, 'server', 'session_submit', { score });
  run('update sessions set submitted=?, score=?, status=?, answers=? where id=?', now, score, late ? 'late' : 'done', JSON.stringify(answers), s.id);
  return { score, right, total: qs.length, late };
});
R('GET', '/api/sessions', ANY, ({ u }) => all(`select s.id, s.status, s.score, s.started, s.deadline, s.submitted, s.review, x.title exam, x.course_id, us.name student,
  (select count(*) from events e where e.session_id=s.id and e.type in (${QA})) alerts,
  (select type from events e where e.session_id=s.id order by id desc limit 1) last_type,
  (select ts from events e where e.session_id=s.id order by id desc limit 1) last_ts
  from sessions s join exams x on x.id=s.exam_id join users us on us.id=s.user_id
  where ${u.role === 'student' ? 's.user_id=' + Number(u.id) : 'x.course_id in ' + IN(courseIds(u))} order by s.id desc`, ...ALERTS));
R('POST', '/api/sessions/:id/review', STAFF, ({ u, p, b }) => {
  const s = sessionFor(u, p.id);
  if (!['valid', 'suspicious', 'invalid'].includes(b.verdict)) throw err(400, 'Kết luận không hợp lệ');
  logEvent(s.id, 'server', 'review', { by: u.name, verdict: b.verdict, note: String(b.note || '').slice(0, 500) }); // kết luận cũng nằm trong chuỗi băm
  run('update sessions set review=? where id=?', b.verdict, s.id); return OK;
});

// Sự kiện: trình duyệt SV gửi (tab_blur...), thiết bị IoT/Edge gửi kèm header x-device-key.
R('POST', '/api/events', ['student', 'device'], ({ u, b }) => {
  const s = one('select * from sessions where id=?', b.session_id);
  if (!s) throw err(404, 'Không có phiên thi');
  if (u.role === 'student' && s.user_id !== u.id) throw err(403, 'Không phải phiên của bạn');
  if (s.submitted) throw err(409, 'Phiên đã kết thúc');
  const dev = u.role === 'device', detail = b.detail && typeof b.detail === 'object' ? b.detail : {};
  if (JSON.stringify(detail).length > 2000) throw err(413, 'detail quá lớn');
  // ponytail: độ trễ = ts - dts, giả định đồng hồ thiết bị đã đồng bộ NTP; lệch giờ sẽ làm sai số đo.
  logEvent(s.id, dev ? (b.source === 'iot' ? 'iot' : 'edge') : 'client', String(b.type || 'unknown').slice(0, 40), dev ? { ...detail, device: u.name } : detail, dev ? Number(b.dts) || 0 : 0);
  return OK;
});
R('GET', '/api/sessions/:id/events', STAFF, ({ u, p }) => {
  const s = sessionFor(u, p.id);
  return {
    session: { id: s.id, exam: s.exam, student: s.student, status: s.status, score: s.score, review: s.review },
    chain: verify(s.id),
    events: all('select id,ts,dts,source,type,detail from events where session_id=? order by id', s.id)
      .map((e) => ({ ...e, detail: JSON.parse(e.detail), alert: ALERTS.includes(e.type), latency: e.source === 'edge' || e.source === 'iot' ? e.ts - e.dts : null })),
  };
});
// Truy xuất sự kiện xuyên phiên thi
R('GET', '/api/events', STAFF, ({ u, q }) => {
  const lk = (k) => '%' + String(q.get(k) || '').replace(/[%_]/g, '') + '%';
  return all(`select e.id, e.session_id, e.ts, e.source, e.type, e.detail, us.name student, x.title exam from events e
    join sessions s on s.id=e.session_id join exams x on x.id=s.exam_id join users us on us.id=s.user_id
    where x.course_id in ${IN(courseIds(u))} and e.type like ? and e.source like ? and us.name like ? ${q.get('alerts') ? `and e.type in (${QA})` : ''}
    order by e.id desc limit 300`, lk('type'), lk('source'), lk('student'), ...(q.get('alerts') ? ALERTS : []));
});

// ---- Thiết bị IoT / Edge (tương đương "Application Authorization") ----
R('GET', '/api/devices', STAFF, () => all('select id,name,room,last_seen from devices order by room').map((d) => ({ ...d, online: Date.now() - (d.last_seen || 0) < 15000 })));
R('POST', '/api/devices', ['proctor'], ({ b }) => {
  const key = crypto.randomBytes(16).toString('hex'); // chỉ trả về một lần, DB lưu hash
  run('insert into devices(name,room,key) values(?,?,?)', need(b.name, 'tên thiết bị'), need(b.room, 'phòng'), sha(key)); return { key };
});
R('POST', '/api/devices/:id/revoke', ['proctor'], ({ p }) => run('delete from devices where id=?', p.id) && OK);
R('POST', '/api/ping', ['device'], () => OK); // heartbeat khi chưa có phiên thi

// ---- Kết quả học tập & chuẩn đầu ra ----
R('GET', '/api/grades', ANY, ({ u }) => {
  const ids = IN(courseIds(u)), mine = u.role === 'student' ? 'and us.id=' + Number(u.id) : '';
  return [
    ...all(`select c.code, c.title course, a.title item, 'Bài tập' kind, us.name student, s.grade score, a.points max, s.ts, a.due, s.feedback note
      from assignments a join courses c on c.id=a.course_id join enroll e on e.course_id=a.course_id join users us on us.id=e.user_id
      left join submissions s on s.assignment_id=a.id and s.user_id=us.id where a.course_id in ${ids} ${mine}`),
    ...all(`select c.code, c.title course, x.title item, 'Kỳ thi' kind, us.name student, s.score, 10 max, s.submitted ts, x.date due, s.review note
      from exams x join courses c on c.id=x.course_id join enroll e on e.course_id=x.course_id join users us on us.id=e.user_id
      left join sessions s on s.exam_id=x.id and s.user_id=us.id where x.course_id in ${ids} ${mine}`),
  ].sort((a, b) => a.code.localeCompare(b.code) || String(a.due).localeCompare(String(b.due)));
});
R('GET', '/api/goals', ANY, ({ u }) => {
  const ids = IN(courseIds(u));
  const qs = all('select id, answer, outcome_id from questions where outcome_id is not null');
  const sess = all(`select s.answers, x.course_id from sessions s join exams x on x.id=s.exam_id where s.answers is not null and x.course_id in ${ids} ${u.role === 'student' ? 'and s.user_id=' + Number(u.id) : ''}`)
    .map((s) => ({ ...s, answers: JSON.parse(s.answers) }));
  return all(`select o.*, c.code course_code, c.title course from outcomes o join courses c on c.id=o.course_id where o.course_id in ${ids} order by c.code, o.code`).map((o) => {
    let right = 0, total = 0;
    for (const s of sess) if (s.course_id === o.course_id)
      for (const q of qs) if (q.outcome_id === o.id && q.id in s.answers) { total++; right += s.answers[q.id] === q.answer; }
    return { ...o, questions: qs.filter((q) => q.outcome_id === o.id).length, attempts: total, pct: total ? Math.round(right / total * 100) : null };
  });
});

// ---- Báo cáo đánh giá hệ thống ----
R('GET', '/api/reports', STAFF, ({ u }) => {
  const sess = all(`select s.id, s.status, s.score, s.review, x.title exam from sessions s join exams x on x.id=s.exam_id where x.course_id in ${IN(courseIds(u))}`);
  const sids = IN(sess.map((s) => s.id));
  const lat = all(`select ts-dts l from events where session_id in ${sids} and source in ('edge','iot') order by l`).map((r) => r.l);
  const exams = {};
  for (const s of sess) (exams[s.exam] ??= []).push(s);
  const devices = all('select last_seen from devices');
  return {
    sessions: sess.length, running: sess.filter((s) => s.status === 'running').length, reviewed: sess.filter((s) => s.review).length,
    exams: Object.entries(exams).map(([exam, l]) => { const sc = l.filter((s) => s.score != null); return { exam, n: l.length, avg: sc.length ? +(sc.reduce((a, s) => a + s.score, 0) / sc.length).toFixed(2) : null }; }),
    alerts: all(`select type, count(*) n from events where session_id in ${sids} and type in (${QA}) group by type order by n desc`, ...ALERTS),
    sources: all(`select source, count(*) n from events where session_id in ${sids} group by source order by n desc`),
    latency: lat.length ? { n: lat.length, avg: Math.round(lat.reduce((a, b) => a + b, 0) / lat.length), p50: lat[Math.floor((lat.length - 1) / 2)], p95: lat[Math.floor((lat.length - 1) * 0.95)], max: lat.at(-1) } : null,
    broken: sess.map((s) => ({ id: s.id, ...verify(s.id) })).filter((r) => !r.ok),
    devices: { total: devices.length, online: devices.filter((d) => Date.now() - (d.last_seen || 0) < 15000).length },
  };
});

// ---- Cổng thông tin: thông báo, công việc, lịch, danh bạ, sổ địa chỉ, email ----
R('GET', '/api/announcements', ANY, ({ u }) => all(`select a.*, c.code, c.title course from announcements a left join courses c on c.id=a.course_id
  where a.course_id is null or a.course_id in ${IN(courseIds(u))} order by a.ts desc`));
// Giảng viên đăng cho khóa của mình; Phòng khảo thí đăng toàn trường.
R('POST', '/api/announcements', STAFF, ({ u, b }) => {
  run('insert into announcements(course_id,title,body,author,ts) values(?,?,?,?,?)', u.role === 'teacher' ? teaches(u, b.course_id) : null, need(b.title, 'tiêu đề'), String(b.body || ''), u.name, Date.now()); return OK;
});

R('GET', '/api/tasks', ANY, ({ u }) => all("select * from tasks where user_id=? order by done, due is null or due='', due", u.id));
R('POST', '/api/tasks', ANY, ({ u, b }) => run('insert into tasks(user_id,title,due) values(?,?,?)', u.id, need(b.title, 'tên công việc'), b.due || null) && OK);
R('POST', '/api/tasks/:id/toggle', ANY, ({ u, p }) => run('update tasks set done=1-done where id=? and user_id=?', p.id, u.id) && OK);

R('GET', '/api/calendar', ANY, ({ u }) => {
  const ids = IN(courseIds(u));
  return [
    ...all("select id, title, due date, 'task' kind, null course_id, done from tasks where user_id=? and due is not null and due != ''", u.id),
    ...all("select id, title, date, 'event' kind, null course_id, 0 done from cal where user_id=?", u.id),
    ...all(`select a.id, a.title, a.due date, 'assignment' kind, a.course_id, s.id is not null done from assignments a
      left join submissions s on s.assignment_id=a.id and s.user_id=? where a.course_id in ${ids}`, u.id),
    ...all(`select x.id, x.title, x.date, 'exam' kind, x.course_id, s.submitted is not null done from exams x
      left join sessions s on s.exam_id=x.id and s.user_id=? where x.course_id in ${ids}`, u.id),
  ];
});
R('POST', '/api/calendar', ANY, ({ u, b }) => run('insert into cal(user_id,title,date) values(?,?,?)', u.id, need(b.title, 'tên sự kiện'), need(b.date, 'ngày')) && OK);

R('GET', '/api/users', ANY, ({ q }) => {
  const f = ['name', 'email', 'role'].includes(q.get('f')) ? q.get('f') : 'name'; // whitelist: f goes into SQL
  return all(`select name,email,role from users where listed=1 and ${f} like ? ${q.get('role') ? 'and role=?' : ''} order by name`, pattern(q), ...(q.get('role') ? [q.get('role')] : []));
});
R('GET', '/api/contacts', ANY, ({ u, q }) => all(`select * from contacts where user_id=? and ${q.get('f') === 'email' ? 'email' : 'name'} like ? order by name`, u.id, pattern(q)));
R('POST', '/api/contacts', ANY, ({ u, b }) => run('insert into contacts(user_id,name,email,phone) values(?,?,?,?)', u.id, need(b.name, 'họ tên'), String(b.email || ''), String(b.phone || '')) && OK);
R('POST', '/api/contacts/:id/delete', ANY, ({ u, p }) => run('delete from contacts where id=? and user_id=?', p.id, u.id) && OK);

R('GET', '/api/messages', ANY, ({ u }) => ({
  inbox: all('select m.*, c.code from messages m left join courses c on c.id=m.course_id where to_email=? order by ts desc', u.email),
  sent: all('select m.*, c.code from messages m left join courses c on c.id=m.course_id where from_email=? order by ts desc', u.email),
}));
// Gửi email trong phạm vi khóa học: tất cả / sinh viên / giảng viên / một thành viên.
R('POST', '/api/messages', ANY, ({ u, b }) => {
  const cid = inCourse(u, b.course_id), subject = need(b.subject, 'tiêu đề'), members = roster(cid).filter((m) => m.email !== u.email);
  const to = { all: members, students: members.filter((m) => m.role === 'student'), teachers: members.filter((m) => m.role === 'teacher') }[b.to] ?? members.filter((m) => m.email === b.to);
  if (!to.length) throw err(400, 'Không có người nhận hợp lệ trong khóa học');
  for (const m of to) run('insert into messages(course_id,from_name,from_email,to_email,subject,body,ts) values(?,?,?,?,?,?,?)', cid, u.name, u.email, m.email, subject, String(b.body || ''), Date.now());
  return { sent: to.length };
});

const html = () => fs.readFileSync(new URL('./index.html', import.meta.url));
http.createServer(async (req, res) => {
  const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
  try {
    const path = req.url.split('?')[0];
    if (req.method === 'GET' && path === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(html()); }
    for (const [m, re, roles, fn] of routes) {
      const hit = m === req.method && re.exec(path);
      if (!hit) continue;
      let u = tokens.get((req.headers.authorization || '').slice(7));
      const key = req.headers['x-device-key'];
      if (!u && key) {
        const d = one('select id,name from devices where key=?', sha(String(key)));
        if (d) { run('update devices set last_seen=? where id=?', Date.now(), d.id); u = { role: 'device', ...d }; }
      }
      if (roles && (!u || !roles.includes(u.role))) throw err(u ? 403 : 401, 'Không có quyền');
      let raw = '';
      for await (const c of req) if ((raw += c).length > 1e6) throw err(413, 'Dữ liệu quá lớn');
      return send(200, await fn({ u, p: hit.groups || {}, q: new URL(req.url, 'http://x').searchParams, b: raw ? JSON.parse(raw) : {} }));
    }
    send(404, { error: 'not found' });
  } catch (e) { send(Number.isInteger(e.code) ? e.code : 400, { error: e.message }); }
}).listen(PORT, () => console.log(`SmartLMS: http://localhost:${PORT}  (gv|sv|kt@demo.vn / 123)`));
