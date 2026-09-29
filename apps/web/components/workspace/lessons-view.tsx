'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Link } from '../../i18n/navigation';
import { api, ApiError } from '../../lib/api';
import { ErrorMessage } from '../form';
import { FileList } from './file-list';
import { useWorkspace } from './workspace-shell';

export interface StudentLesson {
  lessonId: string;
  courseId: string;
  courseTitle: string;
  title: string;
  position: number;
  decision:
    | { allowed: true; via: 'group' | 'grant'; groups: string[] }
    | { allowed: false; reason: string };
}

/** The lessons a student can open (REQ-CONTENT-001). */
export function MyLessonsView() {
  const t = useTranslations('lessons');
  const { workspace } = useWorkspace();
  const base = `/w/${workspace.id}`;
  const [lessons, setLessons] = useState<StudentLesson[] | null>(null);
  const [paused, setPaused] = useState(false);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api<{ lessons: StudentLesson[]; paused: boolean }>(`${base}/my/lessons`)
      .then((data) => {
        setLessons(data.lessons);
        setPaused(data.paused);
      })
      .catch(setError);
  }, [base]);

  if (!lessons) return <ErrorMessage error={error} />;
  const courses = [...new Map(lessons.map((l) => [l.courseId, l.courseTitle])).entries()];

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      {paused ? (
        <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{t('paused')}</p>
      ) : null}
      {lessons.length === 0 && !paused ? <p className="text-muted">{t('none')}</p> : null}
      {courses.map(([courseId, courseTitle]) => (
        <section key={courseId}>
          <h2 className="mb-2 font-semibold">{courseTitle}</h2>
          <ul className="flex flex-col gap-2">
            {lessons
              .filter((l) => l.courseId === courseId)
              .map((l) => (
                <li key={l.lessonId}>
                  <Link
                    href={`${base}/lessons/${l.lessonId}`}
                    className="block rounded-xl bg-surface p-3 shadow-sm hover:ring-2 hover:ring-brand"
                  >
                    {l.title}
                  </Link>
                </li>
              ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/** One lesson, through `AccessPolicy` for students or as a staff preview. */
export function LessonView({ lessonId }: { lessonId: string }) {
  const t = useTranslations('lessons');
  const { workspace } = useWorkspace();
  const [lesson, setLesson] = useState<{
    title: string;
    courseTitle: string;
    body: string | null;
    preview: boolean;
  } | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api<{ title: string; courseTitle: string; body: string | null; preview: boolean }>(
      `/w/${workspace.id}/lessons/${lessonId}`,
    )
      .then(setLesson)
      .catch((err: unknown) => {
        if (err instanceof ApiError && err.code === 'no_access') {
          const details = err.details as { reason?: string } | undefined;
          setReason(details?.reason ?? 'no_access');
        } else setError(err);
      });
  }, [workspace.id, lessonId]);

  if (reason) {
    return (
      <p className="rounded-lg bg-amber-50 p-4 text-amber-900" role="alert">
        {t(`denied.${reason}`)}
      </p>
    );
  }
  if (!lesson) return <ErrorMessage error={error} />;
  return (
    <article className="flex flex-col gap-3">
      <p className="text-sm text-muted">{lesson.courseTitle}</p>
      <h1 className="text-xl font-semibold">{lesson.title}</h1>
      {lesson.preview ? (
        <p className="rounded-lg bg-gray-100 px-3 py-1 text-xs">{t('preview')}</p>
      ) : null}
      {lesson.body ? (
        <div className="whitespace-pre-line rounded-2xl bg-surface p-5 leading-relaxed shadow-sm">
          {lesson.body}
        </div>
      ) : null}
      <FileList
        base={`/w/${workspace.id}`}
        owner="lessons"
        ownerId={lessonId}
        canUpload={false}
        accept=""
      />
    </article>
  );
}
