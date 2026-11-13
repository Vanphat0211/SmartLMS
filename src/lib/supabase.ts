import { createClient } from '@supabase/supabase-js';
import { t } from './i18n';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configured = Boolean(url && key);
export const supabase = createClient(url || 'http://localhost:54321', key || 'missing-key');

// Mã lỗi Postgres → thông báo dễ hiểu. Lỗi do RPC tự raise (P0001) là câu tiếng Việt → dịch qua t() nếu có trong en.ts.
const FRIENDLY: Record<string, string> = {
  '23514': t('Dữ liệu không hợp lệ (thiếu hoặc sai định dạng).'),
  '23502': t('Thiếu dữ liệu bắt buộc.'),
  '23505': t('Dữ liệu đã tồn tại.'),
  '42501': t('Bạn không có quyền thực hiện thao tác này.'),
  '23503': t('Không thể xóa: dữ liệu đang được sử dụng (vd môn đã có bài thi với nhật ký giám sát).'),
  PGRST116: t('Không tìm thấy dữ liệu hoặc bạn không có quyền xem.'),
};

type Result = { data: unknown; error: { code?: string; message: string } | null };

/** Chờ một truy vấn Supabase, trả về data hoặc ném lỗi đã dịch. (maybeSingle() vẫn có thể trả null lúc chạy.) */
export async function q<R extends Result>(req: PromiseLike<R>): Promise<NonNullable<R['data']>> {
  const { data, error } = await req;
  if (error) throw new Error(FRIENDLY[error.code ?? ''] ?? t(error.message));
  return data as NonNullable<R['data']>;
}

/**
 * Quan hệ nhiều-một nhúng (vd `teacher:profiles(name)`) trả về object lúc chạy, nhưng khi chưa sinh type DB
 * (`supabase gen types`) TypeScript coi là mảng — helper này chấp nhận cả hai.
 */
export const first = <T,>(x: T | T[] | null | undefined): T | undefined => (Array.isArray(x) ? x[0] : x ?? undefined);

/** Gọi Edge Function admin-users (quản trị tài khoản — cần service role nên chạy ở server, không ở trình duyệt). */
export async function adminUsers<T = { ok: boolean }>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (!error) return data as T;
  const res = (error as { context?: unknown }).context;
  const status = res instanceof Response ? res.status : 0;
  if (status === 0 || status === 404) throw new Error(t('Chưa triển khai Edge Function admin-users (xem README, mục Quản trị tài khoản).'));
  throw new Error(t(await (res as Response).json().then((j) => j.error ?? j.message, () => error.message)));
}

/** Gọi hàm RPC trong Postgres. */
export const rpc = async <T = unknown>(fn: string, args?: Record<string, unknown>) => (await q(supabase.rpc(fn, args))) as T;
