import { fmt, ymd } from './format';
import type { AgendaItem } from './types';
import { t } from './i18n';

export const KIND: Record<AgendaItem['kind'], string> = { assignment: t('Bài tập'), exam: t('Kỳ thi'), task: t('Công việc'), event: t('Sự kiện cá nhân') };

export const agendaDay = (x: AgendaItem) => x.day ?? ymd(x.at!);
export const agendaWhen = (x: AgendaItem) => x.day ?? fmt(x.at);
export const agendaLink = (x: AgendaItem) =>
  x.kind === 'assignment' ? `/courses/${x.course_id}` : x.kind === 'exam' ? '/exams' : x.kind === 'task' ? '/tasks' : '/calendar';

export const isOverdue = (x: AgendaItem) => x.kind === 'assignment' && !x.done && new Date(x.at!) < new Date();

/** Chưa hoàn thành, đến hạn trong 7 ngày tới. */
export function upcoming(items: AgendaItem[]) {
  const now = new Date(), today = ymd(), week = ymd(new Date(Date.now() + 7 * 864e5));
  return items
    .filter((x) => !x.done && (x.at ? new Date(x.at) >= now : x.day! >= today) && agendaDay(x) <= week)
    .sort((a, b) => (a.at ?? a.day!).localeCompare(b.at ?? b.day!));
}
