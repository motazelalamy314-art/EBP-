import React, { useEffect, useState } from 'react';
import {
  Clock,
  CheckCircle2,
  Award,
  Flame,
  Play,
  Pause,
  RotateCcw,
  Check,
  ChevronDown,
  ChevronUp,
  BookOpen,
  FolderUp,
  ArrowLeft,
} from 'lucide-react';
import type {
  AppState,
  EnglishTrack,
  PageId,
  StudyContextPrefill,
  SubjectId,
} from '../types/study';
import {
  calculateDashboardKPIs,
  formatSecondsToClock,
  getSubjectDisplayDescription,
  getSubjectDisplayName,
  getSubjectStats,
  isEnglishStemSubject,
} from '../utils/studyLogic';

interface DashboardPageProps {
  state: AppState;
  onToggleLesson: (subjectId: SubjectId, branchId: string, lessonId: string) => void;
  onChangeEnglishTrack: (track: EnglishTrack) => void;
  onLogPomodoroMinutes: (minutes: number) => void;
  onNavigate: (page: PageId) => void;
  onStudyLesson: (prefill: StudyContextPrefill) => void;
}

export const DashboardPage: React.FC<DashboardPageProps> = ({
  state,
  onToggleLesson,
  onChangeEnglishTrack,
  onLogPomodoroMinutes,
  onNavigate,
  onStudyLesson,
}) => {
  const kpis = calculateDashboardKPIs(state);
  const languageSchoolMode = state.settings.languageSchoolMode ?? true;

  // Pomodoro state
  const focusSeconds = Math.max(1, state.settings.pomodoroFocusMinutes) * 60;
  const breakSeconds = Math.max(1, state.settings.pomodoroBreakMinutes) * 60;

  const [timerPhase, setTimerPhase] = useState<'focus' | 'break'>('focus');
  const [secondsLeft, setSecondsLeft] = useState<number>(focusSeconds);
  const [isRunning, setIsRunning] = useState<boolean>(false);
  const [sessionNotice, setSessionNotice] = useState<string>('');

  // Accordion state per subject
  const [expandedSubjects, setExpandedSubjects] = useState<Record<string, boolean>>({});
  const [expandedBranches, setExpandedBranches] = useState<Record<string, boolean>>({});

  // Sync timer duration when settings change and timer is idle
  useEffect(() => {
    if (!isRunning) {
      setSecondsLeft(timerPhase === 'focus' ? focusSeconds : breakSeconds);
    }
  }, [focusSeconds, breakSeconds, timerPhase, isRunning]);

  useEffect(() => {
    if (!isRunning) return;
    const interval = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          setIsRunning(false);
          if (timerPhase === 'focus') {
            onLogPomodoroMinutes(state.settings.pomodoroFocusMinutes);
            setSessionNotice(
              `أحسنت! تم تسجيل ${state.settings.pomodoroFocusMinutes} دقيقة مذاكرة وتحديث سلسلة الالتزام.`
            );
            setTimerPhase('break');
            return breakSeconds;
          } else {
            setSessionNotice('انتهت فترة الراحة. جاهز لجلسة تركيز جديدة!');
            setTimerPhase('focus');
            return focusSeconds;
          }
        }
        return prev - 1;
      });
    }, 1000);

    return () => window.clearInterval(interval);
  }, [
    isRunning,
    timerPhase,
    focusSeconds,
    breakSeconds,
    state.settings.pomodoroFocusMinutes,
    onLogPomodoroMinutes,
  ]);

  const handleResetTimer = () => {
    setIsRunning(false);
    setSecondsLeft(timerPhase === 'focus' ? focusSeconds : breakSeconds);
  };

  const handleSwitchPhase = (phase: 'focus' | 'break') => {
    setIsRunning(false);
    setTimerPhase(phase);
    setSecondsLeft(phase === 'focus' ? focusSeconds : breakSeconds);
  };

  const handleCompleteFocusNow = () => {
    const elapsedSeconds = focusSeconds - secondsLeft;
    const loggedMinutes =
      elapsedSeconds >= 60
        ? Math.round(elapsedSeconds / 60)
        : state.settings.pomodoroFocusMinutes;
    onLogPomodoroMinutes(loggedMinutes);
    setIsRunning(false);
    setTimerPhase('break');
    setSecondsLeft(breakSeconds);
    setSessionNotice(`تم حفظ جلسة تركيز (${loggedMinutes} دقيقة) في إحصائياتك بنجاح.`);
  };

  const toggleSubjectExpand = (id: string) => {
    setExpandedSubjects((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleBranchExpand = (id: string) => {
    setExpandedBranches((prev) => ({ ...prev, [id]: !prev[id] }));
  };

  const handleJumpToSubjectCard = (subjectId: SubjectId) => {
    setExpandedSubjects((prev) => ({ ...prev, [subjectId]: true }));
    const el = document.querySelector(`[data-testid="subject-card-${subjectId}"]`);
    if (el instanceof HTMLElement) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };

  const totalPhaseSeconds = timerPhase === 'focus' ? focusSeconds : breakSeconds;
  const timerProgressPercent = Math.round(
    ((totalPhaseSeconds - secondsLeft) / totalPhaseSeconds) * 100
  );

  return (
    <div className="space-y-8">
      {/* Page Title & Quick Action */}
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
            لوحة التحكم الرئيسية
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            متابعة شاملة لتقدمك في مواد الصف الأول الثانوي (البكالوريا المصرية)
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <button
            type="button"
            onClick={() => onNavigate('sources')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-slate-200 dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-slate-300 dark:hover:bg-slate-700 transition-colors whitespace-nowrap"
          >
            <FolderUp className="w-4 h-4" />
            <span>رفع المصادر</span>
          </button>
          <button
            type="button"
            onClick={() => onNavigate('study-room')}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-500 transition-colors whitespace-nowrap"
          >
            <BookOpen className="w-4 h-4" />
            <span>غرفة المذاكرة</span>
          </button>
        </div>
      </header>

      {/* 4 Live KPI Cards */}
      <section aria-label="مؤشرات الأداء الرئيسية" className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div
          data-testid="kpi-study-hours"
          className="interactive-card p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-sm font-medium">ساعات المذاكرة</span>
            <Clock className="w-5 h-5 text-indigo-500" />
          </div>
          <div className="mt-3 text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white font-mono tabular-nums">
            {kpis.studyHours.toFixed(1)} <span className="text-sm font-sans font-medium text-slate-500 dark:text-slate-400">ساعة</span>
          </div>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            إجمالي جلسات البومودورو المكتملة
          </p>
        </div>

        <div
          data-testid="kpi-completion"
          className="interactive-card p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-sm font-medium">إنجاز المنهج</span>
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
          </div>
          <div className="mt-3 text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white font-mono tabular-nums">
            {kpis.completionPercent}%
          </div>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            {kpis.completedLessons} من أصل {kpis.totalLessons} درس مستخرج
          </p>
        </div>

        <div
          data-testid="kpi-quiz-score"
          className="interactive-card p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-sm font-medium">متوسط درجات بنك الأسئلة</span>
            <Award className="w-5 h-5 text-indigo-500" />
          </div>
          <div className="mt-3 text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white font-mono tabular-nums">
            {kpis.averageQuizScore}%
          </div>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
            {state.quizAttempts.length} اختبار تفاعلي مسجل
          </p>
        </div>

        <div
          data-testid="kpi-streak"
          className="interactive-card p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800"
        >
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-sm font-medium">سلسلة الالتزام</span>
            <Flame className="w-5 h-5 text-emerald-500" />
          </div>
          <div className="mt-3 text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white font-mono tabular-nums">
            {kpis.dailyStreak} <span className="text-sm font-sans font-medium text-slate-500 dark:text-slate-400">يوم</span>
          </div>
          <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
            أيام المذاكرة المتتالية
          </p>
        </div>
      </section>

      {/* Built-in Pomodoro Timer & 9 Subject Progress Cards */}
      <section className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
        {/* Pomodoro Timer Card */}
        <div className="interactive-card lg:col-span-5 p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                مؤقت التركيز (بومودورو)
              </h2>
              <div className="flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => handleSwitchPhase('focus')}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                    timerPhase === 'focus'
                      ? 'bg-indigo-600 text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  تركيز ({state.settings.pomodoroFocusMinutes} د)
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchPhase('break')}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition-colors whitespace-nowrap ${
                    timerPhase === 'break'
                      ? 'bg-emerald-600 text-white'
                      : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  راحة ({state.settings.pomodoroBreakMinutes} د)
                </button>
              </div>
            </div>

            <div className="my-6 text-center">
              <div
                data-testid="pomodoro-clock"
                dir="ltr"
                className="text-5xl sm:text-6xl font-bold font-mono tabular-nums tracking-tight text-slate-900 dark:text-white"
              >
                {formatSecondsToClock(secondsLeft)}
              </div>
              <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                {timerPhase === 'focus'
                  ? 'جلسة تركيز نشطة — يتم تسجيل الدقائق تلقائياً عند الانتهاء'
                  : 'استراحة قصيرة لتجديد نشاطك قبل الجلسة القادمة'}
              </p>
            </div>

            {/* Progress bar */}
            <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${
                  timerPhase === 'focus' ? 'bg-indigo-600' : 'bg-emerald-500'
                }`}
                style={{ width: `${timerProgressPercent}%` }}
              />
            </div>
          </div>

          <div className="mt-6 space-y-3">
            <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setIsRunning((r) => !r)}
                className="col-span-2 sm:flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-500 transition-colors whitespace-nowrap"
              >
                {isRunning ? (
                  <>
                    <Pause className="w-4 h-4" />
                    <span>إيقاف مؤقت</span>
                  </>
                ) : (
                  <>
                    <Play className="w-4 h-4" />
                    <span>{secondsLeft < totalPhaseSeconds ? 'استكمال' : 'ابدأ الجلسة'}</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleResetTimer}
                aria-label="إعادة ضبط المؤقت"
                className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl text-sm font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors whitespace-nowrap"
              >
                <RotateCcw className="w-4 h-4" />
                <span>إعادة</span>
              </button>

              {timerPhase === 'focus' && (
                <button
                  type="button"
                  onClick={handleCompleteFocusNow}
                  className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2.5 rounded-xl text-sm font-semibold bg-emerald-600/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30 hover:bg-emerald-600/25 transition-colors whitespace-nowrap"
                >
                  <Check className="w-4 h-4" />
                  <span>تسجيل الجلسة</span>
                </button>
              )}
            </div>

            {sessionNotice && (
              <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-xs text-emerald-600 dark:text-emerald-400">
                {sessionNotice}
              </div>
            )}
          </div>
        </div>

        {/* 9 Standalone Subject Progress Cards beside Pomodoro */}
        <div className="lg:col-span-7 flex flex-col justify-between gap-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                توزيع الإنجاز عبر المواد التسع
              </h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                اضغط على بطاقة أي مادة للانتقال إليها مباشرة
              </p>
            </div>
            <span className="text-xs font-mono tabular-nums text-emerald-600 dark:text-emerald-400 font-bold">
              {kpis.completionPercent}% إجمالي
            </span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5 flex-1">
            {state.subjects.map((subject) => {
              const stats = getSubjectStats(subject);
              const displayName = getSubjectDisplayName(subject, languageSchoolMode);
              const isEngStem = isEnglishStemSubject(subject.id, languageSchoolMode);

              return (
                <button
                  key={subject.id}
                  type="button"
                  data-testid={`progress-card-${subject.id}`}
                  onClick={() => handleJumpToSubjectCard(subject.id)}
                  className="interactive-card text-right p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col justify-between gap-3 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                >
                  <div className="flex items-start justify-between gap-2 w-full">
                    <span
                      dir={isEngStem ? 'ltr' : 'rtl'}
                      className="text-sm font-bold text-slate-900 dark:text-white leading-snug truncate"
                    >
                      {displayName}
                    </span>
                    <span className="text-xs font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 shrink-0">
                      {stats.completionPercent}%
                    </span>
                  </div>

                  <div className="w-full space-y-2">
                    <div className="w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-emerald-500 transition-all duration-300"
                        style={{ width: `${stats.completionPercent}%` }}
                      />
                    </div>
                    <div className="flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                      <span>
                        {stats.completedCount}/{stats.lessonCount} دروس
                      </span>
                      <span>{stats.branchCount} فروع</span>
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* 9 Official Baccalaureate Subject Cards */}
      <section aria-label="المواد الدراسية الرسمية">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-slate-900 dark:text-white">
            المواد الدراسية (المادة ← الفروع ← الدروس)
          </h2>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            9 مواد رسمية · الصف الأول الثانوي
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5">
          {state.subjects.map((subject) => {
            const stats = getSubjectStats(subject);
            const activeSourceCount = state.sources.filter(
              (s) => s.subjectId === subject.id && s.active
            ).length;
            const isExpanded = Boolean(expandedSubjects[subject.id]);
            const displayName = getSubjectDisplayName(subject, languageSchoolMode);
            const displayDesc = getSubjectDisplayDescription(subject, languageSchoolMode);
            const isEngStem = isEnglishStemSubject(subject.id, languageSchoolMode);

            return (
              <article
                key={subject.id}
                data-testid={`subject-card-${subject.id}`}
                className="interactive-card p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex flex-col justify-between"
              >
                <div>
                  {/* Card Header */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3
                        dir={isEngStem ? 'ltr' : 'rtl'}
                        className={`text-lg font-bold text-slate-900 dark:text-white ${
                          isEngStem ? 'text-right' : ''
                        }`}
                      >
                        {displayName}
                      </h3>
                      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                        {stats.branchCount} فروع · {stats.lessonCount} دروس · {activeSourceCount} مصادر نشطة
                      </p>
                    </div>
                    <span className="text-sm font-bold font-mono tabular-nums text-emerald-600 dark:text-emerald-400 shrink-0">
                      {stats.completionPercent}%
                    </span>
                  </div>

                  {/* Interactive English Track Switcher */}
                  {subject.id === 'english' && (
                    <div className="mt-3 flex items-center justify-between gap-2 p-1 rounded-xl bg-slate-100 dark:bg-slate-800/80">
                      <span className="text-xs font-medium text-slate-600 dark:text-slate-300 pr-2">
                        المسار:
                      </span>
                      <div className="flex items-center gap-1">
                        {(['O-Level', 'A-Level'] as EnglishTrack[]).map((track) => (
                          <button
                            key={track}
                            type="button"
                            onClick={() => onChangeEnglishTrack(track)}
                            className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                              state.englishTrack === track
                                ? 'bg-indigo-600 text-white'
                                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                            }`}
                          >
                            {track}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Dynamic Progress Bar */}
                  <div className="mt-3 w-full h-2 rounded-full bg-slate-200 dark:bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-emerald-500 transition-all duration-300"
                      style={{ width: `${stats.completionPercent}%` }}
                    />
                  </div>

                  <p
                    dir={isEngStem ? 'ltr' : 'rtl'}
                    className={`mt-3 text-xs text-slate-600 dark:text-slate-400 leading-relaxed ${
                      isEngStem ? 'text-right' : ''
                    }`}
                  >
                    {displayDesc}
                  </p>
                </div>

                {/* Branches & Lessons or Strict Zero-Start Empty State */}
                <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-800">
                  {subject.branches.length === 0 ? (
                    <div className="text-xs text-slate-500 dark:text-slate-400 space-y-2.5">
                      <p>
                        لم يتم استخراج فروع أو دروس لهذه المادة بعد. ارفع كتاب الوزارة أو ملزمتك لتحليل المنهج تلقائياً.
                      </p>
                      <button
                        type="button"
                        onClick={() => onNavigate('sources')}
                        className="inline-flex items-center gap-1.5 text-indigo-600 dark:text-indigo-400 hover:underline font-semibold"
                      >
                        <span>أضف مصادر {displayName}</span>
                        <ArrowLeft className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <button
                        type="button"
                        onClick={() => toggleSubjectExpand(subject.id)}
                        aria-expanded={isExpanded}
                        className="w-full flex items-center justify-between py-1.5 text-xs font-semibold text-indigo-600 dark:text-indigo-400 hover:text-indigo-500"
                      >
                        <span>
                          {isExpanded ? 'إخفاء الفروع والدروس' : `عرض الفروع والدروس (${stats.branchCount})`}
                        </span>
                        {isExpanded ? (
                          <ChevronUp className="w-4 h-4" />
                        ) : (
                          <ChevronDown className="w-4 h-4" />
                        )}
                      </button>

                      {isExpanded && (
                        <div className="space-y-2.5 pt-1 max-h-80 overflow-y-auto pl-1">
                          {subject.branches.map((branch) => {
                            const branchOpen = expandedBranches[branch.id] ?? true;
                            const doneInBranch = branch.lessons.filter((l) => l.completed).length;

                            return (
                              <div
                                key={branch.id}
                                className="rounded-xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 p-3"
                              >
                                <button
                                  type="button"
                                  onClick={() => toggleBranchExpand(branch.id)}
                                  aria-expanded={branchOpen}
                                  className="w-full flex items-center justify-between gap-2 text-xs font-bold text-slate-800 dark:text-slate-200"
                                >
                                  <span
                                    dir={isEngStem ? 'ltr' : 'rtl'}
                                    className={`truncate ${isEngStem ? 'text-right' : ''}`}
                                  >
                                    {branch.title}
                                  </span>
                                  <span className="text-slate-500 dark:text-slate-400 font-mono tabular-nums shrink-0">
                                    {doneInBranch}/{branch.lessons.length}
                                  </span>
                                </button>

                                {branchOpen && (
                                  <ul className="mt-2.5 space-y-2">
                                    {branch.lessons.map((lesson) => (
                                      <li
                                        key={lesson.id}
                                        className="flex items-center justify-between gap-2 text-xs"
                                      >
                                        <label className="flex items-center gap-2 cursor-pointer min-w-0 flex-1">
                                          <input
                                            type="checkbox"
                                            checked={lesson.completed}
                                            onChange={() =>
                                              onToggleLesson(subject.id, branch.id, lesson.id)
                                            }
                                            className="w-4 h-4 rounded border-slate-400 dark:border-slate-600 text-emerald-500 focus:ring-indigo-500 shrink-0"
                                          />
                                          <span
                                            dir={isEngStem ? 'ltr' : 'rtl'}
                                            className={`truncate ${isEngStem ? 'text-right' : ''} ${
                                              lesson.completed
                                                ? 'line-through text-slate-400 dark:text-slate-500'
                                                : 'text-slate-700 dark:text-slate-300'
                                            }`}
                                          >
                                            {lesson.title}
                                          </span>
                                        </label>

                                        <button
                                          type="button"
                                          onClick={() =>
                                            onStudyLesson({
                                              subjectId: subject.id,
                                              branchTitle: branch.title,
                                              lessonTitle: lesson.title,
                                              modeId: 'detailed',
                                            })
                                          }
                                          className="px-2.5 py-1 rounded-lg bg-indigo-600/15 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-600 hover:text-white font-semibold transition-colors whitespace-nowrap shrink-0"
                                        >
                                          ذاكر الآن
                                        </button>
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
};
