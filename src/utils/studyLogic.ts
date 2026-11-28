import type {
  AppSettings,
  AppState,
  BranchItem,
  EnglishTrack,
  OpenAiPreset,
  QuizQuestion,
  SourceItem,
  SourceType,
  StudyModeId,
  SubjectData,
  SubjectId,
} from '../types/study.ts';
import { normalizeGeminiModelId } from './aiResilience.ts';

export const STORAGE_KEY = 'bacc_ai_study_hub_state_v1';

export const DEFAULT_SYSTEM_INSTRUCTION = `أنت معلم خبير ومتخصص في منهج الصف الأول الثانوي (نظام البكالوريا المصرية الجديدة).
أسلوبك: داعم، مشجع، واضح، وبتشرح بالعامية المصرية المفهومة والقريبة من الطالب.
التزاماتك:
- الشرح نفسه والحوار والأمثلة التوضيحية يكونوا بالعامية المصرية السلسة، بينما تذكر وتكتب جميع المصطلحات العلمية والرياضية والبرمجية (Scientific, Mathematical & Programming Terms) باللغة الإنجليزية بدقة داخل الشرح (مثلاً: Discriminant, Complex Numbers, Ecosystem, Algorithm) ولا تترجم المصطلحات العلمية للعربية في المواد العلمية واللغات.
- اعتمد بشكل أساسي على مصادر الطالب المرفوعة والنشطة إن وُجدت، ولا تخترع معلومات خارج نطاق المنهج.
- استخدم المعادلات الرياضية بصيغة LaTeX ($...$ أو $$...$$) في المواد العلمية والرياضيات عند الحاجة.`;

export const OFFICIAL_SUBJECTS: Omit<SubjectData, 'branches'>[] = [
  {
    id: 'arabic',
    nameAr: 'اللغة العربية',
    nameEn: 'Arabic Language',
    description: 'النحو، البلاغة، الأدب، النصوص، القراءة المتحررة، والقصة.',
  },
  {
    id: 'english',
    nameAr: 'اللغة الإنجليزية',
    nameEn: 'English Language',
    description: 'القواعد، المفردات، القراءة، الترجمة، والمستوى الرفيع أو العادي.',
  },
  {
    id: 'german',
    nameAr: 'اللغة الألمانية',
    nameEn: 'German Language',
    description: 'القواعد، المواقف اليومية، المفردات، والقطعة والتعبير.',
  },
  {
    id: 'math',
    nameAr: 'الرياضيات',
    nameEn: 'Mathematics',
    description: 'الجبر، حساب المثلثات، والهندسة التحليلية والمستوية.',
  },
  {
    id: 'science',
    nameAr: 'العلوم المتكاملة',
    nameEn: 'Integrated Science',
    description: 'التكامل بين الفيزياء والكيمياء والأحياء والبيئة في منظومة واحدة.',
  },
  {
    id: 'programming',
    nameAr: 'البرمجة والذكاء الاصطناعي',
    nameEn: 'Programming & AI',
    description: 'أساسيات التفكير المنطقي، الخوارزميات، البرمجة، ومفاهيم الذكاء الاصطناعي.',
  },
  {
    id: 'religion',
    nameAr: 'التربية الدينية',
    nameEn: 'Religious Education',
    description: 'العقيدة، التفسير، السيرة، القيم الأخلاقية، والمعاملات.',
  },
  {
    id: 'philosophy',
    nameAr: 'الفلسفة والمنطق',
    nameEn: 'Philosophy & Logic',
    description: 'مبادئ التفكير الفلسفي، مهارات المنطق، والاستدلال العلمي.',
  },
  {
    id: 'history',
    nameAr: 'التاريخ',
    nameEn: 'History',
    description: 'تاريخ مصر والحضارات القديمة وتحليل الأحداث التاريخية.',
  },
];

export const ENGLISH_STEM_SUBJECT_IDS = new Set<SubjectId>([
  'math',
  'science',
  'programming',
]);

