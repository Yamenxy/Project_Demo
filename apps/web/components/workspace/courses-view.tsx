'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link } from '../../i18n/navigation';
import { api } from '../../lib/api';
import { ErrorMessage, Field, SubmitButton } from '../form';
import { FileList } from './file-list';
import { useWorkspace } from './workspace-shell';

export interface CourseSummary {
  id: string;
  title: string;
  description: string | null;
  lessonCount: number;
  deleted: boolean;
}

interface Lesson {
  id: string;
  title: string;
  body: string | null;
  position: number;
  published: boolean;
}

/** Courses (REQ-CONTENT-001). */
export function CoursesView() {
  const t = useTranslations('courses');
  const { workspace, membership, permissions } = useWorkspace();
  const base = `/w/${workspace.id}`;
  const canCreate = membership.role === 'owner' || permissions.includes('content.edit');
  const [courses, setCourses] = useState<CourseSummary[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setCourses((await api<{ courses: CourseSummary[] }>(`${base}/courses`)).courses);
    } catch (err) {
      setError(err);
    }
  }, [base]);

  useEffect(() => {
    void load();
  }, [load]);

  const create = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const title = (form.elements.namedItem('title') as HTMLInputElement).value;
    setBusy(true);
    setError(null);
    api(`${base}/courses`, { method: 'POST', body: { title } })
      .then(() => {
        form.reset();
        return load();
      })
      .catch(setError)
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <ErrorMessage error={error} />
      {courses.length === 0 ? <p className="text-muted">{t('empty')}</p> : null}
      <ul className="grid gap-3 sm:grid-cols-2">
        {courses.map((c) => (
          <li key={c.id}>
            <Link
              href={`${base}/courses/${c.id}`}
              className="block rounded-2xl bg-surface p-5 shadow-sm hover:ring-2 hover:ring-brand"
            >
              <p className="font-semibold">{c.title}</p>
              <p className="text-sm text-muted">{t('lessonCount', { count: c.lessonCount })}</p>
            </Link>
          </li>
        ))}
      </ul>
      {canCreate ? (
        <section className="rounded-2xl bg-surface p-6 shadow-sm">
          <h2 className="mb-4 font-semibold">{t('createTitle')}</h2>
          <form onSubmit={create} noValidate>
            <Field label={t('courseTitle')} name="title" required />
            <SubmitButton busy={busy}>{t('create')}</SubmitButton>
          </form>
        </section>
      ) : null}
    </div>
  );
}

