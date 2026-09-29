import {
  bigint,
  boolean,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

const tstz = (name: string) => timestamp(name, { withTimezone: true });

export type QuestionKind = 'mcq' | 'true_false' | 'short';
export interface Choice {
  id: string;
  text: string;
}
export type Answer =
  { correct: string } | { value: boolean } | { accepted: string[]; arabicVariants: boolean };

/** Mirrors drizzle/0028_questions.sql. */
export const questions = pgTable('questions', {
  workspaceId: uuid('workspace_id').notNull(),
  id: uuid('id').primaryKey(),
  courseId: uuid('course_id').notNull(),
  currentVersion: integer('current_version').notNull(),
  archivedAt: tstz('archived_at'),
  createdAt: tstz('created_at').notNull(),
  updatedAt: tstz('updated_at').notNull(),
});

/** Immutable: the runtime role has no UPDATE or DELETE. */
export const questionVersions = pgTable('question_versions', {
  workspaceId: uuid('workspace_id').notNull(),
  id: uuid('id').primaryKey(),
  questionId: uuid('question_id').notNull(),
  version: integer('version').notNull(),
  kind: text('kind', { enum: ['mcq', 'true_false', 'short'] }).notNull(),
  body: text('body').notNull(),
  choices: jsonb('choices').$type<Choice[]>().notNull().default([]),
  answer: jsonb('answer').$type<Answer>().notNull(),
  feedback: text('feedback'),
  pointsCenti: integer('points_centi').notNull(),
  createdBy: uuid('created_by').notNull(),
  createdAt: tstz('created_at').notNull(),
});

/** Mirrors drizzle/0029_exams.sql. */
export const exams = pgTable('exams', {
  workspaceId: uuid('workspace_id').notNull(),
  id: uuid('id').primaryKey(),
  courseId: uuid('course_id').notNull(),
  title: text('title').notNull(),
  timeLimitMinutes: integer('time_limit_minutes').notNull(),
  opensAt: tstz('opens_at').notNull(),
  closesAt: tstz('closes_at').notNull(),
  maxAttempts: integer('max_attempts').notNull().default(1),
  scoreRule: text('score_rule', { enum: ['highest', 'latest'] })
    .notNull()
    .default('highest'),
  shuffleQuestions: boolean('shuffle_questions').notNull().default(false),
  shuffleChoices: boolean('shuffle_choices').notNull().default(false),
  passPercent: integer('pass_percent'),
  publishedAt: tstz('published_at'),
  resultsReleasedAt: tstz('results_released_at'),
  createdBy: uuid('created_by').notNull(),
  createdAt: tstz('created_at').notNull(),
  updatedAt: tstz('updated_at').notNull(),
});

export const examTargets = pgTable(
  'exam_targets',
  {
    workspaceId: uuid('workspace_id').notNull(),
    examId: uuid('exam_id').notNull(),
    classId: uuid('class_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.examId, t.classId] })],
);

export const examItems = pgTable(
  'exam_items',
  {
    workspaceId: uuid('workspace_id').notNull(),
    examId: uuid('exam_id').notNull(),
    position: integer('position').notNull(),
    questionVersionId: uuid('question_version_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.examId, t.position] })],
);

export const examAccommodations = pgTable(
  'exam_accommodations',
  {
    workspaceId: uuid('workspace_id').notNull(),
    examId: uuid('exam_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    extraMinutes: integer('extra_minutes').notNull(),
  },
  (t) => [primaryKey({ columns: [t.examId, t.membershipId] })],
);

export interface AttemptLayoutEntry {
  position: number;
  choiceOrder: string[];
}

export const examAttempts = pgTable('exam_attempts', {
  workspaceId: uuid('workspace_id').notNull(),
  id: uuid('id').primaryKey(),
  examId: uuid('exam_id').notNull(),
  membershipId: uuid('membership_id').notNull(),
  number: integer('number').notNull(),
  startedAt: tstz('started_at').notNull(),
  deadlineAt: tstz('deadline_at').notNull(),
  submittedAt: tstz('submitted_at'),
  submitReason: text('submit_reason', { enum: ['student', 'timeout'] }),
  layout: jsonb('layout').$type<AttemptLayoutEntry[]>().notNull(),
  scoreCenti: integer('score_centi'),
  maxCenti: integer('max_centi').notNull(),
});

export type ExamResponse = { choiceId: string } | { value: boolean } | { text: string };

export const examAnswers = pgTable(
  'exam_answers',
  {
    workspaceId: uuid('workspace_id').notNull(),
    attemptId: uuid('attempt_id').notNull(),
    position: integer('position').notNull(),
    response: jsonb('response').$type<ExamResponse>().notNull(),
    seq: bigint('seq', { mode: 'number' }).notNull(),
    correct: boolean('correct'),
    savedAt: tstz('saved_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.attemptId, t.position] })],
);

/** Mirrors drizzle/0030_homework.sql. */
export const homework = pgTable('homework', {
  workspaceId: uuid('workspace_id').notNull(),
  id: uuid('id').primaryKey(),
  courseId: uuid('course_id').notNull(),
  title: text('title').notNull(),
  instructions: text('instructions'),
  dueAt: tstz('due_at').notNull(),
  latePolicy: text('late_policy', { enum: ['reject', 'accept_flagged'] })
    .notNull()
    .default('accept_flagged'),
  allowResubmission: boolean('allow_resubmission').notNull().default(false),
  maxScoreCenti: integer('max_score_centi').notNull(),
  publishedAt: tstz('published_at'),
  resultsReleasedAt: tstz('results_released_at'),
  createdBy: uuid('created_by').notNull(),
  createdAt: tstz('created_at').notNull(),
  updatedAt: tstz('updated_at').notNull(),
});

export const homeworkTargets = pgTable(
  'homework_targets',
  {
    workspaceId: uuid('workspace_id').notNull(),
    homeworkId: uuid('homework_id').notNull(),
    classId: uuid('class_id').notNull(),
  },
  (t) => [primaryKey({ columns: [t.homeworkId, t.classId] })],
);

export const homeworkSubmissions = pgTable('homework_submissions', {
  workspaceId: uuid('workspace_id').notNull(),
  id: uuid('id').primaryKey(),
  homeworkId: uuid('homework_id').notNull(),
  membershipId: uuid('membership_id').notNull(),
  number: integer('number').notNull(),
  text: text('text'),
  submittedAt: tstz('submitted_at').notNull(),
  late: boolean('late').notNull(),
  scoreCenti: integer('score_centi'),
  feedback: text('feedback'),
  gradedBy: uuid('graded_by'),
  gradedAt: tstz('graded_at'),
});
