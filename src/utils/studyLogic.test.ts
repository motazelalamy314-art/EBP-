import test from 'node:test';
import assert from 'node:assert/strict';
import {
  OFFICIAL_SUBJECTS,
  STUDY_MODES,
  buildModeSystemPrompt,
  calculateDailyStreak,
  calculateDashboardKPIs,
  createInitialState,
  formatSecondsToClock,
  getSubjectDisplayDescription,
  getSubjectDisplayName,
  hasDisallowedScriptFormatting,
  isEnglishStemSubject,
  mergeExtractedCurriculum,
  sanitizeSpokenScript,
  validateAndParseBackup,
} from './studyLogic';

test('zero-start state initializes with 9 official subjects and 0 metrics/branches/lessons', () => {
  const state = createInitialState();

  assert.equal(state.subjects.length, 9);
  assert.deepEqual(
    state.subjects.map((s) => s.id),
    OFFICIAL_SUBJECTS.map((s) => s.id)
  );
  assert.equal(state.settings.languageSchoolMode, true);

  for (const sub of state.subjects) {
    assert.equal(sub.branches.length, 0);
  }

  const kpis = calculateDashboardKPIs(state, '2026-11-21');
  assert.equal(kpis.studyHours, 0);
  assert.equal(kpis.completionPercent, 0);
  assert.equal(kpis.averageQuizScore, 0);
  assert.equal(kpis.dailyStreak, 0);
  assert.equal(kpis.totalLessons, 0);
  assert.equal(kpis.completedLessons, 0);
});

test('Language School mode displays Math, Integrated Science, and Programming & AI in English', () => {
  const state = createInitialState();
  const math = state.subjects.find((s) => s.id === 'math')!;
  const science = state.subjects.find((s) => s.id === 'science')!;
  const programming = state.subjects.find((s) => s.id === 'programming')!;
  const arabic = state.subjects.find((s) => s.id === 'arabic')!;

  assert.equal(isEnglishStemSubject('math', true), true);
  assert.equal(isEnglishStemSubject('arabic', true), false);
  assert.equal(getSubjectDisplayName(math, true), 'Mathematics');
  assert.equal(getSubjectDisplayName(science, true), 'Integrated Science');
  assert.equal(getSubjectDisplayName(programming, true), 'Programming & AI');
  assert.equal(getSubjectDisplayName(arabic, true), 'اللغة العربية');
  assert.ok(getSubjectDisplayDescription(math, true).includes('Algebra'));

  // When toggled off, reverts cleanly to Arabic
  assert.equal(getSubjectDisplayName(math, false), 'الرياضيات');
  assert.equal(getSubjectDisplayName(science, false), 'العلوم المتكاملة');
  assert.equal(getSubjectDisplayName(programming, false), 'البرمجة والذكاء الاصطناعي');
});

test('KPI calculations compute study hours, completion %, average quiz score, and streak accurately', () => {
  const state = createInitialState();
  state.studyMinutes = 90; // 1.5 hours
  state.studyDates = ['2026-11-19', '2026-11-20', '2026-11-21'];
  state.subjects[0].branches = [
    {
      id: 'b1',
      title: 'النحو',
      lessons: [
        { id: 'l1', title: 'المبتدأ والخبر', completed: true },
        { id: 'l2', title: 'كان وأخواتها', completed: false },
      ],
    },
  ];
  state.quizAttempts = [
    {
      id: 'q1',
      subjectId: 'arabic',
      branchTitle: 'النحو',
      lessonTitle: 'المبتدأ والخبر',
      totalQuestions: 100,
      correctAnswers: 80,
      scorePercent: 80,
      createdAt: '2026-11-21T10:00:00Z',
    },
    {
      id: 'q2',
      subjectId: 'math',
      branchTitle: 'الجبر',
      lessonTitle: 'المعادلات',
      totalQuestions: 100,
      correctAnswers: 90,
      scorePercent: 90,
      createdAt: '2026-11-21T12:00:00Z',
    },
  ];

  const kpis = calculateDashboardKPIs(state, '2026-11-21');
  assert.equal(kpis.studyHours, 1.5);
  assert.equal(kpis.completionPercent, 50);
  assert.equal(kpis.averageQuizScore, 85);
  assert.equal(kpis.dailyStreak, 3);
});

test('daily streak resets to 0 when gap exceeds 1 day', () => {
  assert.equal(calculateDailyStreak(['2026-11-18', '2026-11-19'], '2026-11-21'), 0);
  assert.equal(calculateDailyStreak(['2026-11-19', '2026-11-20'], '2026-11-21'), 2);
});

