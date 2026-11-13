import type { Role } from './format';

export type Profile = { id: string; name: string; email: string; role: Role; listed: boolean; active: boolean };
export type Member = { id: string; name: string; email: string; role: Role };

export type AgendaItem = {
  kind: 'task' | 'event' | 'assignment' | 'exam';
  ref_id: number;
  course_id: number | null;
  title: string;
  day: string | null; // cả ngày (YYYY-MM-DD)
  at: string | null;  // có giờ (ISO)
  done: boolean;
};

export type SessionRow = {
  id: number; exam_id: number; exam: string; course_id: number; user_id: string; student: string;
  status: 'running' | 'done' | 'late'; score: number | null; started_at: string; deadline: string;
  submitted_at: string | null; review: string | null; alerts: number; last_type: string | null; last_ts: string | null;
};

export type EventRow = {
  id: number; session_id: number; seq: number; ts: string; dts: string | null; source: string; type: string;
  detail: Record<string, unknown>; alert: boolean; latency_ms: number | null; student: string; exam: string;
};

/** Một dòng của RPC course_progress: tiến độ của một sinh viên trong một khóa. */
export type Progress = {
  course_id: number; user_id: string; student: string;
  lessons_done: number; lessons_total: number; assignments_done: number; assignments_total: number; exams_done: number; exams_total: number;
};

/** Lớp học phần: một nhóm (ca) của một môn trong một học kỳ. */
export type Course = {
  id: number; code: string; title: string; program: string; term: string; section: string; schedule: string; room: string;
  teacher_id: string | null; teacher?: { name: string } | null; enrollments?: { count: number }[];
};
export type Person = { id: string; name: string; email: string };