const ENGLISH_STEM_DESCRIPTIONS: Partial<Record<SubjectId, string>> = {
  math: 'Algebra, Trigonometry, and Analytic & Plane Geometry.',
  science: 'Physics, Chemistry, Biology, and Earth systems integration.',
  programming: 'Algorithmic thinking, programming fundamentals, and AI concepts.',
};

export function isEnglishStemSubject(
  subjectId: SubjectId,
  languageSchoolMode = true
): boolean {
  return languageSchoolMode && ENGLISH_STEM_SUBJECT_IDS.has(subjectId);
}

export function getSubjectDisplayName(
  subject: Pick<SubjectData, 'id' | 'nameAr' | 'nameEn'>,
  languageSchoolMode = true
): string {
  if (isEnglishStemSubject(subject.id, languageSchoolMode)) {
    return subject.nameEn;
  }
  return subject.nameAr;
}

export function getSubjectDisplayDescription(
  subject: Pick<SubjectData, 'id' | 'description'>,
  languageSchoolMode = true
): string {
  if (isEnglishStemSubject(subject.id, languageSchoolMode)) {
    return ENGLISH_STEM_DESCRIPTIONS[subject.id] || subject.description;
  }
  return subject.description;
}

export interface StudyModeMeta {
  id: StudyModeId;
  label: string;
  shortDesc: string;
  placeholder: string;
  requiresQuestionInput: boolean;
}

export const STUDY_MODES: StudyModeMeta[] = [
  {
    id: 'detailed',
    label: 'بالتفصيل',
    shortDesc: 'شرح شامل ومنظم خطوة بخطوة مع أمثلة وتلخيص.',
    placeholder: 'اكتب أي ملاحظة إضافية أو نقطة تحب نركز عليها أثناء الشرح التفصيلي (اختياري)...',
    requiresQuestionInput: false,
  },
  {
    id: 'script',
    label: 'اسكريبت',
    shortDesc: 'سرد صوتي متدفق بالعامية المصرية بدون نقاط أو عناوين.',
    placeholder: 'اكتب زاوية أو أسلوب معين للاسكريبت الصوتي (اختياري)...',
    requiresQuestionInput: false,
  },
  {
    id: 'qa',
    label: 'اجابة سؤال',
    shortDesc: 'إجابة دقيقة ومباشرة خطوة بخطوة مع توضيح السبب.',
    placeholder: 'اكتب سؤالك بالتفصيل هنا (مثال: ليه اخترنا الإجابة دي؟ أو حل المسألة التالية)...',
    requiresQuestionInput: true,
  },
  {
    id: 'specific',
    label: 'شرح جزء معين بذاته',
    shortDesc: 'تركيز عميق على قاعدة أو جزئية محددة فقط دون تشتيت.',
    placeholder: 'حدد الجزئية أو القاعدة المعينة اللي محتاج تفهمها بعمق...',
    requiresQuestionInput: true,
  },
  {
    id: 'quick_review',
    label: 'مراجعة سريعه',
    shortDesc: 'الزتونة ليلة الامتحان: القواعد والقوانين وأفكار التريكات.',
    placeholder: 'حدد أهم النقاط أو التريكات اللي عاوز تركز عليها في المراجعة السريعة (اختياري)...',
    requiresQuestionInput: false,
  },
  {
    id: 'comprehensive_review',
    label: 'مراجعه شامله',
    shortDesc: 'مراجعة كاملة للدرس أو الوحدة: مقارنات وأنماط أسئلة.',
    placeholder: 'اكتب اسم الوحدة أو أي أجزاء إضافية للمراجعة الشاملة (اختياري)...',
    requiresQuestionInput: false,
  },
  {
    id: 'question_bank',
    label: 'بنك اسئلة',
    shortDesc: '100 سؤال متدرج الصعوبة + اختبار تفاعلي ونموذج إجابة.',
    placeholder: 'اكتب نوعية الأسئلة أو المستوى اللي حابب تركز عليه في بنك الـ 100 سؤال (اختياري)...',
    requiresQuestionInput: false,
  },
];

