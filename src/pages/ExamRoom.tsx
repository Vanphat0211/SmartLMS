import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { clock } from '../lib/format';
import { rpc, supabase } from '../lib/supabase';
import { t } from '../lib/i18n';

type Paper = { session_id: number; deadline: string; title: string; questions: { id: number; text: string; options: string[] }[] };
type Result = { score: number; right: number; total: number; late: boolean; hidden?: boolean }; // hidden: GV chưa công bố điểm

const store = {
  get: (k: string) => { try { return JSON.parse(sessionStorage.getItem(k) || '{}'); } catch { return {}; } },
  set: (k: string, v: unknown) => { try { sessionStorage.setItem(k, JSON.stringify(v)); } catch { /* chế độ riêng tư */ } },
  del: (k: string) => { try { sessionStorage.removeItem(k); } catch { /* bỏ qua */ } },
};

/**
 * Phòng thi toàn màn hình. Trình duyệt đóng vai "cảm biến mềm": ghi chuyển tab/cửa sổ, sao chép/dán,
 * thoát toàn màn hình vào nhật ký chuỗi băm. Tải lại trang → start_exam trả lại phiên cũ và gắn cờ session_resume.
 */
export default function ExamRoom() {
  const examId = Number(useParams().id);
  const nav = useNavigate();
  const [paper, setPaper] = useState<Paper>();
  const [error, setError] = useState<string>();
  const [answers, setAnswers] = useState<Record<string, number>>({});
  const [logged, setLogged] = useState(0);
  const [left, setLeft] = useState(0);
  const answersRef = useRef(answers);
  const started = useRef(false), finished = useRef(false), quiet = useRef(false);

  useEffect(() => {
    if (started.current) return; // StrictMode gọi effect 2 lần — chỉ bắt đầu một lần
    started.current = true;
    rpc<Paper>('start_exam', { p_exam: examId }).then((p) => {
      answersRef.current = store.get('ans' + p.session_id);
      setAnswers(answersRef.current);
      setPaper(p);
      document.documentElement.requestFullscreen?.().catch(() => {});
    }, (e: Error) => setError(e.message));
  }, [examId]);

  const choose = (qid: number, j: number) => {
    answersRef.current = { ...answersRef.current, [qid]: j };
    setAnswers(answersRef.current);
    if (paper) store.set('ans' + paper.session_id, answersRef.current);
  };

  const finish = useCallback(async (auto: boolean) => {
    if (!paper || finished.current) return;
    if (!auto) {
      quiet.current = true; // hộp xác nhận làm mất focus — không tính là rời cửa sổ
      const ok = confirm(t('Nộp bài ngay?'));
      quiet.current = false;
      if (!ok) return;
    }
    finished.current = true;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    try {
      const r = await rpc<Result>('submit_exam', { p_session: paper.session_id, p_answers: answersRef.current });
      store.del('ans' + paper.session_id);
      alert(r.hidden ? t('Đã nộp bài. Điểm sẽ hiển thị khi giảng viên công bố.{0}', r.late ? t(' — nộp muộn') : '')
        : t('Điểm: {0} ({1}/{2} câu đúng){3}', r.score, r.right, r.total, r.late ? t(' — nộp muộn') : ''));
    } catch (e) {
      alert((e as Error).message);
    }
    nav('/grades');
  }, [paper, nav]);

  useEffect(() => {
    if (!paper) return;
    const note = (type: string, detail: Record<string, unknown> = {}) => {
      if (finished.current) return;
      setLogged((n) => n + 1);
      supabase.rpc('log_client_event', { p_session: paper.session_id, p_type: type, p_detail: detail }).then(() => {});
    };
    const onVisibility = () => document.hidden && note('tab_blur');
    const onBlur = () => { if (!quiet.current) setTimeout(() => !document.hidden && note('window_blur'), 150); };
    const onClipboard = (e: ClipboardEvent) => note('copy_paste', { kind: e.type });
    const onFullscreen = () => !document.fullscreenElement && note('fullscreen_exit');
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    document.addEventListener('fullscreenchange', onFullscreen);
    for (const ev of ['copy', 'cut', 'paste'] as const) document.addEventListener(ev, onClipboard);
    const tick = () => { const ms = new Date(paper.deadline).getTime() - Date.now(); setLeft(ms); if (ms <= 0) finish(true); };
    tick();
    const timer = setInterval(tick, 500);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('fullscreenchange', onFullscreen);
      for (const ev of ['copy', 'cut', 'paste'] as const) document.removeEventListener(ev, onClipboard);
      clearInterval(timer);
    };
  }, [paper, finish]);

  if (error) return <main><div className="card"><h3>{t('Không vào được kỳ thi')}</h3><div><p className="bad">{error}</p><Link to="/exams">{t('← Quay lại danh sách kỳ thi')}</Link></div></div></main>;
  if (!paper) return <p className="empty">{t('Đang mở đề…')}</p>;
  return (
    <>
      <header><div className="top"><div className="logo">SmartLMS</div><div className="sp" />
        <span className="chip">{t('Phiên #')}{paper.session_id}</span><span className="chip">{t('Còn lại')} <b>{clock(left)}</b></span></div></header>
      <main>
        <div className="warn">
          {t('Bài thi đang được giám sát: chuyển tab/cửa sổ, sao chép/dán, thoát toàn màn hình sẽ được ghi vào nhật ký (đã ghi')} <b>{logged}</b> {t('sự kiện từ trình duyệt). Camera Edge AI & cảm biến phòng thi gửi sự kiện song song — giả lập:')} <code>npm run sim -- {paper.session_id}</code>
        </div>
        <div className="card"><h3>{paper.title}</h3><div>
          {paper.questions.map((qn, i) => (
            <div className="q" key={qn.id}><b>{t('Câu')} {i + 1}. {qn.text}</b>
              {qn.options.map((o, j) => (
                <label key={j}><input type="radio" name={`q${qn.id}`} checked={answers[qn.id] === j} onChange={() => choose(qn.id, j)} /> {o}</label>
              ))}
            </div>
          ))}
          <p><button onClick={() => finish(false)}>{t('Nộp bài')}</button></p>
        </div></div>
      </main>
    </>
  );
}
