export type PageId =
  | 'dashboard'
  | 'study-room'
  | 'sources'
  | 'scheduler'
  | 'notes'
  | 'settings';

export type SubjectId =
  | 'arabic'
  | 'english'
  | 'german'
  | 'math'
  | 'science'
  | 'programming'
  | 'religion'
  | 'philosophy'
  | 'history';

export type EnglishTrack = 'O-Level' | 'A-Level';

export type StudyModeId =
  | 'detailed'
  | 'script'
  | 'qa'
  | 'specific'
  | 'quick_review'
  | 'comprehensive_review'
  | 'question_bank';

export type SourceType = 'ministry_book' | 'summary_sheet' | 'video_article';

export type AiProvider = 'gemini' | 'openai_compatible' | 'ollama';

export type OpenAiPreset = 'groq' | 'openrouter' | 'mistral' | 'custom';

export interface LessonItem {
  id: string;
  title: string;
  completed: boolean;
}

export interface BranchItem {
  id: string;
  title: string;
  lessons: LessonItem[];
}

export interface SubjectData {
  id: SubjectId;
  nameAr: string;
  nameEn: string;
  description: string;
  branches: BranchItem[];
}

export interface SourceItem {
  id: string;
  subjectId: SubjectId;
  title: string;
  type: SourceType;
  content: string;
  charCount: number;
  pageCount?: number;
  active: boolean;
  createdAt: string;
}

export interface SourceAnalysisReport {
  overview: string;
  coverageAssessment: string;
  keyConcepts: string[];
  studyRecommendations: string[];
  branchesCount: number;
  lessonsCount: number;
  chunksAnalyzed: number;
}

export interface QuizQuestion {
  id: number;
  question: string;
  options: string[];
  correctIndex: number;
  difficulty: 'easy' | 'medium' | 'hard';
  explanation: string;
}

export interface QuizAttempt {
  id: string;
  subjectId: SubjectId;
  branchTitle: string;
  lessonTitle: string;
  totalQuestions: number;
  correctAnswers: number;
  scorePercent: number;
  createdAt: string;
}

export interface SavedNote {
  id: string;
  subjectId: SubjectId;
  branchTitle: string;
  lessonTitle: string;
  modeId: StudyModeId;
  title: string;
  content: string;
  questions?: QuizQuestion[];
  createdAt: string;
}

export interface StudyTask {
  id: string;
  subjectId: SubjectId;
  branchTitle: string;
  lessonTitle: string;
  modeId: StudyModeId;
  durationMinutes: number;
  completed: boolean;
  notes?: string;
}

export interface ScheduleDay {
  dayIndex: number;
  dateLabel: string;
  focusTheme: string;
  tasks: StudyTask[];
}

export interface StudySchedule {
  id: string;
  examDate: string;
  dailyHours: number;
  selectedSubjects: SubjectId[];
  days: ScheduleDay[];
  createdAt: string;
}

export interface AppSettings {
  provider: AiProvider;
  modelId: string;
  customModelId: string;
  customGeminiApiKey: string;
  openAiPreset: OpenAiPreset;
  openAiBaseUrl: string;
  openAiApiKey: string;
  ollamaBaseUrl: string;
  systemInstruction: string;
  pomodoroFocusMinutes: number;
  pomodoroBreakMinutes: number;
  defaultEnglishTrack: EnglishTrack;
  languageSchoolMode: boolean;
  theme: 'dark' | 'light';
  autoSyncSources: boolean;
}

export interface StudyContextPrefill {
  subjectId: SubjectId;
  branchTitle?: string;
  lessonTitle?: string;
  modeId?: StudyModeId;
  autoTrigger?: boolean;
}

export interface AppState {
  version: number;
  subjects: SubjectData[];
  englishTrack: EnglishTrack;
  sources: SourceItem[];
  notes: SavedNote[];
  schedule: StudySchedule | null;
  studyMinutes: number;
  studyDates: string[]; // YYYY-MM-DD dates with completed focus sessions
  quizAttempts: QuizAttempt[];
  settings: AppSettings;
}
