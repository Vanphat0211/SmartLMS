-- SmartLMS v2 — ba vai trò:
--   admin    quản trị: cấp & quản lý tài khoản (Edge Function admin-users), thiết bị IoT/Edge, thông báo toàn trường,
--            giám sát & báo cáo toàn hệ thống (thay vai trò "cán bộ khảo thí" cũ).
--   teacher  giảng viên: khóa học, bài học, bài tập, ngân hàng câu hỏi, kỳ thi, chấm điểm, rà soát phiên thi khóa mình.
--   student  sinh viên: học bài, nộp bài, làm bài thi, xem điểm & tiến độ.
-- Thêm bài học (thay "học liệu") và tiến độ học tập. Áp lên DB đã chạy 20261112000000_init.sql, không mất dữ liệu.

-- =====================================================================
-- 1. Vai trò admin
-- =====================================================================
alter type public.user_role rename value 'proctor' to 'admin';
alter table public.profiles add column active boolean not null default true;  -- false = bị khóa (đồng bộ với ban trong Supabase Auth)

create or replace function public.is_staff() returns boolean language sql stable as $$
  select coalesce(public.my_role() in ('teacher', 'admin'), false) $$;

-- Khóa học "của tôi": GV dạy, SV ghi danh, admin thấy tất cả.
create or replace function public.my_course_ids() returns setof bigint
language sql stable security definer set search_path = public as $$
  select id from courses where teacher_id = auth.uid() or my_role() = 'admin'
  union
  select course_id from enrollments where user_id = auth.uid() $$;

create or replace function public.staff_of(c bigint) returns boolean language sql stable as $$
  select public.teaches(c) or coalesce(public.my_role() = 'admin', false) $$;

create or replace function public.register_device(p_name text, p_room text) returns text
language plpgsql security definer set search_path = public as $$
declare k text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if my_role() is distinct from 'admin' then raise exception 'Chỉ quản trị viên được cấp khóa thiết bị'; end if;
  insert into devices (name, room, key_hash) values (need(p_name, 'tên thiết bị'), need(p_room, 'phòng'), sha256_hex(k));
  return k;                                        -- chỉ trả về một lần
end $$;

drop policy announcements_insert on public.announcements;
create policy announcements_insert on public.announcements for insert to authenticated
  with check (author_id = auth.uid() and ((course_id is null and public.my_role() = 'admin') or public.teaches(course_id)));
drop policy devices_delete on public.devices;
create policy devices_delete on public.devices for delete to authenticated using (public.my_role() = 'admin');

-- Tài khoản do admin cấp qua Edge Function (service role). Vai trò nằm trong app_metadata — chỉ service role ghi được,
-- người dùng không tự đặt. Không có app_metadata.role (vd tự đăng ký khi chưa tắt sign-up) → sinh viên.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, name, email, role)
  values (new.id, coalesce(nullif(trim(new.raw_user_meta_data ->> 'name'), ''), split_part(new.email, '@', 1)), new.email,
          coalesce((new.raw_app_meta_data ->> 'role')::public.user_role, 'student'));
  return new;
end $$;

-- Đổi vai trò: chỉ admin, không tự đổi chính mình (tránh mất quyền quản trị), GV còn phụ trách khóa học thì giữ nguyên.
create function public.admin_set_role(p_user uuid, p_role public.user_role) returns void
language plpgsql security definer set search_path = public as $$
begin
  if my_role() is distinct from 'admin' then raise exception 'Chỉ quản trị viên được đổi vai trò'; end if;
  if p_user = auth.uid() then raise exception 'Không thể tự đổi vai trò của chính mình'; end if;
  if p_role <> 'teacher' and exists (select 1 from courses where teacher_id = p_user) then
    raise exception 'Giảng viên đang phụ trách khóa học — không thể đổi vai trò'; end if;
  update profiles set role = p_role where id = p_user;
  if not found then raise exception 'Không tìm thấy tài khoản'; end if;
end $$;

-- =====================================================================
-- 2. Bài học (thay "học liệu") & tiến độ
-- =====================================================================
alter table public.materials rename to lessons;
alter table public.lessons alter column url drop not null;              -- link tài liệu tùy chọn (vẫn chặn javascript:)
alter table public.lessons add column body text not null default '';    -- nội dung bài học
alter table public.lessons add column position int not null default 0;  -- thứ tự trong khóa
alter table public.lessons add column created_at timestamptz not null default now();
alter policy materials_read on public.lessons rename to lessons_read;
alter policy materials_write on public.lessons rename to lessons_write;

create table public.lesson_progress (                -- sinh viên đánh dấu "đã học"
  lesson_id bigint references public.lessons (id) on delete cascade,
  user_id uuid default auth.uid() references public.profiles (id) on delete cascade,
  done_at timestamptz not null default now(),
  primary key (lesson_id, user_id)
);
alter table public.lesson_progress enable row level security;
grant select, insert, delete on public.lesson_progress to authenticated;
grant all on public.lesson_progress to service_role;

create function public.lesson_course(l bigint) returns bigint
language sql stable security definer set search_path = public as $$
  select course_id from lessons where id = l $$;

create policy progress_read on public.lesson_progress for select to authenticated
  using (user_id = auth.uid() or public.staff_of(public.lesson_course(lesson_id)));
create policy progress_insert on public.lesson_progress for insert to authenticated
  with check (user_id = auth.uid() and public.my_role() = 'student' and public.in_course(public.lesson_course(lesson_id)));
create policy progress_delete on public.lesson_progress for delete to authenticated using (user_id = auth.uid());

-- Tiến độ học tập theo khóa: bài học đã học, bài tập đã nộp, kỳ thi đã nộp.
-- SV chỉ thấy dòng của mình; GV thấy lớp mình dạy; admin thấy tất cả. p_course null = mọi khóa.
create function public.course_progress(p_course bigint default null)
returns table (course_id bigint, user_id uuid, student text, lessons_done int, lessons_total int,
               assignments_done int, assignments_total int, exams_done int, exams_total int)
language sql stable security definer set search_path = public as $$
  select e.course_id, p.id, p.name,
    (select count(*) from lesson_progress lp join lessons l on l.id = lp.lesson_id where l.course_id = e.course_id and lp.user_id = p.id)::int,
    (select count(*) from lessons l where l.course_id = e.course_id)::int,
    (select count(*) from submissions s join assignments a on a.id = s.assignment_id where a.course_id = e.course_id and s.user_id = p.id)::int,
    (select count(*) from assignments a where a.course_id = e.course_id)::int,
    (select count(*) from exam_sessions s join exams x on x.id = s.exam_id
      where x.course_id = e.course_id and s.user_id = p.id and s.submitted_at is not null)::int,
    (select count(*) from exams x where x.course_id = e.course_id)::int
  from enrollments e join profiles p on p.id = e.user_id
  where p.role = 'student' and (p_course is null or e.course_id = p_course)
    and (p.id = auth.uid() or staff_of(e.course_id))
  order by e.course_id, p.name $$;

grant execute on function public.admin_set_role(uuid, public.user_role), public.lesson_course(bigint),
  public.course_progress(bigint) to authenticated, service_role;
