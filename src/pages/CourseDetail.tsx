import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { useMe } from '../auth';
import { Card, Empty, Loading, Meter, ModalButton } from '../components/ui';
import { courseColor, fmt, progressPct, ROLE, termLabel, toIso } from '../lib/format';
import { act, onForm, useLoad } from '../lib/hooks';
import { t } from '../lib/i18n';
import { q, rpc, supabase } from '../lib/supabase';
import type { Course, Member, Person, Progress } from '../lib/types';
import { CourseForm } from './Courses';

type Submission = { id: number; content: string; submitted_at: string; grade: number | null; feedback: string };
type Assignment = { id: number; title: string; body: string; due_at: string; points: number; submissions: Submission[] };
type Lesson = { id: number; title: string; body: string; url: string | null; lesson_progress: { user_id: string }[] };

function MyStatus({ a }: { a: Assignment }) {
  const s = a.submissions[0];
  if (s?.grade != null) return <><span className="ok">{t('Điểm')} {s.grade}/{a.points}</span>{s.feedback && <span className="muted"> — {s.feedback}</span>}</>;
  if (s) return <>{t('Đã nộp')} {fmt(s.submitted_at)}{new Date(s.submitted_at) > new Date(a.due_at) && <span className="bad"> {t('(muộn)')}</span>} {t('— chờ chấm')}</>;
  return new Date(a.due_at) < new Date() ? <span className="bad">{t('Quá hạn — chưa nộp')}</span> : <>{t('Chưa nộp')}</>;
}

/** Nút "+ Thêm …" ở đầu thẻ, mở hộp thoại chứa form (chỉ hiện khi `show`). */
const AddForm = ({ show, label, onSubmit, after, children }: { show: boolean; label: string; onSubmit: Parameters<typeof onForm>[0]; after: () => unknown; children: ReactNode }) =>
  show ? (
    <ModalButton className="ghost sm" label={'+ ' + label} title={label}>{(close) => (
      <form className="form2" onSubmit={onForm(onSubmit, () => { close(); return after(); })}>{children}</form>
    )}</ModalButton>
  ) : null;

