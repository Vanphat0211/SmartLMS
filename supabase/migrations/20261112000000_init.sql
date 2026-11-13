-- SmartLMS — LMS + giám sát thi trực tuyến (IoT + Edge AI).
-- Toàn bộ luật nghiệp vụ nằm ở đây: RLS cho đọc/ghi thường, hàm RPC (security definer) cho thao tác nhạy cảm.
-- Web app chỉ là client mỏng gọi Supabase.

-- =====================================================================
-- 1. Bảng
-- =====================================================================
create type public.user_role as enum ('student', 'teacher', 'proctor');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null default '',
  email text not null unique,
  role public.user_role not null default 'student',
  listed boolean not null default true          -- hiện trong Danh bạ người dùng
);

create table public.courses (
  id bigint generated always as identity primary key,
  code text not null check (trim(code) <> ''),
  title text not null check (trim(title) <> ''),
  teacher_id uuid not null default auth.uid() references public.profiles (id)
);

create table public.enrollments (
  user_id uuid references public.profiles (id) on delete cascade,
  course_id bigint references public.courses (id) on delete cascade,
  primary key (user_id, course_id)
);

create table public.materials (
  id bigint generated always as identity primary key,
  course_id bigint not null references public.courses (id) on delete cascade,
  title text not null check (trim(title) <> ''),
  url text not null check (url ~* '^https?://')   -- chặn javascript: URL
);

create table public.assignments (
  id bigint generated always as identity primary key,
  course_id bigint not null references public.courses (id) on delete cascade,
  title text not null check (trim(title) <> ''),
  body text not null default '',
  due_at timestamptz not null,
  points numeric not null default 10 check (points > 0)
);

create table public.submissions (
  id bigint generated always as identity primary key,
  assignment_id bigint not null references public.assignments (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  content text not null,
  submitted_at timestamptz not null default now(),
  grade numeric,
  feedback text not null default '',
  unique (assignment_id, user_id)
);

create table public.outcomes (                    -- chuẩn đầu ra học phần (CLO)
  id bigint generated always as identity primary key,
  course_id bigint not null references public.courses (id) on delete cascade,
  code text not null check (trim(code) <> ''),
  description text not null check (trim(description) <> ''),
  unique (course_id, code)
);

-- ponytail: một ngân hàng câu hỏi / khóa, mọi kỳ thi dùng toàn bộ; thêm bảng exam_questions khi cần đề riêng.
create table public.questions (
  id bigint generated always as identity primary key,
  course_id bigint not null references public.courses (id) on delete cascade,
  text text not null,
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) >= 2),
  outcome_id bigint references public.outcomes (id) on delete set null
);

create table public.question_keys (               -- đáp án tách bảng riêng để sinh viên không bao giờ đọc được
  question_id bigint primary key references public.questions (id) on delete cascade,
  answer int not null
);

create table public.exams (
  id bigint generated always as identity primary key,
  course_id bigint not null references public.courses (id) on delete cascade,
  title text not null check (trim(title) <> ''),
  minutes int not null check (minutes > 0),
  opens_at timestamptz not null,
  closes_at timestamptz not null,
  check (closes_at > opens_at)
);

