import { matchesShortAnswer } from './normalize';
import type { Answer, ExamResponse, QuestionKind } from './schema';

/** Answers still count this long after the deadline, for slow networks (REQ-EXAM-002). */
export const GRACE_MS = 60 * 1000;

/**
 * The deadline, computed once at start (REQ-EXAM-002): the earlier of start + time limit and the
 * window end, then the student's accommodation on top, so an accommodation may go past the
 * window end.
 */
export function attemptDeadline(input: {
  startedAt: Date;
  timeLimitMinutes: number;
  closesAt: Date;
  extraMinutes: number;
}): Date {
  const byLimit = input.startedAt.getTime() + input.timeLimitMinutes * 60_000;
  const base = Math.min(byLimit, input.closesAt.getTime());
  return new Date(base + input.extraMinutes * 60_000);
}

/** Answers are accepted until the deadline plus the grace period, not a millisecond later. */
export function acceptsAnswers(deadline: Date, now: Date): boolean {
  return now.getTime() <= deadline.getTime() + GRACE_MS;
}

export function isCorrect(kind: QuestionKind, answer: Answer, response: ExamResponse): boolean {
  if (kind === 'mcq' && 'correct' in answer && 'choiceId' in response) {
    return response.choiceId === answer.correct;
  }
  if (kind === 'true_false' && 'value' in answer && 'value' in response) {
    return response.value === answer.value;
  }
  if (kind === 'short' && 'accepted' in answer && 'text' in response) {
    return matchesShortAnswer(response.text, answer.accepted, {
      arabicVariants: answer.arabicVariants,
    });
  }
  return false;
}

/** The score that counts for a student (REQ-EXAM-001): highest or latest submitted attempt. */
export function countedScore(
  attempts: { number: number; scoreCenti: number | null; submitted: boolean }[],
  rule: 'highest' | 'latest',
): number | null {
  const done = attempts.filter((a) => a.submitted && a.scoreCenti !== null);
  if (done.length === 0) return null;
  if (rule === 'latest') {
    return done.reduce((a, b) => (b.number > a.number ? b : a)).scoreCenti;
  }
  return Math.max(...done.map((a) => a.scoreCenti ?? 0));
}

/** A shuffled copy (Fisher–Yates) using the given random source. */
export function shuffled<T>(items: readonly T[], random: () => number = Math.random): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j] as T, copy[i] as T];
  }
  return copy;
}
