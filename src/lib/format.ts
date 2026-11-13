import { locale, t } from './i18n';
import type { Progress } from './types';
export type Role = 'student' | 'teacher' | 'admin';

export const ROLE: Record<Role, string> = { student: t('Sinh viên'), teacher: t('Giảng viên'), admin: t('Quản trị viên') };

export const REVIEW: Record<string, { label: string; cls: string }> = {
  valid: { label: t('Hợp lệ'), cls: 'ok' },
  suspicious: { label: t('Nghi vấn'), cls: 'amber' },
  invalid: { label: t('Không hợp lệ'), cls: 'bad' },
};

export const fmt = (v?: string | null) => (v ? new Date(v).toLocaleString(locale) : '');
export const fmtTime = (v?: string | null) => (v ? new Date(v).toLocaleTimeString(locale) : '');
/** YYYY-MM-DD theo giờ địa phương. */
export const ymd = (d: Date | string = new Date()) => new Date(d).toLocaleDateString('sv');
/** Giá trị input datetime-local (giờ địa phương) → ISO UTC cho Postgres. */
export const toIso = (local: string) => (local ? new Date(local).toISOString() : '');
export const clock = (ms: number) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const COLORS = ['#6a2c91', '#b03a2e', '#1f6f8b', '#8a5a00', '#2e7d32', '#5b4b8a', '#ad1457'];
export const courseColor = (id?: number | null) => (id ? COLORS[id % COLORS.length] : '#607d8b');

export const sessionStatus = (s: { status: string; deadline: string }) =>
  s.status === 'running' ? (new Date(s.deadline) < new Date() ? t('hết giờ, chưa nộp') : t('đang thi')) : s.status === 'late' ? t('nộp muộn') : t('đã nộp');

/** Bỏ ký tự đại diện của LIKE và dựng mẫu theo toán tử tìm kiếm. */
export const likePattern = (text: string, op: string) => {
  const s = text.replace(/[%_]/g, '');
  return op === 'equals' ? s : op === 'starts' ? `${s}%` : `%${s}%`;
};

/** % hoàn thành khóa: (bài học đã học + bài tập đã nộp + kỳ thi đã làm) / tổng số mục. */
export const progressPct = (p: Progress) => {
  const total = p.lessons_total + p.assignments_total + p.exams_total;
  return total ? Math.round((100 * (p.lessons_done + p.assignments_done + p.exams_done)) / total) : 0;
};

/** '2026-1' → 'HK1 2026'. */
export const termLabel = (term: string) => { const [y, n] = term.split('-'); return t('HK{0} {1}', n, y); };
/** Học kỳ hiện tại = học kỳ mới nhất trong danh sách (định dạng năm-kỳ nên so sánh chuỗi là đủ). */
export const latestTerm = (terms: string[]) => terms.reduce((a, b) => (b > a ? b : a), '');