create table public.exam_sessions (
  id bigint generated always as identity primary key,
  exam_id bigint not null references public.exams (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  started_at timestamptz not null default now(),
  deadline timestamptz not null,
  submitted_at timestamptz,
  score numeric,
  status text not null default 'running' check (status in ('running', 'done', 'late')),
  answers jsonb,
  review text check (review in ('valid', 'suspicious', 'invalid')),
  unique (exam_id, user_id)
);

-- Nhật ký sự kiện phiên thi, nối chuỗi băm theo seq. Không ai được sửa/xóa qua API.
create table public.events (
  id bigint generated always as identity primary key,
  session_id bigint not null references public.exam_sessions (id) on delete restrict,
  seq int not null,
  ts timestamptz not null,          -- giờ server nhận
  dts timestamptz,                  -- giờ thiết bị phát hiện (IoT/Edge)
  source text not null,             -- client | edge | iot | server
  type text not null,
  detail jsonb not null default '{}',
  prev text not null,
  hash text not null,
  unique (session_id, seq)
);

create table public.announcements (
  id bigint generated always as identity primary key,
  course_id bigint references public.courses (id) on delete cascade,   -- null = toàn trường
  title text not null check (trim(title) <> ''),
  body text not null default '',
  author_id uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);

create table public.tasks (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title text not null check (trim(title) <> ''),
  due date,
  done boolean not null default false
);

create table public.calendar_events (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  title text not null check (trim(title) <> ''),
  day date not null
);

create table public.contacts (
  id bigint generated always as identity primary key,
  user_id uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  name text not null check (trim(name) <> ''),
  email text not null default '',
  phone text not null default ''
);

create table public.messages (
  id bigint generated always as identity primary key,
  course_id bigint not null references public.courses (id) on delete cascade,
  from_id uuid not null references public.profiles (id) on delete cascade,
  to_id uuid not null references public.profiles (id) on delete cascade,
  subject text not null,
  body text not null default '',
  created_at timestamptz not null default now()
);

create table public.devices (                     -- thiết bị IoT / Edge được cấp quyền gửi sự kiện
  id bigint generated always as identity primary key,
  name text not null,
  room text not null,
  key_hash text not null unique,                  -- chỉ lưu sha256 của khóa
  last_seen timestamptz
);

-- =====================================================================
-- 2. Hàm tiện ích & quyền theo khóa học
-- =====================================================================
create function public.sha256_hex(s text) returns text language sql immutable as $$
  select encode(sha256(convert_to(s, 'UTF8')), 'hex') $$;

create function public.need(v text, label text) returns text language plpgsql immutable as $$
begin
  if coalesce(trim(v), '') = '' then raise exception 'Thiếu %', label; end if;
  return trim(v);
end $$;

create function public.my_role() returns public.user_role
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() $$;

create function public.is_staff() returns boolean language sql stable as $$
  select coalesce(public.my_role() in ('teacher', 'proctor'), false) $$;

-- Khóa học "của tôi": GV dạy, SV ghi danh, cán bộ khảo thí thấy tất cả.
create function public.my_course_ids() returns setof bigint
language sql stable security definer set search_path = public as $$
  select id from courses where teacher_id = auth.uid() or my_role() = 'proctor'
  union
  select course_id from enrollments where user_id = auth.uid() $$;

create function public.in_course(c bigint) returns boolean language sql stable as $$
  select exists (select 1 from public.my_course_ids() x where x = c) $$;

create function public.teaches(c bigint) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from courses where id = c and teacher_id = auth.uid()) $$;

create function public.staff_of(c bigint) returns boolean language sql stable as $$
  select public.teaches(c) or coalesce(public.my_role() = 'proctor', false) $$;

create function public.session_course(sid bigint) returns bigint
language sql stable security definer set search_path = public as $$
  select x.course_id from exam_sessions s join exams x on x.id = s.exam_id where s.id = sid $$;

create function public.assignment_course(aid bigint) returns bigint
language sql stable security definer set search_path = public as $$
  select course_id from assignments where id = aid $$;

create function public.shares_course(p uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from enrollments a join enrollments b using (course_id) where a.user_id = auth.uid() and b.user_id = p)
      or exists (select 1 from enrollments e join courses c on c.id = e.course_id
                 where (e.user_id = auth.uid() and c.teacher_id = p) or (e.user_id = p and c.teacher_id = auth.uid())) $$;

-- Sự kiện cần cán bộ rà soát. Hệ thống chỉ gắn cờ, không tự kết luận gian lận.
create function public.is_alert(t text) returns boolean language sql immutable as $$
  select t = any (array['multi_person', 'no_face', 'tab_blur', 'window_blur', 'copy_paste', 'fullscreen_exit',
                        'session_resume', 'late_submit', 'room_noise_high']) $$;

-- Tạo profile khi có user mới trong Supabase Auth. Vai trò luôn là student; vai trò cán bộ do quản trị gán.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, name, email)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'name', split_part(new.email, '@', 1)), new.email);
  return new;