export const SOURCE_TYPE_LABELS: Record<SourceType, string> = {
  ministry_book: 'كتاب الوزارة',
  summary_sheet: 'ملزمة / تلخيص',
  video_article: 'رابط فيديو / مقال',
};

export const GEMINI_MODELS = [
  { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash (سريع ومستقر — موصى به)' },
  { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro (تحليل واستنتاج متقدم)' },
  { id: 'gemini-4-hydrogen', label: 'Gemini 4 Hydrogen (متوازن للشرح التفصيلي)' },
  { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview (تجريبي فائق السرعة)' },
];

export const OPENAI_PRESETS: Record<
  OpenAiPreset,
  { label: string; baseUrl: string; defaultModel: string }
> = {
  groq: {
    label: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'llama-3.3-70b-versatile',
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    defaultModel: 'google/gemini-2.5-flash',
  },
  mistral: {
    label: 'Mistral AI',
    baseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-large-latest',
  },
  custom: {
    label: 'مخصص (Custom OpenAI)',
    baseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
  },
};

export function createDefaultSettings(): AppSettings {
  return {
    provider: 'gemini',
    modelId: 'gemini-2.5-flash',
    customModelId: '',
    customGeminiApiKey: '',
    openAiPreset: 'groq',
    openAiBaseUrl: OPENAI_PRESETS.groq.baseUrl,
    openAiApiKey: '',
    ollamaBaseUrl: 'http://localhost:11434',
    systemInstruction: DEFAULT_SYSTEM_INSTRUCTION,
    pomodoroFocusMinutes: 25,
    pomodoroBreakMinutes: 5,
    defaultEnglishTrack: 'O-Level',
    languageSchoolMode: true,
    theme: 'dark',
    autoSyncSources: false,
  };
}

export function createInitialSubjects(): SubjectData[] {
  return OFFICIAL_SUBJECTS.map((sub) => ({
    ...sub,
    branches: [],
  }));
}

export function createInitialState(): AppState {
  const settings = createDefaultSettings();
  return {
    version: 1,
    subjects: createInitialSubjects(),
    englishTrack: settings.defaultEnglishTrack,
    sources: [],
    notes: [],
    schedule: null,
    studyMinutes: 0,
    studyDates: [],
    quizAttempts: [],
    settings,
  };
}

export function getSubjectStats(subject: SubjectData) {
  const branchCount = subject.branches.length;
  let lessonCount = 0;
  let completedCount = 0;

  for (const branch of subject.branches) {
    for (const lesson of branch.lessons) {
      lessonCount += 1;
      if (lesson.completed) {
        completedCount += 1;
      }
    }
  }

  const completionPercent =
    lessonCount === 0 ? 0 : Math.round((completedCount / lessonCount) * 100);

  return {
    branchCount,
    lessonCount,
    completedCount,
    completionPercent,
  };
}

export function getTodayDateString(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function calculateDailyStreak(studyDates: string[], todayStr: string = getTodayDateString()): number {
  if (!studyDates || studyDates.length === 0) {
    return 0;
  }

  const uniqueSet = new Set(studyDates);
  const sorted = Array.from(uniqueSet).sort();
  const latest = sorted[sorted.length - 1];

  const toUtcDayNumber = (dateStr: string): number => {
    const [y, m, d] = dateStr.split('-').map(Number);
    return Math.floor(Date.UTC(y, m - 1, d) / 86400000);
  };

  const todayNum = toUtcDayNumber(todayStr);
  const latestNum = toUtcDayNumber(latest);

  // Streak breaks if latest study session was more than 1 day ago
  if (todayNum - latestNum > 1) {
    return 0;
  }

  let streak = 0;
  let cursor = latestNum;
  while (true) {
    const date = new Date(cursor * 86400000);
    const y = date.getUTCFullYear();
    const m = String(date.getUTCMonth() + 1).padStart(2, '0');
    const d = String(date.getUTCDate()).padStart(2, '0');
    const key = `${y}-${m}-${d}`;
    if (uniqueSet.has(key)) {
      streak += 1;
      cursor -= 1;
    } else {
      break;
    }
  }

  return streak;
}

export function calculateDashboardKPIs(
  state: AppState,
  todayStr: string = getTodayDateString()
) {
  const studyHours = Number((state.studyMinutes / 60).toFixed(1));

  let totalLessons = 0;
  let completedLessons = 0;
  for (const subject of state.subjects) {
    const stats = getSubjectStats(subject);
    totalLessons += stats.lessonCount;
    completedLessons += stats.completedCount;
  }

  const completionPercent =
    totalLessons === 0 ? 0 : Math.round((completedLessons / totalLessons) * 100);

  const averageQuizScore =
    state.quizAttempts.length === 0
      ? 0
      : Math.round(
          state.quizAttempts.reduce((sum, attempt) => sum + attempt.scorePercent, 0) /
            state.quizAttempts.length
        );

  const dailyStreak = calculateDailyStreak(state.studyDates, todayStr);

  return {
    studyHours,
    completionPercent,
    averageQuizScore,
    dailyStreak,
    totalLessons,
    completedLessons,
  };
}

function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, ' ').toLowerCase();
}

export function mergeExtractedCurriculum(
  existingBranches: BranchItem[],
  extractedBranches: { title: string; lessons: string[] }[]
): BranchItem[] {
  const completionMap = new Map<string, boolean>();
  for (const branch of existingBranches) {
    for (const lesson of branch.lessons) {
      completionMap.set(normalizeTitle(lesson.title), lesson.completed);
    }
  }

  return extractedBranches
    .filter((b) => b.title && b.title.trim().length > 0)
    .map((branch, branchIdx) => {
      const uniqueLessons: string[] = [];
      const seen = new Set<string>();
      for (const rawTitle of branch.lessons || []) {
        const cleaned = rawTitle.trim();
        const norm = normalizeTitle(cleaned);
        if (cleaned && !seen.has(norm)) {
          seen.add(norm);
          uniqueLessons.push(cleaned);
        }
      }

      return {
        id: `branch_${Date.now()}_${branchIdx}_${Math.random().toString(36).slice(2, 6)}`,
        title: branch.title.trim(),
        lessons: uniqueLessons.map((lessonTitle, lessonIdx) => ({
          id: `lesson_${Date.now()}_${branchIdx}_${lessonIdx}_${Math.random().toString(36).slice(2, 6)}`,
          title: lessonTitle,
          completed: completionMap.get(normalizeTitle(lessonTitle)) ?? false,
        })),
      };
    });
}

export function buildModeSystemPrompt(params: {
  modeId: StudyModeId;
  basePersona: string;
  subjectNameAr: string;
  subjectId?: SubjectId;
  englishTrack?: EnglishTrack;
  isEnglish?: boolean;
  languageSchoolMode?: boolean;
  activeSources: SourceItem[];
}): string {
  const {
    modeId,
    basePersona,
    subjectNameAr,
    subjectId,
    englishTrack,
    isEnglish,
    languageSchoolMode = true,
    activeSources,
  } = params;

  const trackLine = isEnglish
    ? `\nمسار اللغة الإنجليزية المختار للطالب هو: ${englishTrack === 'A-Level' ? 'المستوى الرفيع (A-Level)' : 'المستوى العادي (O-Level)'}. التزم بمستوى الصعوبة والمفردات المناسب لهذا المسار.`
    : '';

  const stemLanguageLine =
    subjectId && isEnglishStemSubject(subjectId, languageSchoolMode)
      ? `\nقاعدة اللغة الإلزامية لطلاب مدارس اللغات (Language Schools):
- الشرح نفسه، التوضيح، الربط المنطقي، والأسلوب يكونوا بالعامية المصرية الواضحة فقط.
- لكن جميع المصطلحات العلمية والرياضية والبرمجية (Scientific, Math & Coding Terms) والرموز والوحدات والمعادلات والأكواد وأسئلة بنك الأسئلة تكتبها وتذكرها باللغة الإنجليزية كما هي في المنهج (مثلاً: استخدم Quadratic Equation, Roots, Discriminant, Photosynthesis, Variable, Loop داخل جملة الشرح المصرية دون ترجمتها للعربية).`
      : `\nقاعدة المصطلحات: اشرح بالعامية المصرية الواضحة، وإذا تضمن الدرس أي مصطلحات علمية أو رياضية أو تقنية باللغة الإنجليزية فاذكرها بالإنجليزية داخل الشرح العربي مع توضيح معناها.`;

  const exceptionsRuleMarkdown = `- **قسم إلزامي في نهاية الشرح (الحالات الشاذة والاستثناءات):** اختم الشرح دائماً بقسم واضح بعنوان \`## الحالات الشاذة والاستثناءات الخاصة بالقاعدة\` تذكر فيه جميع الحالات الشاذة، القيود (مثل القسمة على صفر، قيود المجال Domain، أو الجذور السالبة)، الاستثناءات النحوية أو العلمية، والحالات الحدية (Edge Cases) التي يقع فيها الطلاب في الامتحانات؛ وإذا كانت القاعدة مطلقة فوضح بدقة حدود تطبيقها ومتى لا تنطبق.`;

  const sourcesContext =
    activeSources.length > 0
      ? `\n\n--- المصادر النشطة والموثوقة للمادة (${activeSources.length} مصدر) ---\nاعتمد على النصوص التالية كمصدر أساسي ورئيسي ولا تتعارض معها:\n` +
        activeSources
          .map(
            (s, idx) =>
              `[مصدر ${idx + 1}: ${s.title} (${SOURCE_TYPE_LABELS[s.type]})]\n${s.content.slice(0, 12000)}`
          )
          .join('\n\n')
      : '\n\nملاحظة: الطالب لم يفعّل مصادر مرفوعة لهذه المادة بعد، فاشرح بناءً على المنهج الرسمي المصري للصف الأول الثانوي (نظام البكالوريا) مع تذكيره بلطف في جملة قصيرة أنه يمكنه رفع مصادر المادة من قسم "مصادر المنهج" لدقة أعلى.';

  const modeRules: Record<StudyModeId, string> = {
    detailed: `وضع الشرح: "بالتفصيل"
- اشرح الدرس شرحاً شاملاً ومنظماً خطوة بخطوة بالعامية المصرية الواضحة مع ذكر المصطلحات العلمية والرياضية بالإنجليزية داخل الشرح.
- قسم الشرح بعناوين واضحة، وأعطِ أمثلة محلولة وتطبيقات عملية، ثم لخص أهم النقاط المستفادة (Key Takeaways).
${exceptionsRuleMarkdown}`,

    script: `وضع الشرح: "اسكريبت" (قواعد صارمة جداً - يجب الالتزام بها حرفياً)
- اكتب سكريبت تعليمي كامل بصيغة حديث طبيعي جداً بالعامية المصرية (معد للقراءة الصوتية كحلقة بودكاست أو فيديو يوتيوب تعليمي)، مع نطق وكتابة المصطلحات العلمية والرياضية بالإنجليزية بطبيعية داخل الجمل العربية.
- قيود التنسيق الإجبارية الصارمة:
  1. المخرجات يجب أن تكون فقرات سردية متصلة ومتدفقة فقط (Continuous flowing narrative paragraphs ONLY).
  2. ممنوع منعاً باتاً استخدام أي نقاط نقطية (Bullet points مثل * أو - أو •).
  3. ممنوع منعاً باتاً استخدام أي قوائم مرقمة (1. 2. 3.).
  4. ممنوع منعاً باتاً استخدام أي عناوين ماركداون (# أو ## أو ###).
  5. ممنوع منعاً باتاً استخدام أي جداول ماركداون (| --- |).
- ابدأ الاسكريبت بمقدمة جذابة (Hook) ترحب بالطالب وتشد انتباهه للدرس، وانتقل بسلاسة بين الأفكار باستخدام روابط كلامية طبيعية.
- **في الفقرة الأخيرة من الاسكريبت (قبل الخاتمة الودودة مباشرة):** اذكر الحالات الشاذة والاستثناءات الخاصة بالقاعدة المشروحة في صورة فقرة سردية متصلة بدون أي نقاط أو عناوين (مثلاً: "وقبل ما نقفل حلقتنا، خلي بالك من الحالات الشاذة والاستثناءات الخاصة بالقاعدة دي...").`,

    qa: `وضع الشرح: "اجابة سؤال"
- أجب على سؤال الطالب إجابة مباشرة، دقيقة، ومنظمة خطوة بخطوة بالعامية المصرية مع الحفاظ على المصطلحات العلمية والرياضية بالإنجليزية.
- وضح سبب صحة الإجابة أو خطوات الحل المنطقية، ولو كان السؤال اختيار من متعدد اشرح لماذا الإجابة الصحيحة هي الأدق ولماذا باقي الاختيارات مستبعدة.`,

    specific: `وضع الشرح: "شرح جزء معين بذاته"
- ركّز بشكل عميق ومكثف فقط على القاعدة أو المفهوم أو الجزئية المحددة التي طلبها الطالب بالعامية المصرية مع ذكر المصطلحات العلمية والرياضية بالإنجليزية.
- لا تتشتت في باقي أجزاء الدرس ولا تشرح موضوعات أخرى لم يطلبها الطالب؛ أعطِ أمثلة مركزة على هذه الجزئية تحديداً.
${exceptionsRuleMarkdown}`,

    quick_review: `وضع الشرح: "مراجعة سريعه" (الزتونة)
- قدم ملخصاً مكثفاً وسريعاً ليلة الامتحان ("الزتونة") في نقاط مركزة وواضحة بالعامية المصرية مع الإبقاء على المصطلحات العلمية والرياضية بالإنجليزية.
- ركز على القواعد الأساسية، القوانين والمعادلات الهامة، الفروق الجوهرية، وأشهر تريكات الامتحانات التي يقع فيها الطلاب.`,

    comprehensive_review: `وضع الشرح: "مراجعه شامله"
- قدم مراجعة شاملة ومتكاملة للدرس أو الوحدة بالعامية المصرية تغطي كافة القواعد والمفاهيم والمفردات والمقارنات الأساسية مع الإبقاء على المصطلحات العلمية والرياضية بالإنجليزية.
- أضف جداول مقارنة منظمة وأنماط الأسئلة المتوقعة في امتحانات البكالوريا المصرية.
${exceptionsRuleMarkdown}`,

    question_bank: `وضع الشرح: "بنك اسئلة"
- أنشئ بنك أسئلة شامل مكون من 100 سؤال بالضبط متدرج الصعوبة (35 سؤال سهل، 40 سؤال متوسط، 25 سؤال مستويات تفكير عليا).
- التزم بالبنية المطلوبة بدقة مع تقديم 4 اختيارات لكل سؤال والإجابة الصحيحة وشرح مختصر لسبب الإجابة.`,
  };

  return `${basePersona}
المادة الحالية: ${subjectNameAr}${trackLine}${stemLanguageLine}

${modeRules[modeId]}${sourcesContext}`;
}

/**
 * Ensures spoken script output strictly adheres to continuous narrative paragraphs
 * without markdown headers, bullet lists, numbered lists, or markdown tables.
 */
export function sanitizeSpokenScript(rawText: string): string {
  const lines = rawText.split(/\r?\n/);
  const cleanedLines: string[] = [];

  for (const line of lines) {
    let trimmed = line.trim();
    if (!trimmed) {
      cleanedLines.push('');
      continue;
    }

    // Skip markdown table separator rows
    if (/^\|?[\s:-]+\|[\s|:-]*$/.test(trimmed)) {
      continue;
    }

    // Convert markdown table rows to spoken text
    if (trimmed.startsWith('|') && trimmed.endsWith('|')) {
      const cells = trimmed
        .slice(1, -1)
        .split('|')
        .map((c) => c.trim())
        .filter(Boolean);
      if (cells.length > 0) {
        cleanedLines.push(cells.join('، '));
      }
      continue;
    }

    // Strip markdown heading prefixes (#, ##, ###)
    trimmed = trimmed.replace(/^#{1,6}\s+/, '');

    // Strip bullet list prefixes (-, *, •)
    trimmed = trimmed.replace(/^[-*•]\s+/, '');

    // Strip numbered list prefixes (1., 2), ١-)
    trimmed = trimmed.replace(/^(?:\d+|[٠-٩]+)[.)\-:]\s+/, '');

    // Strip bold/italic markdown markers if isolated
    trimmed = trimmed.replace(/\*\*(.*?)\*\*/g, '$1').replace(/__(.*?)__/g, '$1');

    cleanedLines.push(trimmed);
  }

  // Collapse multiple blank lines into paragraph breaks
  return cleanedLines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function hasDisallowedScriptFormatting(text: string): boolean {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (/^#{1,6}\s+/.test(trimmed)) return true;
    if (/^[-*•]\s+/.test(trimmed)) return true;
    if (/^(?:\d+|[٠-٩]+)[.)\-:]\s+/.test(trimmed)) return true;
    if (/^\|.*\|$/.test(trimmed)) return true;
  }
  return false;
}

export function formatSecondsToClock(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatQuizBankToMarkdown(
  subjectNameAr: string,
  topicTitle: string,
  questions: QuizQuestion[]
): string {
  const diffLabel: Record<QuizQuestion['difficulty'], string> = {
    easy: 'سهل',
    medium: 'متوسط',
    hard: 'مستويات عليا',
  };

  const lines: string[] = [
    `# بنك أسئلة: ${topicTitle} (${subjectNameAr})`,
    `إجمالي الأسئلة: ${questions.length} سؤالاً متدرج الصعوبة.`,
    '',
  ];

  questions.forEach((q, idx) => {
    lines.push(`### السؤال ${idx + 1} (${diffLabel[q.difficulty]})`);
    lines.push(q.question);
    lines.push('');
    q.options.forEach((opt, optIdx) => {
      const letter = ['أ', 'ب', 'ج', 'د'][optIdx] || String(optIdx + 1);
      lines.push(`- **${letter})** ${opt}`);
    });
    const correctLetter = ['أ', 'ب', 'ج', 'د'][q.correctIndex] || String(q.correctIndex + 1);
    lines.push('');
    lines.push(`> **الإجابة الصحيحة:** ${correctLetter}) ${q.options[q.correctIndex] ?? ''} — ${q.explanation}`);
    lines.push('');
  });

  return lines.join('\n');
}

export function validateAndParseBackup(rawJson: string): AppState {
  const parsed = JSON.parse(rawJson) as Partial<AppState>;
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('ملف النسخة الاحتياطية غير صالح.');
  }
  if (!Array.isArray(parsed.subjects) || parsed.subjects.length !== OFFICIAL_SUBJECTS.length) {
    throw new Error('بيانات المواد الدراسية غير مكتملة في ملف النسخة الاحتياطية.');
  }

  const defaults = createInitialState();

  const mergedSettings: AppSettings = {
    ...defaults.settings,
    ...(parsed.settings && typeof parsed.settings === 'object' ? parsed.settings : {}),
  };

  if (mergedSettings.provider === 'gemini') {
    const normalized = normalizeGeminiModelId(mergedSettings.modelId);
    mergedSettings.modelId = GEMINI_MODELS.some((m) => m.id === normalized)
      ? normalized
      : 'gemini-2.5-flash';
  }

  return {
    version: typeof parsed.version === 'number' ? parsed.version : 1,
    subjects: parsed.subjects,
    englishTrack: parsed.englishTrack === 'A-Level' ? 'A-Level' : 'O-Level',
    sources: Array.isArray(parsed.sources) ? parsed.sources : [],
    notes: Array.isArray(parsed.notes) ? parsed.notes : [],
    schedule: parsed.schedule ?? null,
    studyMinutes: typeof parsed.studyMinutes === 'number' && parsed.studyMinutes >= 0 ? parsed.studyMinutes : 0,
    studyDates: Array.isArray(parsed.studyDates) ? parsed.studyDates : [],
    quizAttempts: Array.isArray(parsed.quizAttempts) ? parsed.quizAttempts : [],
    settings: mergedSettings,
  };
}
