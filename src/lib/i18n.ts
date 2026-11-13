// Song ngữ Việt / Anh. Câu tiếng Việt trong code chính là khóa tra cứu; bản dịch nằm ở en.ts (thiếu → hiện tiếng Việt).
import { en } from './en';

const saved = (() => { try { return localStorage.getItem('lang'); } catch { return null; } })();
export const lang: 'vi' | 'en' = saved === 'en' ? 'en' : 'vi';
export const locale = lang === 'en' ? 'en-GB' : 'vi-VN';
document.documentElement.lang = lang;

/** t('Đã nộp {0}/{1}', a, b) */
export const t = (s: string, ...args: unknown[]) =>
  (lang === 'en' ? en[s] ?? s : s).replace(/\{(\d+)\}/g, (m, i: string) => (+i < args.length ? String(args[+i]) : m));

/** Nhãn nút chuyển — luôn viết bằng ngôn ngữ sẽ chuyển sang. */
export const LANG_SWITCH = lang === 'en' ? 'Tiếng Việt' : 'English';

// ponytail: đổi ngôn ngữ = tải lại trang, nên mọi chuỗi (kể cả hằng cấp module như ROLE) dịch lại một lần. Chuyển sang context nếu cần đổi mà không mất dữ liệu form đang nhập.
export const toggleLang = () => {
  try { localStorage.setItem('lang', lang === 'en' ? 'vi' : 'en'); } catch { /* trình duyệt chặn lưu trữ: giữ ngôn ngữ hiện tại */ }
  location.reload();
};