end $$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- 3. Chuỗi băm nhật ký sự kiện
-- =====================================================================
create function public.event_hash(prev text, session_id bigint, seq int, ts timestamptz, source text, type text, detail jsonb)
returns text language sql stable as $$
  select public.sha256_hex(concat_ws('|', prev, session_id, seq, (extract(epoch from ts) * 1000000)::bigint, source, type, detail::text)) $$;

create function public.events_chain() returns trigger
language plpgsql security definer set search_path = public as $$
declare l_seq int; l_hash text;
begin
  perform pg_advisory_xact_lock(new.session_id);            -- tuần tự hóa ghi trong cùng phiên
  select seq, hash into l_seq, l_hash from events where session_id = new.session_id order by seq desc limit 1;
  new.seq := coalesce(l_seq, 0) + 1;
  new.prev := coalesce(l_hash, '');
  new.ts := clock_timestamp();
  new.detail := coalesce(new.detail, '{}');
  new.hash := event_hash(new.prev, new.session_id, new.seq, new.ts, new.source, new.type, new.detail);
  return new;
end $$;
create trigger events_chain before insert on public.events
  for each row execute function public.events_chain();

create function public.log_event(p_session bigint, p_source text, p_type text, p_detail jsonb default '{}', p_dts timestamptz default null)
returns void language sql security definer set search_path = public as $$
  insert into events (session_id, source, type, detail, dts) values (p_session, p_source, p_type, coalesce(p_detail, '{}'), p_dts) $$;

-- Kiểm tra toàn vẹn: sửa/xóa bất kỳ dòng nào làm gãy chuỗi. Chạy với quyền người gọi (RLS áp dụng).
create function public.verify_chain(p_session bigint) returns jsonb language plpgsql stable as $$
declare e record; last_hash text := '';
begin
  for e in select * from public.events where session_id = p_session order by seq loop
    if e.prev <> last_hash or e.hash <> public.event_hash(last_hash, e.session_id, e.seq, e.ts, e.source, e.type, e.detail) then
      return jsonb_build_object('ok', false, 'broken_at', e.seq);
    end if;
    last_hash := e.hash;
  end loop;
  return jsonb_build_object('ok', true);
end $$;

-- =====================================================================
-- 4. Row Level Security
-- =====================================================================
-- Cấp quyền bảng tường minh (project mới có thể tắt auto-grant); RLS bên dưới mới là lớp chặn thật.
grant usage on schema public to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.enrollments enable row level security;
alter table public.materials enable row level security;
alter table public.assignments enable row level security;
alter table public.submissions enable row level security;
alter table public.outcomes enable row level security;
alter table public.questions enable row level security;
alter table public.question_keys enable row level security;
alter table public.exams enable row level security;
alter table public.exam_sessions enable row level security;
alter table public.events enable row level security;
alter table public.announcements enable row level security;
alter table public.tasks enable row level security;
alter table public.calendar_events enable row level security;
alter table public.contacts enable row level security;
alter table public.messages enable row level security;
alter table public.devices enable row level security;

-- Hồ sơ: thấy người hiện trong danh bạ, cán bộ, bạn cùng khóa; chỉ tự sửa tên và quyền riêng tư.
create policy profiles_read on public.profiles for select to authenticated
  using (listed or role <> 'student' or id = auth.uid() or public.is_staff() or public.shares_course(id));
create policy profiles_update_self on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from anon, authenticated;
grant update (name, listed) on public.profiles to authenticated;

create policy courses_read on public.courses for select to authenticated using (teacher_id = auth.uid() or public.in_course(id));
create policy courses_insert on public.courses for insert to authenticated with check (teacher_id = auth.uid() and public.my_role() = 'teacher');
create policy courses_update on public.courses for update to authenticated using (teacher_id = auth.uid());

create policy enroll_read on public.enrollments for select to authenticated using (public.in_course(course_id));
create policy enroll_insert on public.enrollments for insert to authenticated
  with check (public.teaches(course_id) and exists (select 1 from public.profiles p where p.id = user_id and p.role = 'student'));
