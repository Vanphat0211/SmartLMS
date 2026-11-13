import { useState } from 'react';
import { Link } from 'react-router';
import { useMe } from '../auth';
import { Card, Empty, Loading, ModalButton, PageHead, Swatch } from '../components/ui';
import { latestTerm, termLabel } from '../lib/format';
import { act, onForm, useLoad } from '../lib/hooks';
import { t } from '../lib/i18n';
import { first, q, rpc, supabase } from '../lib/supabase';
import type { Course, Person } from '../lib/types';

export const COURSE_SELECT = '*, teacher:profiles!courses_teacher_id_fkey(name), enrollments(count)';

/** Tạo / sửa lớp học phần (admin). */
export function CourseForm({ teachers, course, term, onDone }: { teachers: Person[]; course?: Course; term?: string; onDone: () => unknown }) {
  return (
    <form className="form2" onSubmit={onForm((v) => {
      const row = { code: v.code.trim().toUpperCase(), title: v.title.trim(), program: v.program.trim(), term: v.term.trim(), section: v.section.trim(),
        schedule: v.schedule.trim(), room: v.room.trim(), teacher_id: v.teacher_id || null };
      return q(course ? supabase.from('courses').update(row).eq('id', course.id) : supabase.from('courses').insert(row));
    }, onDone)}>
      <div className="row">
        <input name="code" placeholder={t('Mã môn (vd IT150IU)')} defaultValue={course?.code} required className="w120" />
        <input name="title" placeholder={t('Tên môn học')} defaultValue={course?.title} required className="grow" />
      </div>
      <input name="program" placeholder={t('Ngành / chương trình (vd Kỹ thuật máy tính)')} defaultValue={course?.program} />
      <div className="row">
        <label>{t('Học kỳ')} <input name="term" placeholder="2026-1" pattern="[0-9]{4}-[1-3]" title="2026-1" defaultValue={course?.term ?? term} required className="w80" /></label>
        <label>{t('Nhóm / ca')} <input name="section" defaultValue={course?.section ?? '01'} required className="w80" /></label>
        <input name="room" placeholder={t('Phòng')} defaultValue={course?.room} className="w80" />
      </div>
      <input name="schedule" placeholder={t('Lịch học (vd Thứ 2 · Ca 1, 07:00–09:30)')} defaultValue={course?.schedule} />
      <label>{t('Giảng viên')} <select name="teacher_id" defaultValue={course?.teacher_id ?? ''}>
        <option value="">{t('— Chưa phân công —')}</option>
        {teachers.map((p) => <option key={p.id} value={p.id}>{p.name} ({p.email})</option>)}
      </select></label>
      <button>{course ? t('Lưu thay đổi') : t('Tạo lớp học phần')}</button>
    </form>
  );
}

type ImportRow = { line: number; email: string; code: string; section: string | null; status: string };
const IMPORT_STATUS: Record<string, string> = {
  enrolled: t('Đã ghi danh'),
  pending: t('Chưa có tài khoản — sẽ tự ghi danh khi được cấp tài khoản'),
  no_course: t('Không có lớp này trong học kỳ'),
  ambiguous: t('Môn có nhiều nhóm — cần ghi rõ nhóm'),
  not_student: t('Email không phải tài khoản sinh viên'),
  invalid: t('Dòng không hợp lệ'),
};

/** Nhập đăng ký môn xuất từ edu: "email, mã môn, nhóm" mỗi dòng (dán được từ Excel). */
function ImportRegistrations({ term, onDone }: { term: string; onDone: () => unknown }) {
  const [res, setRes] = useState<ImportRow[]>([]);
  const count = (s: string) => res.filter((r) => r.status === s).length;
  return (
    <>
      <form className="form2" onSubmit={onForm(async (v) => {
        const rows = v.lines.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => {
          const [email = '', code = '', section = ''] = l.split(/[,;\t]/).map((s) => s.trim());
          return { email, code, section };
        });
        setRes(await rpc<ImportRow[]>('import_registrations', { p_term: v.term.trim(), p_rows: rows }));
      }, onDone)}>
        <label>{t('Học kỳ')} <input name="term" pattern="[0-9]{4}-[1-3]" title="2026-1" defaultValue={term} required className="w80" /></label>
        <textarea name="lines" rows={6} required
          placeholder={t('Mỗi dòng: email, mã môn, nhóm (bỏ trống nhóm nếu môn chỉ có 1 nhóm)\nvd: sv001@truong.edu.vn, IT150IU, 01')} />
        <button>{t('Nhập & ghi danh')}</button>
      </form>
      {res.length > 0 && <div className="results">
        <b>{t('{0} đã ghi danh · {1} chờ cấp tài khoản · {2} lỗi', count('enrolled'), count('pending'), res.length - count('enrolled') - count('pending'))}</b>
        {res.filter((r) => r.status !== 'enrolled').map((r) => (
          <div key={r.line} className={r.status === 'pending' ? 'amber' : 'bad'}>{t('Dòng {0}', r.line)}: {r.email} {r.code} {r.section ?? ''} — {IMPORT_STATUS[r.status]}</div>
        ))}
      </div>}
    </>
  );
}