test('mergeExtractedCurriculum preserves existing lesson completion checkmarks on re-analysis', () => {
  const existing = [
    {
      id: 'old_b',
      title: 'النحو',
      lessons: [
        { id: 'old_l1', title: 'كان وأخواتها', completed: true },
        { id: 'old_l2', title: 'كاد وأخواتها', completed: false },
      ],
    },
  ];

  const merged = mergeExtractedCurriculum(existing, [
    {
      title: 'النحو',
      lessons: ['كان وأخواتها', 'كاد وأخواتها', 'إن وأخواتها'],
    },
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].lessons.length, 3);
  assert.equal(merged[0].lessons[0].completed, true);
  assert.equal(merged[0].lessons[1].completed, false);
  assert.equal(merged[0].lessons[2].completed, false);
});

test('spoken script validator and sanitizer enforce continuous paragraphs without markdown lists/headers/tables', () => {
  const dirty = `# مقدمة
- أهلاً بيك يا بطل في درس النهاردة
1. أول فكرة معانا هي التمييز
| العمود 1 | العمود 2 |
| --- | --- |
| قيمة أ | قيمة ب |`;

  assert.equal(hasDisallowedScriptFormatting(dirty), true);
  const cleaned = sanitizeSpokenScript(dirty);
  assert.equal(hasDisallowedScriptFormatting(cleaned), false);
  assert.ok(cleaned.includes('مقدمة'));
  assert.ok(cleaned.includes('أهلاً بيك يا بطل في درس النهاردة'));
  assert.ok(cleaned.includes('قيمة أ، قيمة ب'));
});

test('all 7 study modes exist and prompt builder injects active sources, English track, and Language School STEM rules', () => {
  assert.equal(STUDY_MODES.length, 7);
  const prompt = buildModeSystemPrompt({
    modeId: 'script',
    basePersona: 'معلم مصري',
    subjectNameAr: 'اللغة الإنجليزية',
    subjectId: 'english',
    englishTrack: 'A-Level',
    isEnglish: true,
    activeSources: [
      {
        id: 's1',
        subjectId: 'english',
        title: 'Unit 1 Official Book',
        type: 'ministry_book',
        content: 'Present Perfect tense usage.',
        charCount: 27,
        active: true,
        createdAt: '2026-11-21',
      },
    ],
  });

  assert.ok(prompt.includes('A-Level'));
  assert.ok(prompt.includes('Unit 1 Official Book'));
  assert.ok(prompt.includes('ممنوع منعاً باتاً استخدام أي نقاط نقطية'));

  const stemPrompt = buildModeSystemPrompt({
    modeId: 'detailed',
    basePersona: 'معلم مصري',
    subjectNameAr: 'Mathematics',
    subjectId: 'math',
    languageSchoolMode: true,
    activeSources: [],
  });
  assert.ok(stemPrompt.includes('مدارس اللغات'));
  assert.ok(stemPrompt.includes('باللغة الإنجليزية'));
  assert.ok(stemPrompt.includes('بالعامية المصرية'));
  assert.ok(stemPrompt.includes('الحالات الشاذة والاستثناءات الخاصة بالقاعدة'));

  for (const modeId of ['detailed', 'script', 'specific', 'comprehensive_review'] as const) {
    const modePrompt = buildModeSystemPrompt({
      modeId,
      basePersona: 'معلم مصري',
      subjectNameAr: 'Integrated Science',
      subjectId: 'science',
      languageSchoolMode: true,
      activeSources: [],
    });
    assert.ok(modePrompt.includes('الحالات الشاذة والاستثناءات'));
  }
});

test('backup parser validates and restores state cleanly', () => {
  const initial = createInitialState();
  initial.studyMinutes = 50;
  const json = JSON.stringify(initial);
  const restored = validateAndParseBackup(json);
  assert.equal(restored.studyMinutes, 50);
  assert.equal(restored.subjects.length, 9);
  assert.equal(restored.settings.languageSchoolMode, true);

  assert.throws(() => validateAndParseBackup('{"subjects": []}'));
});

test('formatSecondsToClock formats MM:SS cleanly', () => {
  assert.equal(formatSecondsToClock(1500), '25:00');
  assert.equal(formatSecondsToClock(65), '01:05');
  assert.equal(formatSecondsToClock(0), '00:00');
});
