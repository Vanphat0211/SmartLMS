import { Link, useParams } from 'react-router';
import { Card, Loading } from '../components/ui';
import { fmt } from '../lib/format';
import { onForm, useLoad } from '../lib/hooks';
import { q, rpc, supabase } from '../lib/supabase';
import type { Member } from '../lib/types';
import { t } from '../lib/i18n';

/** Giảng viên xem bài nộp và chấm điểm một bài tập. */
export default function Submissions() {
  const aid = Number(useParams().id);
  const { data, error, reload } = useLoad(async () => {
    const a = await q(supabase.from('assignments').select('*, submissions(*)').eq('id', aid).single());
    const members = await rpc<Member[]>('course_members', { p_course: a.course_id });
    return { a, students: members.filter((m) => m.role === 'student') };
  }, [aid]);
  if (!data) return <Loading error={error} />;
  const { a, students } = data;
  return (
    <>
      <h1>{t('Chấm bài')}</h1>
      <p><Link to={`/courses/${a.course_id}`}>{t('← Quay lại khóa học')}</Link></p>
      <Card title={t('{0} — hạn {1} · tối đa {2} điểm', a.title, fmt(a.due_at), a.points)}>
        <table>
          <thead><tr><th>{t('Sinh viên')}</th><th>{t('Bài nộp')}</th><th>{t('Thời gian')}</th><th>{t('Điểm / nhận xét')}</th></tr></thead>
          <tbody>{students.map((st) => {
            const s = a.submissions.find((x: { user_id: string }) => x.user_id === st.id);
            if (!s) return <tr key={st.id}><td>{st.name}</td><td colSpan={3} className="muted">{t('Chưa nộp')}</td></tr>;
            return (
              <tr key={st.id}>
                <td>{st.name}</td><td className="pre">{s.content}</td>
                <td>{fmt(s.submitted_at)}{new Date(s.submitted_at) > new Date(a.due_at) && <span className="bad"> {t('muộn')}</span>}</td>
                <td>
                  <form key={`${s.id}:${s.grade}`} className="row" onSubmit={onForm((v) => rpc('grade_submission', { p_submission: s.id, p_grade: Number(v.grade), p_feedback: v.feedback }), reload)}>
                    <input name="grade" type="number" step="0.25" min={0} max={a.points} defaultValue={s.grade ?? ''} className="w80" required />
                    <input name="feedback" placeholder={t('Nhận xét')} defaultValue={s.feedback} /><button>{t('Lưu')}</button>
                  </form>
                </td>
              </tr>
            );
          })}</tbody>
        </table>
      </Card>
    </>
  );
}