/** One course: its lessons in order, drafts included (staff preview). */
export function CourseView({ courseId }: { courseId: string }) {
  const t = useTranslations('courses');
  const { workspace, membership, permissions } = useWorkspace();
  const base = `/w/${workspace.id}`;
  const isOwner = membership.role === 'owner';
  const canPublish = isOwner || permissions.includes('content.publish');
  const [course, setCourse] = useState<(CourseSummary & { lessons: Lesson[] }) | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setCourse(await api(`${base}/courses/${courseId}`));
    } catch (err) {
      setError(err);
    }
  }, [base, courseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const run = (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    action()
      .then(() => load())
      .catch(setError)
      .finally(() => setBusy(false));
  };

  const addLesson = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const title = (form.elements.namedItem('title') as HTMLInputElement).value;
    run(() =>
      api(`${base}/courses/${courseId}/lessons`, { method: 'POST', body: { title } }).then(() =>
        form.reset(),
      ),
    );
  };

  const saveLesson = (lesson: Lesson, event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const title = (form.elements.namedItem('title') as HTMLInputElement).value;
    const body = (form.elements.namedItem('body') as HTMLTextAreaElement).value;
    run(() =>
      api(`${base}/lessons/${lesson.id}`, { method: 'POST', body: { title, body } }).then(() =>
        setEditing(null),
      ),
    );
  };

  /** Swaps positions with the neighbour above or below. */
  const move = (index: number, delta: number) => {
    if (!course) return;
    const a = course.lessons[index];
    const b = course.lessons[index + delta];
    if (!a || !b) return;
    run(async () => {
      await api(`${base}/lessons/${a.id}`, { method: 'POST', body: { position: index + delta } });
      await api(`${base}/lessons/${b.id}`, { method: 'POST', body: { position: index } });
    });
  };

  if (!course) return <ErrorMessage error={error} />;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href={`${base}/courses`} className="text-sm underline">
          {t('back')}
        </Link>
        <h1 className="mt-2 text-xl font-semibold">{course.title}</h1>
      </div>
      <ErrorMessage error={error} />
      <ol className="flex flex-col gap-2">
        {course.lessons.map((lesson, index) => (
          <li key={lesson.id} className="rounded-xl bg-surface p-4 shadow-sm">
            {editing === lesson.id ? (
              <form onSubmit={(event) => saveLesson(lesson, event)} noValidate>
                <Field label={t('lessonTitle')} name="title" defaultValue={lesson.title} required />
                <div className="mb-4 flex flex-col gap-1">
                  <label htmlFor={`body-${lesson.id}`} className="text-sm font-semibold">
                    {t('body')}
                  </label>
                  <textarea
                    id={`body-${lesson.id}`}
                    name="body"
                    rows={6}
                    defaultValue={lesson.body ?? ''}
                    className="rounded-lg border border-gray-300 bg-white px-3 py-3"
                  />
                </div>
                <SubmitButton busy={busy}>{t('save')}</SubmitButton>
                <div className="mt-4">
                  <p className="mb-1 text-sm font-semibold">{t('files')}</p>
                  <FileList
                    base={base}
                    owner="lessons"
                    ownerId={lesson.id}
                    canUpload
                    accept="application/pdf,image/png,image/jpeg,image/webp"
                  />
                </div>
              </form>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-semibold">{lesson.title}</p>
                  <p className="text-xs text-muted">
                    {lesson.published ? t('published') : t('draft')}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1 text-xs">
                  <button
                    type="button"
                    aria-label={t('moveUp')}
                    disabled={busy || index === 0}
                    onClick={() => move(index, -1)}
                    className="rounded-lg border px-2 py-1"
                  >
                    {t('up')}
                  </button>
                  <button
                    type="button"
                    aria-label={t('moveDown')}
                    disabled={busy || index === course.lessons.length - 1}
                    onClick={() => move(index, 1)}
                    className="rounded-lg border px-2 py-1"
                  >
                    {t('down')}
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditing(lesson.id)}
                    className="rounded-lg border px-2 py-1"
                  >
                    {t('edit')}
                  </button>
                  {canPublish ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        run(() =>
                          api(
                            `${base}/lessons/${lesson.id}/${lesson.published ? 'unpublish' : 'publish'}`,
                            { method: 'POST' },
                          ),
                        )
                      }
                      className="rounded-lg border px-2 py-1"
                    >
                      {lesson.published ? t('unpublish') : t('publish')}
                    </button>
                  ) : null}
                  {isOwner ? (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        window.confirm(t('confirmDelete', { title: lesson.title })) &&
                        run(() => api(`${base}/lessons/${lesson.id}/delete`, { method: 'POST' }))
                      }
                      className="rounded-lg border px-2 py-1 text-red-700"
                    >
                      {t('delete')}
                    </button>
                  ) : null}
                </div>
              </div>
            )}
          </li>
        ))}
      </ol>
      <section className="rounded-2xl bg-surface p-6 shadow-sm">
        <h2 className="mb-4 font-semibold">{t('addLesson')}</h2>
        <form onSubmit={addLesson} noValidate>
          <Field label={t('lessonTitle')} name="title" required />
          <SubmitButton busy={busy}>{t('add')}</SubmitButton>
        </form>
      </section>
    </div>
  );
}
