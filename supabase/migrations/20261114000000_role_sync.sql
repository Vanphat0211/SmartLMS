-- Sửa: tài khoản admin cấp qua Edge Function luôn thành sinh viên.
-- Supabase Auth (Admin API createUser) INSERT user trước, rồi mới ghi app_metadata bằng một lệnh UPDATE riêng
-- (cùng giao dịch), nên trigger AFTER INSERT không thấy app_metadata.role. Đồng bộ thêm khi role trong app_metadata đổi.
-- Chỉ service role / Admin API ghi được app_metadata — người dùng không tự đặt được — nên an toàn để làm nguồn vai trò.
create function public.sync_role_from_app_metadata() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update profiles set role = (new.raw_app_meta_data ->> 'role')::public.user_role where id = new.id;
  return new;
end $$;

create trigger on_auth_user_role_changed after update of raw_app_meta_data on auth.users
  for each row when (new.raw_app_meta_data ? 'role'
                     and new.raw_app_meta_data ->> 'role' is distinct from old.raw_app_meta_data ->> 'role')
  execute function public.sync_role_from_app_metadata();
