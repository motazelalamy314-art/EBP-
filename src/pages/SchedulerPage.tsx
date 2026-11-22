import React, { useState } from 'react';
import {
  CalendarClock,
  Loader2,
  AlertCircle,
  Sparkles,
  Play,
  Trash2,
} from 'lucide-react';
import type {
  AppState,
  StudyContextPrefill,
  StudySchedule,
  SubjectId,
} from '../types/study';
import {
  STUDY_MODES,
  getSubjectDisplayName,
  getSubjectStats,
  isEnglishStemSubject,
} from '../utils/studyLogic';
import { generateSmartSchedule } from '../utils/aiClient';

interface SchedulerPageProps {
  state: AppState;
  onSaveSchedule: (schedule: StudySchedule | null) => void;
  onToggleTask: (dayIndex: number, taskId: string) => void;
  onLaunchStudyTask: (prefill: StudyContextPrefill) => void;
}

export const SchedulerPage: React.FC<SchedulerPageProps> = ({
  state,
  onSaveSchedule,
  onToggleTask,
  onLaunchStudyTask,
}) => {
  const languageSchoolMode = state.settings.languageSchoolMode ?? true;
  const defaultExamDate = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const [selectedSubjects, setSelectedSubjects] = useState<SubjectId[]>(['arabic', 'math', 'science']);
  const [examDate, setExamDate] = useState<string>(state.schedule?.examDate || defaultExamDate);
  const [dailyHours, setDailyHours] = useState<number>(state.schedule?.dailyHours || 4);
  const [isGenerating, setIsGenerating] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  const toggleSubjectSelection = (id: SubjectId) => {
    setSelectedSubjects((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    );
  };

  const handleGenerateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (selectedSubjects.length === 0) {
      setErrorMsg('اختر مادة واحدة على الأقل لتوليد الجدول الذكي.');
      return;
    }

    setIsGenerating(true);
    try {
      const subjectsSummary = state.subjects
        .filter((s) => selectedSubjects.includes(s.id))
        .map((s) => {
          const displayName = getSubjectDisplayName(s, languageSchoolMode);
          const isEngStem = isEnglishStemSubject(s.id, languageSchoolMode);
          return {
            id: s.id,
            nameAr: displayName,
            branches:
              s.branches.length > 0
                ? s.branches.map((b) => ({
                    title: b.title,
                    lessons: b.lessons.map((l) => l.title),
                  }))
                : [
                    {
                      title: isEngStem ? 'Core Topics' : 'الموضوعات الأساسية',
                      lessons: [
                        isEngStem
                          ? `${displayName} Foundation Review`
                          : `مراجعة وتأسيس ${displayName}`,
                      ],
                    },
                  ],
          };
        });

      const days = await generateSmartSchedule({
        settings: state.settings,
        examDate,
        dailyHours,
        languageSchoolMode,
        subjectsSummary,
      });

      if (days.length === 0) {
        throw new Error('لم يُرجع الذكاء الاصطناعي أياماً في الجدول. حاول مجدداً.');
      }

      onSaveSchedule({
        id: `schedule_${Date.now()}`,
        examDate,
        dailyHours,
        selectedSubjects,
        days,
        createdAt: new Date().toISOString(),
      });
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'تعذر إنشاء الجدول الذكي. تأكد من إعدادات الـ API.'
      );
    } finally {
      setIsGenerating(false);
    }
  };

  const getSubjectName = (id: SubjectId) => {
    const found = state.subjects.find((s) => s.id === id);
    return found ? getSubjectDisplayName(found, languageSchoolMode) : id;
  };
  const getModeLabel = (id: string) =>
    STUDY_MODES.find((m) => m.id === id)?.label || id;

  return (
    <div className="space-y-8">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
            الجدول الذكي للمذاكرة
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            توزيع يومي ذكي لدروسك المستخرجة وربطها مباشرة بأوضاع المذاكرة السبعة
          </p>
        </div>

        {state.schedule && (
          <button
            type="button"
            onClick={() => onSaveSchedule(null)}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-red-500/10 text-red-600 dark:text-red-400 border border-red-500/30 hover:bg-red-500/20 transition-colors shrink-0"
          >
            <Trash2 className="w-4 h-4" />
            <span>مسح الجدول الحالي</span>
          </button>
        )}
      </header>

      {/* Schedule Generator Form */}
      <form
        onSubmit={handleGenerateSchedule}
        className="interactive-card p-5 sm:p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-6"
      >
        <div>
          <span className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2.5">
            اختر المواد المستهدفة في الجدول
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
            {state.subjects.map((sub) => {
              const stats = getSubjectStats(sub);
              const checked = selectedSubjects.includes(sub.id);
              const displayName = getSubjectDisplayName(sub, languageSchoolMode);
              const isEngStem = isEnglishStemSubject(sub.id, languageSchoolMode);
              return (
                <label
                  key={sub.id}
                  className={`flex items-center justify-between gap-3 p-3 rounded-xl border cursor-pointer transition-colors ${
                    checked
                      ? 'bg-indigo-600/10 border-indigo-500 text-slate-900 dark:text-white'
                      : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300'
                  }`}
                >
                  <span className="flex items-center gap-2.5 min-w-0">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleSubjectSelection(sub.id)}
                      className="w-4 h-4 rounded text-indigo-600 focus:ring-indigo-500 shrink-0"
                    />
                    <span
                      dir={isEngStem ? 'ltr' : 'rtl'}
                      className="text-sm font-semibold truncate"
                    >
                      {displayName}
                    </span>
                  </span>
                  <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums shrink-0">
                    {stats.lessonCount} دروس
                  </span>
                </label>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 items-end">
          <div>
            <label
              htmlFor="exam-date"
              className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5"
            >
              تاريخ الامتحان المستهدف
            </label>
            <input
              id="exam-date"
              type="date"
              value={examDate}
              onChange={(e) => setExamDate(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm font-mono text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <div>
            <label
              htmlFor="daily-hours"
              className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5"
            >
              ساعات المذاكرة المتاحة يومياً ({dailyHours} ساعات)
            </label>
            <input
              id="daily-hours"
              type="number"
              min={1}
              max={14}
              value={dailyHours}
              onChange={(e) => setDailyHours(Math.max(1, Math.min(14, Number(e.target.value) || 1)))}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm font-mono tabular-nums text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>

          <button
            type="submit"
            disabled={isGenerating}
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-60 transition-colors whitespace-nowrap"
          >
            {isGenerating ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>جاري تصميم الجدول...</span>
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                <span>توليد جدول ذكي</span>
              </>
            )}
          </button>
        </div>

        {errorMsg && (
          <div
            role="alert"
            className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/30 text-xs text-red-600 dark:text-red-400 flex items-center gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}
      </form>

      {/* Generated Schedule Days */}
      {state.schedule ? (
        <section aria-label="أيام الجدول الدراسي" className="space-y-4">
          {state.schedule.days.map((day) => {
            const doneCount = day.tasks.filter((t) => t.completed).length;
            return (
              <div
                key={day.dayIndex}
                className="interactive-card p-5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-200 dark:border-slate-800">
                  <div>
                    <h2 className="text-base sm:text-lg font-bold text-slate-900 dark:text-white">
                      {day.dateLabel} · {day.focusTheme}
                    </h2>
                  </div>
                  <span className="text-xs font-mono tabular-nums text-emerald-600 dark:text-emerald-400">
                    {doneCount}/{day.tasks.length} مهام مكتملة
                  </span>
                </div>

                <div className="space-y-2.5">
                  {day.tasks.map((task) => (
                    <div
                      key={task.id}
                      className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800"
                    >
                      <label className="flex items-start gap-3 cursor-pointer flex-1 min-w-0">
                        <input
                          type="checkbox"
                          checked={task.completed}
                          onChange={() => onToggleTask(day.dayIndex, task.id)}
                          className="mt-1 w-4 h-4 rounded text-emerald-500 focus:ring-indigo-500 shrink-0"
                        />
                        <div className="min-w-0">
                          <div
                            className={`text-sm font-bold ${
                              task.completed
                                ? 'line-through text-slate-400 dark:text-slate-500'
                                : 'text-slate-900 dark:text-white'
                            }`}
                          >
                            <bdi
                              dir={
                                isEnglishStemSubject(task.subjectId, languageSchoolMode)
                                  ? 'ltr'
                                  : 'rtl'
                              }
                            >
                              {task.lessonTitle}
                            </bdi>
                          </div>
                          <div className="mt-0.5 text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                            <bdi
                              dir={
                                isEnglishStemSubject(task.subjectId, languageSchoolMode)
                                  ? 'ltr'
                                  : 'rtl'
                              }
                            >
                              {getSubjectName(task.subjectId)}
                            </bdi>{' '}
                            ·{' '}
                            <bdi
                              dir={
                                isEnglishStemSubject(task.subjectId, languageSchoolMode)
                                  ? 'ltr'
                                  : 'rtl'
                              }
                            >
                              {task.branchTitle}
                            </bdi>{' '}
                            · وضع: {getModeLabel(task.modeId)} · {task.durationMinutes} دقيقة
                          </div>
                          {task.notes && (
                            <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                              {task.notes}
                            </p>
                          )}
                        </div>
                      </label>

                      <button
                        type="button"
                        onClick={() =>
                          onLaunchStudyTask({
                            subjectId: task.subjectId,
                            branchTitle: task.branchTitle,
                            lessonTitle: task.lessonTitle,
                            modeId: task.modeId,
                          })
                        }
                        className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-500 transition-colors whitespace-nowrap shrink-0"
                      >
                        <Play className="w-3.5 h-3.5" />
                        <span>ابدأ المذاكرة</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </section>
      ) : (
        <div className="interactive-card p-8 rounded-2xl bg-white dark:bg-slate-900 border border-dashed border-slate-300 dark:border-slate-800 text-center space-y-2">
          <CalendarClock className="w-9 h-9 text-indigo-500 mx-auto" />
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            لا يوجد جدول زمني محفوظ حالياً
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-lg mx-auto">
            اختر المواد وتاريخ الامتحان وساعاتك اليومية لتوليد خطة مذاكرة ذكية مخصصة لك.
          </p>
        </div>
      )}
    </div>
  );
};
