-- SmartLMS v3
--   • Môn học (lớp học phần) do admin tạo/sửa/xóa theo học kỳ + nhóm (ca), phân công giảng viên, điều chuyển sinh viên.
--   • Nhập đăng ký môn từ edu: sinh viên tự có các môn đã đăng ký trong kỳ (kể cả khi tài khoản được tạo sau).
--   • Điểm bài thi: chấm tự động khi nộp; giảng viên chọn cho xem điểm ngay hoặc ẩn đến khi công bố — chặn ở DB.
--   • Kết quả theo từng bài thi cho giảng viên.

-- =====================================================================
-- 1. Lớp học phần: mỗi dòng courses = một nhóm (ca) của một môn trong một học kỳ
-- =====================================================================
alter table public.courses
  add column program text not null default '',                         -- ngành / chương trình đào tạo
  add column term text not null default '2026-1' check (term ~ '^[0-9]{4}-[1-3]$'),  -- học kỳ: <năm>-<kỳ 1..3>
  add column section text not null default '01' check (trim(section) <> ''),        -- nhóm / ca (như mã nhóm trên edu)
  add column schedule text not null default '',                        -- lịch: vd "Thứ 2 · Ca 1 (07:00–09:30)"
  add column room text not null default '';
alter table public.courses alter column term drop default;
alter table public.courses alter column teacher_id drop not null, alter column teacher_id drop default;  -- lớp chưa phân công GV
alter table public.courses add constraint courses_code_term_section_key unique (code, term, section);

drop policy courses_insert on public.courses;
drop policy courses_update on public.courses;
create policy courses_admin on public.courses for all to authenticated
  using (public.my_role() = 'admin')
  with check (public.my_role() = 'admin' and (teacher_id is null
              or exists (select 1 from public.profiles p where p.id = teacher_id and p.role = 'teacher')));

-- Ghi danh / điều chuyển sinh viên: chỉ admin (giảng viên chỉ xem danh sách lớp).
drop policy enroll_insert on public.enrollments;
drop policy enroll_delete on public.enrollments;
create policy enroll_admin on public.enrollments for all to authenticated
  using (public.my_role() = 'admin')
  with check (public.my_role() = 'admin' and exists (select 1 from public.profiles p where p.id = user_id and p.role = 'student'));

-- =====================================================================
-- 2. Đăng ký môn từ edu
-- =====================================================================
create table public.registrations (                 -- danh sách đăng ký đã nhập (theo email) — nguồn để tự ghi danh
  email text not null check (email = lower(trim(email)) and email like '%_@_%'),
  course_id bigint not null references public.courses (id) on delete cascade,
  imported_at timestamptz not null default now(),
  primary key (email, course_id)
);
alter table public.registrations enable row level security;
grant select, insert, update, delete on public.registrations to authenticated;
grant all on public.registrations to service_role;
create policy registrations_admin on public.registrations for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

-- Tài khoản mới: tạo hồ sơ + tự ghi danh các môn đã đăng ký bên edu trước đó.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, name, email, role)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1)), new.email,
          coalesce((new.raw_app_meta_data ->> 'role')::public.user_role, 'student'));
  insert into enrollments (user_id, course_id)
  select new.id, r.course_id from registrations r where r.email = lower(new.email)
  on conflict do nothing;
  return new;
end $$;

-- Nhập đăng ký: mỗi dòng {email, code, section?} của học kỳ p_term. Có tài khoản SV → ghi danh ngay;
-- chưa có → lưu lại, tự ghi danh khi tài khoản được tạo. Chạy lại nhiều lần không trùng.
-- status: enrolled | pending (chưa có tài khoản) | no_course | ambiguous (môn có nhiều nhóm, thiếu nhóm) | not_student | invalid
create function public.import_registrations(p_term text, p_rows jsonb)
returns table (line int, email text, code text, section text, status text)
language plpgsql security definer set search_path = public as $$
declare r jsonb; i int := 0; n int; cid bigint; v_email text; v_code text; v_section text; v_status text; u profiles;
begin
  if my_role() is distinct from 'admin' then raise exception 'Chỉ quản trị viên được nhập đăng ký môn'; end if;
  if p_term is null or p_term !~ '^[0-9]{4}-[1-3]$' then raise exception 'Học kỳ không hợp lệ (vd 2026-1)'; end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    i := i + 1;
    v_email := lower(trim(r ->> 'email'));
    v_code := upper(trim(r ->> 'code'));
    v_section := nullif(trim(r ->> 'section'), '');
    if v_email is null or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+$' or coalesce(v_code, '') = '' then
      v_status := 'invalid';
    else
      select count(*), min(c.id) into n, cid from courses c
       where upper(c.code) = v_code and c.term = p_term and (v_section is null or c.section = v_section);
      if n = 0 then v_status := 'no_course';
      elsif n > 1 then v_status := 'ambiguous';
      else
        insert into registrations (email, course_id) values (v_email, cid) on conflict do nothing;
        select * into u from profiles p where p.email = v_email;
        if u.id is null then v_status := 'pending';
        elsif u.role <> 'student' then v_status := 'not_student';
        else
          insert into enrollments (user_id, course_id) values (u.id, cid) on conflict do nothing;
          v_status := 'enrolled';
        end if;
      end if;
    end if;
    line := i; email := v_email; code := v_code; section := v_section; status := v_status;
    return next;
  end loop;
end $$;

