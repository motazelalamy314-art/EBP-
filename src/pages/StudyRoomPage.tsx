import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpenCheck,
  Copy,
  Check,
  Volume2,
  Square,
  BookmarkPlus,
  Loader2,
  AlertCircle,
  Sparkles,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import type {
  AppState,
  EnglishTrack,
  QuizAttempt,
  QuizQuestion,
  SavedNote,
  StudyContextPrefill,
  StudyModeId,
  SubjectId,
} from '../types/study';
import {
  STUDY_MODES,
  buildModeSystemPrompt,
  formatQuizBankToMarkdown,
  getSubjectDisplayName,
  isEnglishStemSubject,
} from '../utils/studyLogic';
import { generateStudyContent } from '../utils/aiClient';
import { MarkdownRenderer } from '../components/MarkdownRenderer';

interface StudyRoomPageProps {
  state: AppState;
  prefill: StudyContextPrefill | null;
  onClearPrefill: () => void;
  onChangeEnglishTrack: (track: EnglishTrack) => void;
  onSaveNote: (note: Omit<SavedNote, 'id' | 'createdAt'>) => void;
  onRecordQuizAttempt: (attempt: Omit<QuizAttempt, 'id' | 'createdAt'>) => void;
}

export const StudyRoomPage: React.FC<StudyRoomPageProps> = ({
  state,
  prefill,
  onClearPrefill,
  onChangeEnglishTrack,
  onSaveNote,
  onRecordQuizAttempt,
}) => {
  const [selectedSubjectId, setSelectedSubjectId] = useState<SubjectId>(
    prefill?.subjectId || 'arabic'
  );
  const [selectedBranchTitle, setSelectedBranchTitle] = useState<string>(
    prefill?.branchTitle || ''
  );
  const [selectedLessonTitle, setSelectedLessonTitle] = useState<string>(
    prefill?.lessonTitle || ''
  );
  const [customTopic, setCustomTopic] = useState<string>('');
  const [selectedMode, setSelectedMode] = useState<StudyModeId>(
    prefill?.modeId || 'detailed'
  );
  const [userQuestion, setUserQuestion] = useState<string>('');

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string>('');
  const [responseText, setResponseText] = useState<string>('');
  const [quizQuestions, setQuizQuestions] = useState<QuizQuestion[]>([]);

  // Quiz interactive state
  const [quizView, setQuizView] = useState<'interactive' | 'answer_key'>('interactive');
  const [difficultyFilter, setDifficultyFilter] = useState<'all' | 'easy' | 'medium' | 'hard'>('all');
  const [userAnswers, setUserAnswers] = useState<Record<number, number>>({});
  const [quizSubmitted, setQuizSubmitted] = useState<boolean>(false);
  const [lastQuizScore, setLastQuizScore] = useState<{
    correct: number;
    total: number;
    percent: number;
  } | null>(null);

  // Script copy & TTS state
  const [copiedScript, setCopiedScript] = useState<boolean>(false);
  const [savedNotice, setSavedNotice] = useState<boolean>(false);
  const [isSpeaking, setIsSpeaking] = useState<boolean>(false);
  const [ttsNotice, setTtsNotice] = useState<string>('');

  useEffect(() => {
    if (prefill) {
      setSelectedSubjectId(prefill.subjectId);
      setSelectedBranchTitle(prefill.branchTitle || '');
      setSelectedLessonTitle(prefill.lessonTitle || '');
      if (prefill.modeId) {
        setSelectedMode(prefill.modeId);
      }
      onClearPrefill();
    }
  }, [prefill, onClearPrefill]);

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const languageSchoolMode = state.settings.languageSchoolMode ?? true;

  const currentSubject = useMemo(
    () => state.subjects.find((s) => s.id === selectedSubjectId) || state.subjects[0],
    [state.subjects, selectedSubjectId]
  );

  const currentSubjectDisplay = getSubjectDisplayName(currentSubject, languageSchoolMode);
  const isCurrentEngStem = isEnglishStemSubject(currentSubject.id, languageSchoolMode);

  const activeSources = useMemo(
    () => state.sources.filter((s) => s.subjectId === selectedSubjectId && s.active),
    [state.sources, selectedSubjectId]
  );

  const availableBranches = currentSubject.branches;
  const currentBranch = availableBranches.find((b) => b.title === selectedBranchTitle);
  const availableLessons = currentBranch ? currentBranch.lessons : [];

  const currentModeMeta =
    STUDY_MODES.find((m) => m.id === selectedMode) || STUDY_MODES[0];

  const handleSubjectChange = (newId: SubjectId) => {
    setSelectedSubjectId(newId);
    setSelectedBranchTitle('');
    setSelectedLessonTitle('');
  };

  const handleBranchChange = (branchTitle: string) => {
    setSelectedBranchTitle(branchTitle);
    setSelectedLessonTitle('');
  };

  const handleGenerate = async (e?: React.FormEvent) => {
    e?.preventDefault();
    setErrorMsg('');
    setSavedNotice(false);

    const topicDisplay =
      selectedLessonTitle ||
      customTopic.trim() ||
      selectedBranchTitle ||
      currentSubjectDisplay;

    if (currentModeMeta.requiresQuestionInput && !userQuestion.trim()) {
      setErrorMsg(
        selectedMode === 'qa'
          ? 'من فضلك اكتب سؤالك في الخانة المخصصة قبل بدء الإجابة.'
          : 'من فضلك حدد الجزء المعين الذي تريد شرحه في الخانة المخصصة.'
      );
      return;
    }

    setIsLoading(true);
    setResponseText('');
    setQuizQuestions([]);
    setUserAnswers({});
    setQuizSubmitted(false);
    setLastQuizScore(null);

    try {
      const systemInstruction = buildModeSystemPrompt({
        modeId: selectedMode,
        basePersona: state.settings.systemInstruction,
        subjectNameAr: currentSubjectDisplay,
        subjectId: currentSubject.id,
        englishTrack: state.englishTrack,
        isEnglish: currentSubject.id === 'english',
        languageSchoolMode,
        activeSources,
      });

      const promptParts = [
        `المادة: ${currentSubjectDisplay}`,
        selectedBranchTitle ? `الفرع: ${selectedBranchTitle}` : '',
        selectedLessonTitle ? `الدرس: ${selectedLessonTitle}` : '',
        customTopic.trim() ? `موضوع إضافي: ${customTopic.trim()}` : '',
        `الوضع المطلوب: ${currentModeMeta.label}`,
        userQuestion.trim() ? `طلب / سؤال الطالب:\n${userQuestion.trim()}` : `اشرح موضوع "${topicDisplay}" وفقاً لقواعد الوضع المحدد بدقة.`,
      ].filter(Boolean);

      const result = await generateStudyContent({
        settings: state.settings,
        modeId: selectedMode,
        systemInstruction,
        userPrompt: promptParts.join('\n'),
      });

      if (selectedMode === 'question_bank') {
        const qs = result.questions || [];
        if (qs.length === 0) {
          throw new Error('لم يتم استلام أسئلة من الذكاء الاصطناعي. حاول مرة أخرى.');
        }
        setQuizQuestions(qs);
        setResponseText(formatQuizBankToMarkdown(currentSubjectDisplay, topicDisplay, qs));
      } else {
        setResponseText(result.text);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'حدث خطأ أثناء الاتصال بالذكاء الاصطناعي.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyText = async (textToCopy: string) => {
    try {
      await navigator.clipboard.writeText(textToCopy);
      setCopiedScript(true);
      window.setTimeout(() => setCopiedScript(false), 2000);
    } catch {
      setErrorMsg('تعذر النسخ التلقائي. يمكنك تحديد النص ونسخه يدوياً.');
    }
  };

  const handleSpeakScript = () => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      setTtsNotice('متصفحك لا يدعم القراءة الصوتية التلقائية (Web Speech API).');
      return;
    }

    if (isSpeaking) {
      window.speechSynthesis.cancel();
      setIsSpeaking(false);
      return;
    }

    setTtsNotice('');
    const utterance = new SpeechSynthesisUtterance(responseText);
    const voices = window.speechSynthesis.getVoices();
    const arabicVoice =
      voices.find((v) => v.lang.toLowerCase().startsWith('ar-eg')) ||
      voices.find((v) => v.lang.toLowerCase().startsWith('ar'));
    if (arabicVoice) {
      utterance.voice = arabicVoice;
    }
    utterance.lang = 'ar-EG';
    utterance.rate = 0.98;
    utterance.onend = () => setIsSpeaking(false);
    utterance.onerror = () => {
      setIsSpeaking(false);
      setTtsNotice('تعذر تشغيل الصوت العربي على هذا الجهاز.');
    };

    setIsSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  const handleSaveToLibrary = () => {
    const topicDisplay =
      selectedLessonTitle ||
      customTopic.trim() ||
      selectedBranchTitle ||
      currentSubjectDisplay;

    onSaveNote({
      subjectId: selectedSubjectId,
      branchTitle: selectedBranchTitle || 'عام',
      lessonTitle: topicDisplay,
      modeId: selectedMode,
      title: `${currentModeMeta.label}: ${topicDisplay}`,
      content: responseText,
      questions: selectedMode === 'question_bank' ? quizQuestions : undefined,
    });
    setSavedNotice(true);
    window.setTimeout(() => setSavedNotice(false), 2500);
  };

  const handleSubmitQuiz = () => {
    if (quizQuestions.length === 0) return;
    let correct = 0;
    for (const q of quizQuestions) {
      if (userAnswers[q.id] === q.correctIndex) {
        correct += 1;
      }
    }
    const percent = Math.round((correct / quizQuestions.length) * 100);
    setQuizSubmitted(true);
    setLastQuizScore({
      correct,
      total: quizQuestions.length,
      percent,
    });

    onRecordQuizAttempt({
      subjectId: selectedSubjectId,
      branchTitle: selectedBranchTitle || 'عام',
      lessonTitle: selectedLessonTitle || customTopic.trim() || currentSubjectDisplay,
      totalQuestions: quizQuestions.length,
      correctAnswers: correct,
      scorePercent: percent,
    });
  };

  const filteredQuestions = useMemo(() => {
    if (difficultyFilter === 'all') return quizQuestions;
    return quizQuestions.filter((q) => q.difficulty === difficultyFilter);
  }, [quizQuestions, difficultyFilter]);

  const diffLabels: Record<'easy' | 'medium' | 'hard', string> = {
    easy: 'سهل',
    medium: 'متوسط',
    hard: 'مستويات عليا',
  };

  return (
    <div className="space-y-6">
      {/* Header + Live Active Sources Status */}
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
            غرفة المذاكرة بالـ 7 أوضاع
          </h1>
          <p className="mt-1 text-sm text-slate-600 dark:text-slate-400">
            اختر المادة والدرس ثم حدد وضع المذاكرة المناسب لاحتياجك الآن
          </p>
        </div>

        <div
          data-testid="active-sources-badge"
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-xl border text-xs font-semibold shrink-0 ${
            activeSources.length > 0
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
              : 'bg-slate-100 dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400'
          }`}
        >
          {activeSources.length > 0 ? (
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
          ) : (
            <BookOpenCheck className="w-4 h-4 text-slate-400 shrink-0" />
          )}
          <span>
            {activeSources.length > 0
              ? `مصادر مفعّلة للمادة (${currentSubjectDisplay}): ${activeSources.length}`
              : `لا توجد مصادر مفعّلة لمادة ${currentSubjectDisplay} بعد`}
          </span>
        </div>
      </header>

      {/* Cascading Selectors & 7 Mode Controls */}
      <form
        onSubmit={handleGenerate}
        className="interactive-card p-5 sm:p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-6"
      >
        {/* Cascading Subject -> Branch -> Lesson */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div>
            <label
              htmlFor="study-subject"
              className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5"
            >
              المادة الدراسية
            </label>
            <select
              id="study-subject"
              value={selectedSubjectId}
              onChange={(e) => handleSubjectChange(e.target.value as SubjectId)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {state.subjects.map((sub) => (
                <option key={sub.id} value={sub.id}>
                  {getSubjectDisplayName(sub, languageSchoolMode)}
                </option>
              ))}
            </select>

            {selectedSubjectId === 'english' && (
              <div className="mt-2 flex items-center gap-1 p-1 rounded-lg bg-slate-100 dark:bg-slate-800">
                {(['O-Level', 'A-Level'] as EnglishTrack[]).map((track) => (
                  <button
                    key={track}
                    type="button"
                    onClick={() => onChangeEnglishTrack(track)}
                    className={`flex-1 py-1 rounded-md text-xs font-semibold transition-colors ${
                      state.englishTrack === track
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    {track}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div>
            <label
              htmlFor="study-branch"
              className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5"
            >
              الفرع المستخرج
            </label>
            <select
              id="study-branch"
              value={selectedBranchTitle}
              onChange={(e) => handleBranchChange(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">
                {availableBranches.length > 0
                  ? 'كل الفروع / اختيار حر'
                  : 'لا توجد فروع مستخرجة بعد'}
              </option>
              {availableBranches.map((b) => (
                <option key={b.id} value={b.title}>
                  {b.title} ({b.lessons.length})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="study-lesson"
              className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5"
            >
              الدرس المستخرج
            </label>
            <select
              id="study-lesson"
              value={selectedLessonTitle}
              onChange={(e) => setSelectedLessonTitle(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              <option value="">
                {availableLessons.length > 0 ? 'اختر الدرس...' : 'اختر موضوعاً مخصصاً'}
              </option>
              {availableLessons.map((l) => (
                <option key={l.id} value={l.title}>
                  {l.title}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="study-custom-topic"
              className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-1.5"
            >
              أو اكتب عنوان الموضوع يدوياً
            </label>
            <input
              id="study-custom-topic"
              type="text"
              value={customTopic}
              onChange={(e) => setCustomTopic(e.target.value)}
              dir={isCurrentEngStem ? 'ltr' : 'rtl'}
              placeholder={
                isCurrentEngStem
                  ? 'e.g., Complex Numbers / Aquatic Ecosystem / Python Loops'
                  : 'مثال: كان وأخواتها / المعادلات التربيعية'
              }
              className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />
          </div>
        </div>

        {/* 7 Dedicated Mode Buttons */}
        <div>
          <span className="block text-xs font-semibold text-slate-600 dark:text-slate-300 mb-2.5">
            أوضاع المذاكرة السبعة
          </span>
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-2">
            {STUDY_MODES.map((mode) => {
              const active = selectedMode === mode.id;
              return (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setSelectedMode(mode.id)}
                  className={`px-3 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-colors border whitespace-nowrap ${
                    active
                      ? 'bg-indigo-600 border-indigo-500 text-white'
                      : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 hover:border-indigo-500/50 hover:text-slate-900 dark:hover:text-white'
                  }`}
                >
                  {mode.label}
                </button>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            {currentModeMeta.shortDesc}
          </p>
        </div>

        {/* Prompt / Question Input */}
        <div className="space-y-3">
          <label
            htmlFor="study-user-prompt"
            className="block text-xs font-semibold text-slate-600 dark:text-slate-300"
          >
            {currentModeMeta.requiresQuestionInput
              ? 'السؤال أو الجزئية المطلوبة (مطلوب)'
              : 'توجيه إضافي للمعلم الذكي (اختياري)'}
          </label>
          <textarea
            id="study-user-prompt"
            rows={3}
            value={userQuestion}
            onChange={(e) => setUserQuestion(e.target.value)}
            placeholder={currentModeMeta.placeholder}
            className="w-full px-4 py-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
          />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-xs text-slate-500 dark:text-slate-400">
              {isCurrentEngStem
                ? 'نظام مدارس اللغات: الشرح بالعامية المصرية مع ذكر المصطلحات العلمية والرياضية بالإنجليزية والحالات الشاذة في النهاية'
                : 'الشرح بالعامية المصرية مع الحفاظ على المصطلحات الأكاديمية وذكر الحالات الشاذة والاستثناءات في النهاية'}
            </span>
            <button
              type="submit"
              disabled={isLoading}
              className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-semibold bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-60 transition-colors whitespace-nowrap"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  <span>
                    {selectedMode === 'question_bank'
                      ? 'جاري تجهيز بنك الـ 100 سؤال...'
                      : 'جاري تحضير الشرح...'}
                  </span>
                </>
              ) : (
                <>
                  <Sparkles className="w-4 h-4" />
                  <span>
                    {selectedMode === 'question_bank'
                      ? 'توليد بنك 100 سؤال'
                      : `تشغيل وضع: ${currentModeMeta.label}`}
                  </span>
                </>
              )}
            </button>
          </div>
        </div>
      </form>

      {/* Error Message */}
      {errorMsg && (
        <div
          role="alert"
          className="p-4 rounded-xl bg-red-500/10 border border-red-500/30 text-sm text-red-600 dark:text-red-400 flex items-start gap-3"
        >
          <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* AI Output Area */}
      {(responseText || quizQuestions.length > 0) && (
        <section
          aria-label="نتيجة المذاكرة"
          className="interactive-card p-5 sm:p-6 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-5"
        >
          {/* Output Action Toolbar */}
          <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
            <div>
              <h2 className="text-lg font-bold text-slate-900 dark:text-white">
                {currentModeMeta.label} ·{' '}
                <bdi dir={isCurrentEngStem ? 'ltr' : 'rtl'}>
                  {selectedLessonTitle || customTopic || currentSubjectDisplay}
                </bdi>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                <bdi dir={isCurrentEngStem ? 'ltr' : 'rtl'}>{currentSubjectDisplay}</bdi>
                {selectedBranchTitle ? (
                  <>
                    {' · '}
                    <bdi dir={isCurrentEngStem ? 'ltr' : 'rtl'}>{selectedBranchTitle}</bdi>
                  </>
                ) : (
                  ''
                )}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Spoken Script specific controls */}
              {selectedMode === 'script' && (
                <>
                  <button
                    type="button"
                    onClick={() => handleCopyText(responseText)}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors whitespace-nowrap"
                  >
                    {copiedScript ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                    <span>{copiedScript ? 'تم النسخ' : 'نسخ الاسكريبت'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleSpeakScript}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold transition-colors whitespace-nowrap ${
                      isSpeaking
                        ? 'bg-red-600 text-white hover:bg-red-500'
                        : 'bg-emerald-600 text-white hover:bg-emerald-500'
                    }`}
                  >
                    {isSpeaking ? (
                      <>
                        <Square className="w-3.5 h-3.5" />
                        <span>إيقاف القراءة</span>
                      </>
                    ) : (
                      <>
                        <Volume2 className="w-4 h-4" />
                        <span>قراءة صوتية</span>
                      </>
                    )}
                  </button>
                </>
              )}

              {selectedMode !== 'script' && (
                <button
                  type="button"
                  onClick={() => handleCopyText(responseText)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-100 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors whitespace-nowrap"
                >
                  {copiedScript ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                  <span>{copiedScript ? 'تم النسخ' : 'نسخ المحتوى'}</span>
                </button>
              )}

              <button
                type="button"
                onClick={handleSaveToLibrary}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold bg-indigo-600 text-white hover:bg-indigo-500 transition-colors whitespace-nowrap"
              >
                {savedNotice ? <Check className="w-4 h-4" /> : <BookmarkPlus className="w-4 h-4" />}
                <span>{savedNotice ? 'تم الحفظ في المكتبة' : 'حفظ في المكتبة'}</span>
              </button>
            </div>
          </div>

          {ttsNotice && (
            <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-600 dark:text-amber-400">
              {ttsNotice}
            </div>
          )}

          {/* Mode 2: Spoken Script strictly rendered as clean narrative paragraphs */}
          {selectedMode === 'script' && (
            <div className="space-y-4 text-base leading-8 text-slate-800 dark:text-slate-200">
              {responseText
                .split(/\n\s*\n/)
                .filter((p) => p.trim())
                .map((paragraph, idx) => (
                  <p key={idx}>{paragraph.trim()}</p>
                ))}
            </div>
          )}

          {/* Modes 1, 3, 4, 5, 6: Rich Markdown + KaTeX */}
          {selectedMode !== 'script' && selectedMode !== 'question_bank' && (
            <MarkdownRenderer content={responseText} />
          )}

          {/* Mode 7: 100-Question Bank (Interactive Quiz Mode + Readable Answer Key) */}
          {selectedMode === 'question_bank' && quizQuestions.length > 0 && (
            <div className="space-y-5">
              {/* Mode & Difficulty Controls */}
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
                  <button
                    type="button"
                    onClick={() => setQuizView('interactive')}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                      quizView === 'interactive'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    وضع الاختبار التفاعلي ({quizQuestions.length} سؤال)
                  </button>
                  <button
                    type="button"
                    onClick={() => setQuizView('answer_key')}
                    className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                      quizView === 'answer_key'
                        ? 'bg-indigo-600 text-white'
                        : 'text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    نموذج الإجابة المقروء
                  </button>
                </div>

                {quizView === 'interactive' && (
                  <div className="flex flex-wrap items-center gap-1 p-1 rounded-xl bg-slate-100 dark:bg-slate-800">
                    {(['all', 'easy', 'medium', 'hard'] as const).map((level) => (
                      <button
                        key={level}
                        type="button"
                        onClick={() => setDifficultyFilter(level)}
                        className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                          difficultyFilter === level
                            ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                            : 'text-slate-600 dark:text-slate-300'
                        }`}
                      >
                        {level === 'all' ? 'الكل' : diffLabels[level]}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {quizView === 'answer_key' ? (
                <MarkdownRenderer content={responseText} />
              ) : (
                <div className="space-y-4">
                  {/* Quiz Score Banner */}
                  {quizSubmitted && lastQuizScore && (
                    <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <CheckCircle2 className="w-6 h-6 text-emerald-500" />
                        <div>
                          <div className="text-sm font-bold text-slate-900 dark:text-white">
                            نتيجتك: {lastQuizScore.correct} من {lastQuizScore.total} ({lastQuizScore.percent}%)
                          </div>
                          <div className="text-xs text-slate-600 dark:text-slate-300">
                            تم تسجيل الدرجة تلقائياً في مؤشرات لوحة التحكم الرئيسية.
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setQuizSubmitted(false);
                          setUserAnswers({});
                          setLastQuizScore(null);
                        }}
                        className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-slate-900 dark:bg-slate-800 text-white hover:bg-slate-800"
                      >
                        إعادة المحاولة
                      </button>
                    </div>
                  )}

                  {/* Interactive Question List */}
                  <div className="space-y-4">
                    {filteredQuestions.map((q) => {
                      const chosen = userAnswers[q.id];
                      return (
                        <div
                          key={q.id}
                          className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950/70 border border-slate-200 dark:border-slate-800 space-y-3"
                        >
                          <div className="flex items-center justify-between gap-2 text-xs text-slate-500 dark:text-slate-400">
                            <span className="font-mono tabular-nums font-semibold">
                              سؤال {q.id}
                            </span>
                            <span>المستوى: {diffLabels[q.difficulty]}</span>
                          </div>

                          <p className="text-sm sm:text-base font-semibold text-slate-900 dark:text-white leading-relaxed">
                            {q.question}
                          </p>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {q.options.map((opt, optIdx) => {
                              const isSelected = chosen === optIdx;
                              const isCorrect = q.correctIndex === optIdx;

                              let btnStyle =
                                'bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 hover:border-indigo-500/50';
                              if (quizSubmitted) {
                                if (isCorrect) {
                                  btnStyle =
                                    'bg-emerald-500/15 border-emerald-500 text-emerald-700 dark:text-emerald-300';
                                } else if (isSelected && !isCorrect) {
                                  btnStyle =
                                    'bg-red-500/15 border-red-500 text-red-700 dark:text-red-300';
                                }
                              } else if (isSelected) {
                                btnStyle =
                                  'bg-indigo-600 border-indigo-500 text-white';
                              }

                              return (
                                <button
                                  key={optIdx}
                                  type="button"
                                  disabled={quizSubmitted}
                                  onClick={() =>
                                    setUserAnswers((prev) => ({
                                      ...prev,
                                      [q.id]: optIdx,
                                    }))
                                  }
                                  className={`flex items-center justify-between gap-2 px-3.5 py-2.5 rounded-xl border text-xs sm:text-sm text-right transition-colors ${btnStyle}`}
                                >
                                  <span>{opt}</span>
                                  {quizSubmitted && isCorrect && (
                                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
                                  )}
                                  {quizSubmitted && isSelected && !isCorrect && (
                                    <XCircle className="w-4 h-4 text-red-500 shrink-0" />
                                  )}
                                </button>
                              );
                            })}
                          </div>

                          {quizSubmitted && q.explanation && (
                            <div className="p-3 rounded-lg bg-slate-100 dark:bg-slate-900 text-xs text-slate-700 dark:text-slate-300">
                              <strong className="text-slate-900 dark:text-white">التفسير: </strong>
                              {q.explanation}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {!quizSubmitted && (
                    <div className="sticky bottom-4 flex justify-end">
                      <button
                        type="button"
                        onClick={handleSubmitQuiz}
                        className="px-6 py-3 rounded-xl text-sm font-bold bg-emerald-600 text-white hover:bg-emerald-500 shadow-lg transition-colors"
                      >
                        تصحيح الاختبار وتسجيل الدرجة ({Object.keys(userAnswers).length}/{quizQuestions.length} مجاب)
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* Initial Empty State before generating */}
      {!isLoading && !responseText && quizQuestions.length === 0 && !errorMsg && (
        <div className="interactive-card p-8 rounded-2xl bg-white dark:bg-slate-900 border border-dashed border-slate-300 dark:border-slate-800 text-center space-y-2">
          <BookOpenCheck className="w-9 h-9 text-indigo-500 mx-auto" />
          <h2 className="text-base font-bold text-slate-900 dark:text-white">
            غرفة المذاكرة جاهزة لبدء جلستك
          </h2>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-xl mx-auto">
            اختر المادة والدرس، ثم اضغط على أي وضع من الأوضاع السبعة واضغط تشغيل لتبدأ المذاكرة التفاعلية بالعامية المصرية.
          </p>
        </div>
      )}
    </div>
  );
};