create policy enroll_delete on public.enrollments for delete to authenticated using (public.teaches(course_id));

create policy materials_read on public.materials for select to authenticated using (public.in_course(course_id));
create policy materials_write on public.materials for all to authenticated using (public.teaches(course_id)) with check (public.teaches(course_id));

create policy assignments_read on public.assignments for select to authenticated using (public.in_course(course_id));
create policy assignments_write on public.assignments for all to authenticated using (public.teaches(course_id)) with check (public.teaches(course_id));

create policy submissions_read on public.submissions for select to authenticated
  using (user_id = auth.uid() or public.staff_of(public.assignment_course(assignment_id)));

create policy outcomes_read on public.outcomes for select to authenticated using (public.in_course(course_id));
create policy outcomes_write on public.outcomes for all to authenticated using (public.teaches(course_id)) with check (public.teaches(course_id));

-- Sinh viên không đọc trực tiếp ngân hàng câu hỏi; nhận đề qua start_exam().
create policy questions_read on public.questions for select to authenticated using (public.staff_of(course_id));
create policy question_keys_read on public.question_keys for select to authenticated
  using (public.staff_of((select q.course_id from public.questions q where q.id = question_id)));

create policy exams_read on public.exams for select to authenticated using (public.in_course(course_id));
create policy exams_write on public.exams for all to authenticated using (public.teaches(course_id)) with check (public.teaches(course_id));

create policy sessions_read on public.exam_sessions for select to authenticated
  using (user_id = auth.uid() or public.staff_of(public.session_course(id)));

create policy events_read on public.events for select to authenticated using (public.staff_of(public.session_course(session_id)));

create policy announcements_read on public.announcements for select to authenticated
  using (course_id is null or public.in_course(course_id));
create policy announcements_insert on public.announcements for insert to authenticated
  with check (author_id = auth.uid() and ((course_id is null and public.my_role() = 'proctor') or public.teaches(course_id)));

create policy tasks_own on public.tasks for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy calendar_own on public.calendar_events for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy contacts_own on public.contacts for all to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy messages_read on public.messages for select to authenticated using (from_id = auth.uid() or to_id = auth.uid());

create policy devices_read on public.devices for select to authenticated using (public.is_staff());
create policy devices_delete on public.devices for delete to authenticated using (public.my_role() = 'proctor');
revoke select on public.devices from anon, authenticated;
grant select (id, name, room, last_seen) on public.devices to authenticated;

-- =====================================================================
-- 5. View cho giám sát & truy xuất (chạy với quyền người xem)
-- =====================================================================
create view public.session_overview with (security_invoker = true) as
select s.id, s.exam_id, x.title as exam, x.course_id, s.user_id, p.name as student, s.status, s.score,
       s.started_at, s.deadline, s.submitted_at, s.review,
       (select count(*) from public.events e where e.session_id = s.id and public.is_alert(e.type))::int as alerts,
       (select e.type from public.events e where e.session_id = s.id order by e.seq desc limit 1) as last_type,
       (select e.ts from public.events e where e.session_id = s.id order by e.seq desc limit 1) as last_ts
from public.exam_sessions s
join public.exams x on x.id = s.exam_id
join public.profiles p on p.id = s.user_id;

create view public.event_log with (security_invoker = true) as
select e.id, e.session_id, e.seq, e.ts, e.dts, e.source, e.type, e.detail, public.is_alert(e.type) as alert,
       case when e.dts is not null then (extract(epoch from e.ts - e.dts) * 1000)::int end as latency_ms,
       p.name as student, x.title as exam, x.course_id
from public.events e
join public.exam_sessions s on s.id = e.session_id
join public.exams x on x.id = s.exam_id
join public.profiles p on p.id = s.user_id;

grant select on public.session_overview, public.event_log to authenticated, service_role;

