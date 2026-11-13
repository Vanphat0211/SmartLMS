import { Link } from 'react-router';
import { useMe } from '../auth';
import { Card, Empty, Loading, ModalButton, PageHead, Review } from '../components/ui';
import { fmt, sessionStatus, toIso } from '../lib/format';
import { onForm, useLoad } from '../lib/hooks';
import { first, q, rpc, supabase } from '../lib/supabase';
import type { SessionRow } from '../lib/types';
import { t } from '../lib/i18n';

type Exam = { id: number; course_id: number; title: string; minutes: number; opens_at: string; closes_at: string; show_score: boolean; courses: { code: string; title: string; section: string } };
type MySession = { exam_id: number; score: number | null; deadline: string; submitted_at: string | null };

export function SessionTable({ rows }: { rows: SessionRow[] }) {
  if (!rows.length) return <Empty>{t('Chưa có phiên thi.')}</Empty>;
  return (
    <table>
      <thead><tr><th>#</th><th>{t('Kỳ thi')}</th><th>{t('Sinh viên')}</th><th>{t('Trạng thái')}</th><th>{t('Điểm')}</th><th>{t('Cảnh báo')}</th><th>{t('Rà soát')}</th><th /></tr></thead>
      <tbody>{rows.map((s) => (
        <tr key={s.id}><td>{s.id}</td><td>{s.exam}</td><td>{s.student}</td><td><span className="tag">{sessionStatus(s)}</span></td><td>{s.score ?? '-'}</td>
          <td className={s.alerts ? 'bad' : ''}>{s.alerts}</td><td><Review v={s.review} /></td><td><Link className="btn ghost" to={`/sessions/${s.id}`}>{t('Nhật ký')}</Link></td></tr>
      ))}</tbody>
    </table>
  );
}

function StudentAction({ x, s }: { x: Exam; s?: MySession }) {
  const now = new Date();
  if (s && (s.submitted_at || new Date(s.deadline) < now)) return s.score != null ? <><b>{s.score}</b>/10</>
    : <span className="muted">{s.submitted_at ? t('Đã nộp · chờ công bố điểm') : t('Hết giờ')}</span>;
  if (s) return <Link className="btn" to={`/exams/${x.id}/take`}>{t('Tiếp tục làm bài')}</Link>;
  if (now >= new Date(x.opens_at) && now <= new Date(x.closes_at)) return <Link className="btn" to={`/exams/${x.id}/take`}>{t('Vào thi')}</Link>;
  return <span className="muted">{now < new Date(x.opens_at) ? t('Chưa mở') : t('Đã đóng')}</span>;
}