export default function CourseDetail() {
  const cid = Number(useParams().id);
  const { me } = useMe();
  const teacher = me.role === 'teacher', student = me.role === 'student', admin = me.role === 'admin';
  const { data, error, reload } = useLoad(() => Promise.all([
    q(supabase.from('courses').select('*, teacher:profiles!courses_teacher_id_fkey(name)').eq('id', cid).single()),
    q(supabase.from('announcements').select('*, author:profiles(name)').eq('course_id', cid).order('created_at', { ascending: false })),
    q(supabase.from('lessons').select('id, title, body, url, lesson_progress(user_id)').eq('course_id', cid).order('position').order('id')),
    q(supabase.from('assignments').select('*, submissions(id, content, submitted_at, grade, feedback)').eq('course_id', cid).order('due_at')),
    q(supabase.from('exams').select('*').eq('course_id', cid).order('opens_at')),
    q(supabase.from('outcomes').select('*').eq('course_id', cid).order('code')),
    rpc<Member[]>('course_members', { p_course: cid }),
    student ? Promise.resolve([] as { outcome_id: number | null }[]) : q(supabase.from('questions').select('outcome_id').eq('course_id', cid)),
    rpc<Progress[]>('course_progress', { p_course: cid }),
    admin ? q(supabase.from('profiles').select('id, name, email').eq('role', 'teacher').order('name')) as Promise<Person[]> : Promise.resolve([]),
    admin ? q(supabase.from('courses').select('id, code, term, section')) : Promise.resolve([] as { id: number; code: string; term: string; section: string }[]),
  ]), [cid]);
  if (!data) return <Loading error={error} />;
  const [c, news, lessonRows, assignments, exams, outcomes, members, questions, progress, teachers, allCourses] = data;
  const siblings = allCourses.filter((x) => x.code === c.code && x.term === c.term && x.id !== c.id); // các nhóm (ca) khác của cùng môn, cùng kỳ
  const lessons = lessonRows as Lesson[];
  const studentCount = members.filter((m) => m.role === 'student').length;
  const mine = progress[0];

  const moveTo = (m: Member, to: string) => to && confirm(t('Chuyển {0} sang nhóm {1}?', m.name, siblings.find((x) => x.id === Number(to))?.section))
    && act(() => rpc('move_student', { p_user: m.id, p_from: cid, p_to: Number(to) }), reload);
  const unenroll = (m: Member) => confirm(t('Xóa {0} khỏi lớp?', m.name))
    && act(() => q(supabase.from('enrollments').delete().eq('user_id', m.id).eq('course_id', cid)), reload);
  const toggleLesson = (l: Lesson, done: boolean) => act(() => done
    ? q(supabase.from('lesson_progress').delete().eq('lesson_id', l.id).eq('user_id', me.id))
    : q(supabase.from('lesson_progress').insert({ lesson_id: l.id })), reload);

  return (
    <>
      <div className="phead">
      <div className="chead" style={{ borderColor: courseColor(c.id) }}>
        <span className="muted">{c.code}</span><h1>{c.title}</h1>
        <span className="muted">{termLabel(c.term)} · {t('Nhóm')} {c.section}{c.schedule && ` · ${c.schedule}`}{c.room && ` · ${t('Phòng')} ${c.room}`}{c.program && ` · ${c.program}`}</span><br />
        <span className="muted">{t('Giảng viên:')} {c.teacher?.name ?? t('Chưa phân công')} · {studentCount} {t('sinh viên')}{!student && t(' · {0} câu hỏi trong ngân hàng', questions.length)}</span>
      </div>
      {admin && <div className="pacts"><ModalButton className="ghost" label={t('Sửa lớp / phân công')} title={t('Sửa thông tin lớp / phân công giảng viên')}>
        {(close) => <CourseForm teachers={teachers} course={c as Course} onDone={() => { reload(); close(); }} />}
      </ModalButton></div>}
      </div>
      <div className="cols">
        <div>
          <Card title={t('Bài học')} action={<AddForm label={t('Thêm bài học')} show={teacher} after={reload} onSubmit={(v) => q(supabase.from('lessons').insert({ course_id: cid, title: v.title, body: v.body, url: v.url || null, position: lessons.length + 1 }))}>
              <input name="title" placeholder={t('Tên bài học (vd: Bài 3 — Giao thức MQTT)')} required />
              <textarea name="body" rows={4} placeholder={t('Nội dung bài học')} />
              <input name="url" type="url" placeholder={t('Link tài liệu / video (không bắt buộc)')} />
              <button>{t('Thêm bài học')}</button>
            </AddForm>}>
            {lessons.length ? lessons.map((l, i) => {
              const done = student && l.lesson_progress.length > 0;
              return (
                <details className="item lesson" key={l.id}>
                  <summary><b>{i + 1}. {l.title}</b>
                    {done && <span className="ok"> ✓ {t('Đã học')}</span>}
                    {!student && <span className="muted"> · {t('{0}/{1} sinh viên đã học', l.lesson_progress.length, studentCount)}</span>}
                  </summary>
                  {l.body && <div className="pre">{l.body}</div>}
                  {l.url && <p><a href={l.url} target="_blank" rel="noopener noreferrer">{t('Mở tài liệu đính kèm')} ↗</a></p>}
                  {student && <label className="row"><input type="checkbox" checked={done} onChange={() => toggleLesson(l, done)} /> {t('Đánh dấu đã học')}</label>}
                  {teacher && <button className="link" onClick={() => confirm(t('Xóa bài học này?')) && act(() => q(supabase.from('lessons').delete().eq('id', l.id)), reload)}>{t('Xóa bài học')}</button>}
                </details>
              );
            }) : <Empty>{t('Chưa có bài học.')}</Empty>}
          </Card>
          <Card title={t('Bài tập')} action={<AddForm label={t('Giao bài tập')} show={teacher} after={reload} onSubmit={(v) => q(supabase.from('assignments').insert({ course_id: cid, title: v.title, body: v.body, due_at: toIso(v.due), points: Number(v.points) }))}>
              <input name="title" placeholder={t('Tên bài tập (vd: Lab 7)')} required />
              <div className="row"><label>{t('Hạn nộp')} <input name="due" type="datetime-local" required /></label><label>{t('Điểm tối đa')} <input name="points" type="number" defaultValue={10} min={1} className="w80" /></label></div>
              <textarea name="body" placeholder={t('Mô tả yêu cầu')} /><button>{t('Giao bài tập')}</button>
            </AddForm>}>
            {assignments.length ? (assignments as Assignment[]).map((a) => (
              <div className="item" key={a.id}>
                <b>{a.title}</b> <span className="muted">{t('· hạn')} {fmt(a.due_at)} · {a.points} {t('điểm')}</span>
                {a.body && <div className="pre muted">{a.body}</div>}
                {student && <>
                  <div><MyStatus a={a} /></div>
                  {a.submissions[0]?.grade == null && (
                    <details><summary>{a.submissions[0] ? t('Nộp lại') : t('Nộp bài')}</summary>
                      <form className="stack" onSubmit={onForm((v) => rpc('submit_assignment', { p_assignment: a.id, p_content: v.content }), reload)}>
                        <textarea name="content" placeholder={t('Link bài làm hoặc nội dung')} defaultValue={a.submissions[0]?.content} required /><button>{t('Nộp')}</button>
                      </form>
                    </details>)}
                </>}
                {teacher && <div><Link to={`/assignments/${a.id}`}>{t('Xem bài nộp & chấm điểm (')}{a.submissions.length})</Link></div>}
              </div>
            )) : <Empty>{t('Chưa có bài tập.')}</Empty>}
          </Card>
          <Card title={t('Kỳ thi')}>
            {exams.map((x) => (
              <div className="item" key={x.id}><b>{x.title}</b> <span className="muted">· {fmt(x.opens_at)} → {fmt(x.closes_at)} · {x.minutes} {t('phút')}</span> · {student
                ? <Link to="/exams">{t('Trang kỳ thi')}</Link> : <Link to={`/exams/${x.id}/results`}>{t('Kết quả')}</Link>}</div>
            ))}
            {!exams.length && <Empty>{t('Chưa có kỳ thi.')}</Empty>}
            {teacher && <p className="more"><Link to="/exams">{t('Tạo kỳ thi & câu hỏi →')}</Link></p>}
          </Card>
        </div>
        <div>
          {student ? (
            <Card title={t('Tiến độ của tôi')}>
              {mine ? <div className="progress">
                <span>{t('Bài học đã học')}</span><b>{mine.lessons_done}/{mine.lessons_total}</b>
                <span>{t('Bài tập đã nộp')}</span><b>{mine.assignments_done}/{mine.assignments_total}</b>
                <span>{t('Kỳ thi đã làm')}</span><b>{mine.exams_done}/{mine.exams_total}</b>
                <span>{t('Hoàn thành')}</span><span><Meter pct={progressPct(mine)} /></span>
              </div> : <Empty>{t('Chưa có dữ liệu')}</Empty>}
            </Card>
          ) : (
            <Card title={t('Tiến độ sinh viên')}>
              {progress.length ? (
                <table>
                  <thead><tr><th>{t('Sinh viên')}</th><th>{t('Bài học')}</th><th>{t('Bài tập')}</th><th>{t('Kỳ thi')}</th><th>{t('Hoàn thành')}</th></tr></thead>
                  <tbody>{progress.map((p) => (
                    <tr key={p.user_id}><td>{p.student}</td><td>{p.lessons_done}/{p.lessons_total}</td><td>{p.assignments_done}/{p.assignments_total}</td>
                      <td>{p.exams_done}/{p.exams_total}</td><td className="nowrap"><Meter pct={progressPct(p)} /></td></tr>
                  ))}</tbody>
                </table>
              ) : <Empty>{t('Chưa có sinh viên.')}</Empty>}
            </Card>
          )}
          <Card title={t('Thông báo khóa học')} action={<AddForm label={t('Đăng thông báo')} show={teacher} after={reload} onSubmit={(v) => q(supabase.from('announcements').insert({ course_id: cid, title: v.title, body: v.body }))}>
              <input name="title" placeholder={t('Tiêu đề thông báo')} required /><textarea name="body" placeholder={t('Nội dung')} /><button>{t('Đăng thông báo')}</button>
            </AddForm>}>
            {news.length ? news.map((a) => (
              <div className="item" key={a.id}><b>{a.title}</b><div className="muted">{fmt(a.created_at)} · {a.author?.name}</div><div className="pre">{a.body}</div></div>
            )) : <Empty>{t('Chưa có thông báo.')}</Empty>}
          </Card>
          <Card title={t('Chuẩn đầu ra (CLO)')} action={<AddForm label={t('Thêm CLO')} show={teacher} after={reload} onSubmit={(v) => q(supabase.from('outcomes').insert({ course_id: cid, code: v.code, description: v.description }))}>
              <div className="row"><input name="code" placeholder="CLO3" className="w80" required /><input name="description" placeholder={t('Mô tả chuẩn đầu ra')} className="grow" required /></div><button>{t('Thêm CLO')}</button>
            </AddForm>}>
            {outcomes.length ? outcomes.map((o) => (
              <div className="item" key={o.id}><b>{o.code}</b> {o.description}{!student && <span className="muted"> · {questions.filter((x) => x.outcome_id === o.id).length} {t('câu hỏi gắn')}</span>}</div>
            )) : <Empty>{t('Chưa có chuẩn đầu ra.')}</Empty>}
          </Card>
          <Card title={t('Thành viên')} action={<AddForm label={t('Ghi danh')} show={admin} after={reload} onSubmit={async (v) => {
              // Ghi danh nhiều sinh viên một lần: dán danh sách email (mỗi dòng / cách nhau bởi dấu phẩy).
              const emails = [...new Set(v.emails.split(/[\s,;]+/).filter(Boolean).map((e) => e.toLowerCase()))];
              const found = await q(supabase.from('profiles').select('id, email').in('email', emails).eq('role', 'student'));
              if (found.length) await q(supabase.from('enrollments').upsert(found.map((s) => ({ user_id: s.id, course_id: cid })), { ignoreDuplicates: true }));
              const missing = emails.filter((e) => !found.some((s) => s.email === e));
              if (missing.length) alert(t('Không tìm thấy tài khoản sinh viên: {0}', missing.join(', ')));
            }}>
              <textarea name="emails" rows={2} placeholder={t('Email sinh viên (nhiều email: mỗi dòng một email)')} required />
              <button>{t('Ghi danh')}</button>
            </AddForm>}>
            <table><thead><tr><th>{t('Họ tên')}</th><th>Email</th><th>{t('Vai trò')}</th>{admin && <th />}</tr></thead>
              <tbody>{members.map((m) => (
                <tr key={m.id}><td>{m.name}</td><td>{m.email}</td><td>{ROLE[m.role]}</td>
                  {admin && <td>{m.role === 'student' && <div className="actions">
                    {siblings.length > 0 && <select value="" onChange={(e) => moveTo(m, e.target.value)}>
                      <option value="">{t('Chuyển nhóm…')}</option>
                      {siblings.map((x) => <option key={x.id} value={x.id}>{t('Nhóm')} {x.section}</option>)}
                    </select>}
                    <button className="ghost" onClick={() => unenroll(m)}>{t('Xóa khỏi lớp')}</button>
                  </div>}</td>}</tr>
              ))}</tbody></table>
          </Card>
        </div>
      </div>
    </>
  );
}