-- =====================================================================
-- 6. RPC — thi trực tuyến
-- =====================================================================
create function public.add_question(p_course bigint, p_text text, p_options jsonb, p_answer int, p_outcome bigint default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare qid bigint;
begin
  if not teaches(p_course) then raise exception 'Không phải khóa học của bạn'; end if;
  if jsonb_typeof(p_options) is distinct from 'array' or jsonb_array_length(p_options) < 2
     or exists (select 1 from jsonb_array_elements_text(p_options) o where trim(o) = '')
     or p_answer is null or p_answer < 0 or p_answer >= jsonb_array_length(p_options) then
    raise exception 'Câu hỏi không hợp lệ (≥ 2 đáp án, chọn đáp án đúng)';
  end if;
  insert into questions (course_id, text, options, outcome_id)
  values (p_course, need(p_text, 'nội dung câu hỏi'), p_options, (select id from outcomes where id = p_outcome and course_id = p_course))
  returning id into qid;
  insert into question_keys values (qid, p_answer);
  return qid;
end $$;

-- Bắt đầu hoặc làm tiếp (tải lại trang) — làm tiếp được gắn cờ session_resume. Đề trả về không kèm đáp án, xáo thứ tự.
create function public.start_exam(p_exam bigint) returns jsonb
language plpgsql security definer set search_path = public as $$
declare x exams; s exam_sessions;
begin
  select * into x from exams where id = p_exam;
  if x.id is null or my_role() is distinct from 'student' or not in_course(x.course_id) then
    raise exception 'Bạn không có quyền vào kỳ thi này';
  end if;
  if now() < x.opens_at or now() > x.closes_at then raise exception 'Kỳ thi chưa mở hoặc đã đóng'; end if;
  select * into s from exam_sessions where exam_id = x.id and user_id = auth.uid();
  if s.id is not null and (s.submitted_at is not null or now() > s.deadline) then raise exception 'Bạn đã làm bài thi này'; end if;
  if s.id is null then
    insert into exam_sessions (exam_id, user_id, deadline)
    values (x.id, auth.uid(), least(now() + make_interval(mins => x.minutes), x.closes_at)) returning * into s;
    perform log_event(s.id, 'server', 'session_start', jsonb_build_object('exam', x.title));
  else
    perform log_event(s.id, 'server', 'session_resume');
  end if;
  return jsonb_build_object('session_id', s.id, 'deadline', s.deadline, 'title', x.title, 'questions',
    coalesce((select jsonb_agg(jsonb_build_object('id', q.id, 'text', q.text, 'options', q.options) order by random())
              from questions q where q.course_id = x.course_id), '[]'));
end $$;

create function public.submit_exam(p_session bigint, p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s exam_sessions; ans jsonb; n_total int; n_right int; sc numeric; is_late boolean;
begin
  select * into s from exam_sessions where id = p_session and user_id = auth.uid() for update;
  if s.id is null then raise exception 'Không có phiên thi'; end if;
  if s.submitted_at is not null then raise exception 'Đã nộp bài'; end if;
  is_late := now() > s.deadline + interval '5 seconds';               -- 5 giây ân hạn
  select coalesce(jsonb_object_agg(q.id::text, case when jsonb_typeof(p_answers -> q.id::text) = 'number' then p_answers -> q.id::text end), '{}'),
         count(*), count(*) filter (where (p_answers -> q.id::text) = to_jsonb(k.answer))
    into ans, n_total, n_right
    from questions q join question_keys k on k.question_id = q.id
   where q.course_id = (select course_id from exams where id = s.exam_id);
  sc := case when n_total > 0 then round(n_right * 10.0 / n_total, 1) else 0 end;
  if is_late then
    perform log_event(s.id, 'server', 'late_submit', jsonb_build_object('over_ms', (extract(epoch from now() - s.deadline) * 1000)::bigint));
  end if;
  perform log_event(s.id, 'server', 'session_submit', jsonb_build_object('score', sc));
  update exam_sessions set submitted_at = now(), score = sc, status = case when is_late then 'late' else 'done' end, answers = ans
   where id = s.id;
  return jsonb_build_object('score', sc, 'right', n_right, 'total', n_total, 'late', is_late);
end $$;

-- Sự kiện từ trình duyệt sinh viên (chuyển tab, copy/paste, thoát toàn màn hình...)
create function public.log_client_event(p_session bigint, p_type text, p_detail jsonb default '{}') returns void
language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from exam_sessions where id = p_session and user_id = auth.uid() and submitted_at is null) then
    raise exception 'Phiên thi không hợp lệ hoặc đã kết thúc';
  end if;
  if length(coalesce(p_detail, '{}')::text) > 2000 then raise exception 'detail quá lớn'; end if;
  perform log_event(p_session, 'client', left(need(p_type, 'loại sự kiện'), 40), p_detail);
end $$;

create function public.review_session(p_session bigint, p_verdict text, p_note text default '') returns void
language plpgsql security definer set search_path = public as $$
begin
  if not staff_of(session_course(p_session)) then raise exception 'Không có quyền rà soát phiên này'; end if;
  if p_verdict is null or p_verdict not in ('valid', 'suspicious', 'invalid') then raise exception 'Kết luận không hợp lệ'; end if;
  -- kết luận cũng nằm trong chuỗi băm nên không thể sửa lặng lẽ
  perform log_event(p_session, 'server', 'review', jsonb_build_object(
    'by', (select name from profiles where id = auth.uid()), 'verdict', p_verdict, 'note', left(coalesce(p_note, ''), 500)));
  update exam_sessions set review = p_verdict where id = p_session;
end $$;

-- =====================================================================
-- 7. RPC — thiết bị IoT / Edge (gọi bằng anon key + khóa thiết bị)
-- =====================================================================
create function public.device_auth(p_key text) returns public.devices
language plpgsql security definer set search_path = public as $$
declare d devices;
begin
  update devices set last_seen = now() where key_hash = sha256_hex(coalesce(p_key, '')) returning * into d;
  if d.id is null then raise exception 'Khóa thiết bị không hợp lệ' using errcode = '28000'; end if;
  return d;
end $$;

-- ponytail: độ trễ = ts - dts, giả định đồng hồ thiết bị đã đồng bộ NTP; lệch giờ sẽ làm sai số đo.
create function public.device_event(p_key text, p_session bigint, p_source text, p_type text, p_detail jsonb default '{}', p_dts bigint default null)
returns void language plpgsql security definer set search_path = public as $$
declare d devices; det jsonb := case when jsonb_typeof(p_detail) = 'object' then p_detail else '{}' end;
begin
  d := device_auth(p_key);
  if not exists (select 1 from exam_sessions where id = p_session and submitted_at is null) then
    raise exception 'Phiên thi không hợp lệ hoặc đã kết thúc';
  end if;
  if length(det::text) > 2000 then raise exception 'detail quá lớn'; end if;
  perform log_event(p_session, case when p_source = 'iot' then 'iot' else 'edge' end, left(need(p_type, 'loại sự kiện'), 40),
                    det || jsonb_build_object('device', d.name), to_timestamp(p_dts / 1000.0));
end $$;

create function public.device_ping(p_key text) returns void
language plpgsql security definer set search_path = public as $$
begin perform device_auth(p_key); end $$;

create function public.register_device(p_name text, p_room text) returns text
language plpgsql security definer set search_path = public as $$
declare k text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if my_role() is distinct from 'proctor' then raise exception 'Chỉ cán bộ khảo thí được cấp khóa thiết bị'; end if;
  insert into devices (name, room, key_hash) values (need(p_name, 'tên thiết bị'), need(p_room, 'phòng'), sha256_hex(k));
  return k;                                        -- chỉ trả về một lần
end $$;

-- =====================================================================
-- 8. RPC — bài tập, email, khóa học
-- =====================================================================
create function public.submit_assignment(p_assignment bigint, p_content text) returns void
language plpgsql security definer set search_path = public as $$
declare a assignments;
begin
  select * into a from assignments where id = p_assignment;
  if a.id is null or my_role() is distinct from 'student' or not in_course(a.course_id) then
    raise exception 'Bạn không có quyền nộp bài này';
  end if;
  if exists (select 1 from submissions where assignment_id = a.id and user_id = auth.uid() and grade is not null) then
    raise exception 'Bài đã được chấm, không thể nộp lại';
  end if;
  insert into submissions (assignment_id, user_id, content) values (a.id, auth.uid(), need(p_content, 'nội dung bài nộp'))
  on conflict (assignment_id, user_id) do update set content = excluded.content, submitted_at = now();
end $$;

create function public.grade_submission(p_submission bigint, p_grade numeric, p_feedback text default '') returns void
language plpgsql security definer set search_path = public as $$
declare c bigint; pts numeric;
begin
  select a.course_id, a.points into c, pts from submissions s join assignments a on a.id = s.assignment_id where s.id = p_submission;
  if not found or not teaches(c) then raise exception 'Không có quyền chấm bài này'; end if;
  if p_grade is null or p_grade < 0 or p_grade > pts then raise exception 'Điểm phải từ 0 đến %', pts; end if;
  update submissions set grade = p_grade, feedback = coalesce(p_feedback, '') where id = p_submission;
end $$;

-- Thành viên khóa học (kể cả người ẩn khỏi danh bạ) — chỉ thành viên/cán bộ của khóa mới xem được.
create function public.course_members(p_course bigint)
returns table (id uuid, name text, email text, role public.user_role)
language sql stable security definer set search_path = public as $$
  select p.id, p.name, p.email, p.role from profiles p
  where in_course(p_course)
    and (p.id in (select user_id from enrollments where course_id = p_course) or p.id = (select teacher_id from courses where id = p_course))
  order by p.role desc, p.name $$;

-- Gửi email trong phạm vi khóa: 'all' | 'students' | 'teachers' | email một thành viên.
create function public.send_message(p_course bigint, p_to text, p_subject text, p_body text default '') returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not in_course(p_course) then raise exception 'Bạn không thuộc khóa học này'; end if;
  insert into messages (course_id, from_id, to_id, subject, body)
  select p_course, auth.uid(), m.id, need(p_subject, 'tiêu đề'), coalesce(p_body, '')
    from course_members(p_course) m
   where m.id <> auth.uid()
     and (p_to = 'all' or (p_to = 'students' and m.role = 'student') or (p_to = 'teachers' and m.role = 'teacher') or m.email = p_to);
  get diagnostics n = row_count;
  if n = 0 then raise exception 'Không có người nhận hợp lệ trong khóa học'; end if;
  return n;
end $$;

-- =====================================================================
-- 9. RPC — tổng hợp (chạy với quyền người gọi trừ khi cần đọc đáp án)
-- =====================================================================
-- Lịch & hạn: công việc, sự kiện cá nhân, hạn bài tập, kỳ thi. day = cả ngày, at = có giờ.
create function public.my_agenda()
returns table (kind text, ref_id bigint, course_id bigint, title text, day date, at timestamptz, done boolean)
language sql stable as $$
  select 'task', id, null::bigint, title, due, null::timestamptz, done from public.tasks where user_id = auth.uid() and due is not null
  union all
  select 'event', id, null, title, day, null, false from public.calendar_events where user_id = auth.uid()
  union all
  select 'assignment', a.id, a.course_id, a.title, null, a.due_at,
         exists (select 1 from public.submissions s where s.assignment_id = a.id and s.user_id = auth.uid())
    from public.assignments a
  union all
  select 'exam', x.id, x.course_id, x.title, null, x.opens_at,
         exists (select 1 from public.exam_sessions s where s.exam_id = x.id and s.user_id = auth.uid() and s.submitted_at is not null)
    from public.exams x $$;

create function public.grade_book()
returns table (course_id bigint, code text, course text, item text, kind text, student text, score numeric, max_score numeric,
               done_at timestamptz, due timestamptz, note text)
language sql stable as $$
  select * from (
    select c.id, c.code, c.title, a.title, 'Bài tập', p.name, sb.grade, a.points, sb.submitted_at, a.due_at, sb.feedback
      from public.assignments a join public.courses c on c.id = a.course_id
      join public.enrollments e on e.course_id = a.course_id join public.profiles p on p.id = e.user_id
      left join public.submissions sb on sb.assignment_id = a.id and sb.user_id = e.user_id
     where public.is_staff() or e.user_id = auth.uid()
    union all
    select c.id, c.code, c.title, x.title, 'Kỳ thi', p.name, s.score, 10, s.submitted_at, x.closes_at, s.review
      from public.exams x join public.courses c on c.id = x.course_id
      join public.enrollments e on e.course_id = x.course_id join public.profiles p on p.id = e.user_id
      left join public.exam_sessions s on s.exam_id = x.id and s.user_id = e.user_id
     where public.is_staff() or e.user_id = auth.uid()
  ) g order by 2, 10, 6 $$;

-- Mức đạt chuẩn đầu ra: tỉ lệ trả lời đúng trên câu hỏi gắn CLO (SV: của mình; cán bộ: cả lớp).
create function public.outcome_performance()
returns table (outcome_id bigint, course_code text, course text, code text, description text, questions int, attempts int, pct int)
language sql stable security definer set search_path = public as $$
  with qa as (
    select q.outcome_id, (s.answers -> q.id::text) = to_jsonb(k.answer) as ok
      from exam_sessions s join exams x on x.id = s.exam_id
      join questions q on q.course_id = x.course_id join question_keys k on k.question_id = q.id
     where s.answers ? q.id::text and q.outcome_id is not null and in_course(x.course_id)
       and (is_staff() or s.user_id = auth.uid()))
  select o.id, c.code, c.title, o.code, o.description,
         (select count(*) from questions q where q.outcome_id = o.id)::int,
         (select count(*) from qa where qa.outcome_id = o.id)::int,
         (select round(100.0 * count(*) filter (where qa.ok) / nullif(count(*), 0)) from qa where qa.outcome_id = o.id)::int
    from outcomes o join courses c on c.id = o.course_id
   where in_course(o.course_id)
   order by c.code, o.code $$;

-- Báo cáo đánh giá hệ thống cho cán bộ.
create function public.system_report() returns jsonb language plpgsql stable as $$
begin
  if not public.is_staff() then raise exception 'Không có quyền'; end if;
  return (
    with s as (select * from public.session_overview),
         ev as (select * from public.event_log),
         lat as (select latency_ms as l from ev where source in ('edge', 'iot') and latency_ms is not null)
    select jsonb_build_object(
      'sessions', (select count(*) from s),
      'running', (select count(*) from s where status = 'running'),
      'reviewed', (select count(*) from s where review is not null),
      'exams', coalesce((select jsonb_agg(t) from (select exam, count(*) as n, round(avg(score), 2) as avg from s group by exam) t), '[]'),
      'alerts', coalesce((select jsonb_agg(t) from (select type, count(*) as n from ev where alert group by type order by n desc) t), '[]'),
      'sources', coalesce((select jsonb_agg(t) from (select source, count(*) as n from ev group by source order by n desc) t), '[]'),
      'latency', (select case when count(*) > 0 then jsonb_build_object('n', count(*), 'avg', round(avg(l)),
                    'p50', percentile_disc(0.5) within group (order by l), 'p95', percentile_disc(0.95) within group (order by l), 'max', max(l)) end
                  from lat),
      'broken', coalesce((select jsonb_agg(jsonb_build_object('id', v.id, 'broken_at', v.r ->> 'broken_at'))
                          from (select s.id, public.verify_chain(s.id) as r from s) v where not (v.r ->> 'ok')::boolean), '[]'),
      'devices', (select jsonb_build_object('total', count(*), 'online', count(*) filter (where last_seen > now() - interval '15 seconds'))
                  from public.devices))
  );
end $$;

-- =====================================================================
-- 10. Quyền gọi hàm
-- =====================================================================
grant execute on all functions in schema public to authenticated, service_role;
revoke execute on function public.log_event(bigint, text, text, jsonb, timestamptz) from public, anon, authenticated;
revoke execute on function public.device_auth(text) from public, anon, authenticated;
grant execute on function public.device_event(text, bigint, text, text, jsonb, bigint), public.device_ping(text) to anon, authenticated;