export default function Exams() {
  const { me } = useMe();
  const teacher = me.role === 'teacher', student = me.role === 'student';
  const { data, error, reload } = useLoad(() => Promise.all([
    q(supabase.from('exams').select('*, courses(code, title, section)').order('opens_at', { ascending: false })) as Promise<Exam[]>,
    // điểm đọc qua session_overview (đã che theo thiết lập ẩn/hiện điểm của bài thi)
    student ? q(supabase.from('session_overview').select('exam_id, score, deadline, submitted_at')) as Promise<MySession[]> : Promise.resolve([]),
    student ? Promise.resolve([]) : q(supabase.from('session_overview').select('*').order('id', { ascending: false })) as Promise<SessionRow[]>,
    teacher ? q(supabase.from('courses').select('id, code, title, section').eq('teacher_id', me.id).order('code')) : Promise.resolve([]),
    teacher ? q(supabase.from('outcomes').select('id, code, course_id, courses(code)').order('code')) : Promise.resolve([]),
  ]));
  if (!data) return <Loading error={error} />;
  const [exams, mine, sessions, courses, outcomes] = data;
  const courseOptions = courses.map((c) => <option key={c.id} value={c.id}>{c.code} — {c.title} · {t('Nhóm')} {c.section}</option>);

  return (
    <>
      <PageHead title={t('Kỳ thi')}>
        {teacher && <>
          <ModalButton className="ghost" label={'+ ' + t('Thêm câu hỏi')} title={t('Thêm câu hỏi vào ngân hàng')}>{(close) => (
            <form className="form2" onSubmit={onForm((v) => rpc('add_question', {
              p_course: Number(v.course), p_text: v.text, p_options: v.options.split('|').map((o) => o.trim()),
              p_answer: Number(v.answer) - 1, p_outcome: v.outcome ? Number(v.outcome) : null,
            }), () => close())}>
              <select name="course">{courseOptions}</select>
              <input name="text" placeholder={t('Nội dung câu hỏi')} required />
              <input name="options" placeholder={t('Các đáp án, cách nhau bởi |   (vd: A | B | C)')} required />
              <div className="row">
                <label>{t('Đáp án đúng số')} <input name="answer" type="number" min={1} defaultValue={1} className="w80" /></label>
                <select name="outcome"><option value="">{t('— Không gắn CLO —')}</option>{outcomes.map((o) => <option key={o.id} value={o.id}>{first(o.courses)?.code} · {o.code}</option>)}</select>
              </div>
              <button>{t('Thêm câu hỏi')}</button>
            </form>
          )}</ModalButton>
          <ModalButton label={'+ ' + t('Tạo kỳ thi')} title={t('Tạo kỳ thi')}>{(close) => (
            <form className="form2" onSubmit={onForm((v) => q(supabase.from('exams').insert({
              course_id: Number(v.course), title: v.title, minutes: Number(v.minutes), opens_at: toIso(v.opens), closes_at: toIso(v.closes), show_score: v.show_score === 'on',
            })), () => { reload(); close(); })}>
              <select name="course">{courseOptions}</select>
              <input name="title" placeholder={t('Tên kỳ thi')} required />
              <div className="row"><label>{t('Mở')} <input name="opens" type="datetime-local" required /></label><label>{t('Đóng')} <input name="closes" type="datetime-local" required /></label></div>
              <label>{t('Thời gian làm bài')} <input name="minutes" type="number" min={1} defaultValue={15} className="w80" /> {t('phút')}</label>
              <label><input name="show_score" type="checkbox" defaultChecked /> {t('Cho sinh viên xem điểm ngay sau khi nộp (bỏ chọn = ẩn đến khi công bố)')}</label>
              <button>{t('Tạo kỳ thi')}</button>
            </form>
          )}</ModalButton>
        </>}
      </PageHead>
      <Card title={t('Danh sách kỳ thi')}>
        {exams.length ? (
          <table>
            <thead><tr><th>{t('Môn')}</th><th>{t('Kỳ thi')}</th><th>{t('Mở')}</th><th>{t('Đóng')}</th><th>{t('Thời gian')}</th>{!student && <th>{t('Điểm với SV')}</th>}<th /></tr></thead>
            <tbody>{exams.map((x) => (
              <tr key={x.id}><td>{x.courses.code} · {x.courses.section}</td><td><b>{x.title}</b></td><td>{fmt(x.opens_at)}</td><td>{fmt(x.closes_at)}</td><td>{x.minutes} {t('phút')}</td>
                {student ? <td><StudentAction x={x} s={mine.find((s) => s.exam_id === x.id)} /></td> : <>
                  <td>{x.show_score ? <span className="ok">{t('Hiện')}</span> : <span className="amber">{t('Ẩn')}</span>}</td>
                  <td><Link className="btn ghost" to={`/exams/${x.id}/results`}>{t('Kết quả')}</Link></td></>}</tr>
            ))}</tbody>
          </table>
        ) : <Empty>{t('Chưa có kỳ thi.')}</Empty>}
      </Card>
      {!student && <Card title={t('Phiên thi & cảnh báo')}><SessionTable rows={sessions} /></Card>}
    </>
  );
}