-- Điều chuyển sinh viên sang lớp (ca) khác — giữ đăng ký edu đồng bộ để tài khoản tạo lại không bị ghi danh nhầm lớp cũ.
create function public.move_student(p_user uuid, p_from bigint, p_to bigint) returns void
language plpgsql security definer set search_path = public as $$
declare e text := (select email from profiles where id = p_user);
begin
  if my_role() is distinct from 'admin' then raise exception 'Chỉ quản trị viên được chuyển lớp'; end if;
  delete from enrollments where user_id = p_user and course_id = p_from;
  if not found then raise exception 'Sinh viên không thuộc lớp này'; end if;
  insert into enrollments (user_id, course_id) values (p_user, p_to) on conflict do nothing;
  delete from registrations where email = e and course_id = p_from;
  insert into registrations (email, course_id) values (e, p_to) on conflict do nothing;
end $$;

-- =====================================================================
-- 3. Điểm bài thi: cho xem ngay / ẩn đến khi công bố
-- =====================================================================
alter table public.exams add column show_score boolean not null default true;  -- false = SV chưa được xem điểm

-- Điểm của một phiên theo quyền xem: GV/admin của lớp luôn thấy; SV chỉ thấy điểm của mình khi bài thi cho xem.
create function public.session_score(sid bigint) returns numeric
language sql stable security definer set search_path = public as $$
  select case when staff_of(x.course_id) or (s.user_id = auth.uid() and x.show_score) then s.score end
    from exam_sessions s join exams x on x.id = s.exam_id where s.id = sid $$;

-- Không ai đọc thẳng cột score qua API nữa — mọi chỗ đọc điểm đi qua session_score().
revoke select on public.exam_sessions from anon, authenticated;
grant select (id, exam_id, user_id, started_at, deadline, submitted_at, status, answers, review) on public.exam_sessions to authenticated;

create or replace view public.session_overview with (security_invoker = true) as
select s.id, s.exam_id, x.title as exam, x.course_id, s.user_id, p.name as student, s.status, public.session_score(s.id) as score,
       s.started_at, s.deadline, s.submitted_at, s.review,
       (select count(*) from public.events e where e.session_id = s.id and public.is_alert(e.type))::int as alerts,
       (select e.type from public.events e where e.session_id = s.id order by e.seq desc limit 1) as last_type,
       (select e.ts from public.events e where e.session_id = s.id order by e.seq desc limit 1) as last_ts
from public.exam_sessions s
join public.exams x on x.id = s.exam_id
join public.profiles p on p.id = s.user_id;

create or replace function public.grade_book()
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
    select c.id, c.code, c.title, x.title, 'Kỳ thi', p.name, public.session_score(s.id), 10, s.submitted_at, x.closes_at, s.review
      from public.exams x join public.courses c on c.id = x.course_id
      join public.enrollments e on e.course_id = x.course_id join public.profiles p on p.id = e.user_id
      left join public.exam_sessions s on s.exam_id = x.id and s.user_id = e.user_id
     where public.is_staff() or e.user_id = auth.uid()
  ) g order by 2, 10, 6 $$;

-- Mức đạt CLO của SV cũng lộ đúng/sai → bỏ các bài thi đang ẩn điểm khỏi phần của SV.
create or replace function public.outcome_performance()
returns table (outcome_id bigint, course_code text, course text, code text, description text, questions int, attempts int, pct int)
language sql stable security definer set search_path = public as $$
  with qa as (
    select q.outcome_id, (s.answers -> q.id::text) = to_jsonb(k.answer) as ok
      from exam_sessions s join exams x on x.id = s.exam_id
      join questions q on q.course_id = x.course_id join question_keys k on k.question_id = q.id
     where s.answers ? q.id::text and q.outcome_id is not null and in_course(x.course_id)
       and (is_staff() or (s.user_id = auth.uid() and x.show_score)))
  select o.id, c.code, c.title, o.code, o.description,
         (select count(*) from questions q where q.outcome_id = o.id)::int,
         (select count(*) from qa where qa.outcome_id = o.id)::int,
         (select round(100.0 * count(*) filter (where qa.ok) / nullif(count(*), 0)) from qa where qa.outcome_id = o.id)::int
    from outcomes o join courses c on c.id = o.course_id
   where in_course(o.course_id)
   order by c.code, o.code $$;

-- Nộp bài: vẫn chấm ngay; chỉ trả điểm về khi bài thi cho xem điểm.
create or replace function public.submit_exam(p_session bigint, p_answers jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare s exam_sessions; ans jsonb; n_total int; n_right int; sc numeric; is_late boolean; visible boolean;
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
  select show_score into visible from exams where id = s.exam_id;
  if not visible then return jsonb_build_object('hidden', true, 'late', is_late); end if;
  return jsonb_build_object('score', sc, 'right', n_right, 'total', n_total, 'late', is_late);
end $$;

-- Kết quả một bài thi cho GV/admin: mọi sinh viên của lớp, kể cả chưa làm (status 'absent').
create function public.exam_results(p_exam bigint)
returns table (user_id uuid, student text, email text, session_id bigint, status text, score numeric,
               started_at timestamptz, submitted_at timestamptz, alerts int, review text)
language sql stable as $$
  select p.id, p.name, p.email, s.id, coalesce(s.status, 'absent'), s.score, s.started_at, s.submitted_at, coalesce(s.alerts, 0), s.review
    from public.exams x
    join public.enrollments e on e.course_id = x.course_id
    join public.profiles p on p.id = e.user_id and p.role = 'student'
    left join public.session_overview s on s.exam_id = x.id and s.user_id = p.id
   where x.id = p_exam and public.staff_of(x.course_id)
   order by p.name $$;

grant execute on function public.import_registrations(text, jsonb), public.move_student(uuid, bigint, bigint),
  public.session_score(bigint), public.exam_results(bigint) to authenticated, service_role;