export default function Courses() {
  const { me } = useMe();
  const admin = me.role === 'admin';
  const [term, setTerm] = useState('');
  const { data, error, reload } = useLoad(() => Promise.all([
    q(supabase.from('courses').select(COURSE_SELECT).order('term', { ascending: false }).order('code').order('section')) as Promise<Course[]>,
    admin ? q(supabase.from('profiles').select('id, name, email').eq('role', 'teacher').order('name')) as Promise<Person[]> : Promise.resolve([]),
  ]));
  if (!data) return <Loading error={error} />;
  const [courses, teachers] = data;
  const terms = [...new Set(courses.map((c) => c.term))].sort().reverse();
  const shown = term || latestTerm(terms);
  const newTerm = latestTerm(terms) || `${new Date().getFullYear()}-1`;
  const list = courses.filter((c) => shown === 'all' || c.term === shown);
  const remove = (c: Course) => confirm(t('Xóa lớp {0} — nhóm {1}? Toàn bộ bài học, bài tập, bài thi của lớp cũng bị xóa.', c.code, c.section))
    && act(() => q(supabase.from('courses').delete().eq('id', c.id)), reload);

  return (
    <>
      <PageHead title={admin ? t('Quản lý môn học') : t('Khóa học')} sub={term || terms.length ? termLabel(shown === 'all' ? latestTerm(terms) : shown) : undefined}>
        {admin && <>
          <ModalButton className="ghost" label={t('Nhập đăng ký môn từ edu')} title={t('Nhập đăng ký môn từ edu')}>{() => <ImportRegistrations term={newTerm} onDone={reload} />}</ModalButton>
          <ModalButton label={'+ ' + t('Tạo lớp học phần')} title={t('Tạo lớp học phần')}>{(close) => <CourseForm teachers={teachers} term={newTerm} onDone={() => { reload(); close(); }} />}</ModalButton>
        </>}
      </PageHead>
      <Card>
        <div className="toolbar">
          <label>{t('Học kỳ')} <select value={shown} onChange={(e) => setTerm(e.target.value)}>
            {terms.map((x) => <option key={x} value={x}>{termLabel(x)}</option>)}
            <option value="all">{t('Tất cả học kỳ')}</option>
          </select></label>
        </div>
        {list.length ? (
          <table>
            <thead><tr><th>{t('Môn học')}</th><th>{t('Nhóm')}</th><th>{t('Lịch học')}</th><th>{t('Giảng viên')}</th><th>{t('Sinh viên')}</th>{admin && <th />}</tr></thead>
            <tbody>{list.map((c) => (
              <tr key={c.id}>
                <td><Link to={`/courses/${c.id}`}><Swatch id={c.id} /><b>{c.code} — {c.title}</b></Link>
                  <div className="muted">{termLabel(c.term)}{c.program && ` · ${c.program}`}</div></td>
                <td>{c.section}</td>
                <td>{c.schedule}{c.room && <div className="muted">{t('Phòng')} {c.room}</div>}</td>
                <td>{first(c.teacher)?.name ?? <span className="amber">{t('Chưa phân công')}</span>}</td>
                <td>{c.enrollments?.[0]?.count ?? 0}</td>
                {admin && <td><button className="link" onClick={() => remove(c)}>{t('Xóa')}</button></td>}
              </tr>
            ))}</tbody>
          </table>
        ) : <Empty>{t('Chưa có khóa học.')}</Empty>}
      </Card>
    </>
  );
}
