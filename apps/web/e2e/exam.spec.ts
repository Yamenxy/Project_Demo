import { expect, test } from '@playwright/test';
import { adminQuery, createWorkspace, signUp } from './fixtures';

test('a student takes an exam, answers while offline, and the answer is saved on reconnect', async ({
  browser,
}) => {
  const teacherContext = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const studentContext = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const teacher = await signUp(teacherContext, { name: 'أ. سامي رضا', twoFactor: true });
  const student = await signUp(studentContext, { name: 'نادين فهمي' });
  const workspaceId = await createWorkspace(teacher.userId, 'أ. سامي رضا — فيزياء');
  const w = `/api/v1/w/${workspaceId}`;
  const [member] = await adminQuery<{ id: string }>(
    `insert into memberships (workspace_id, id, user_id, role, status, created_at, updated_at)
     values ($1, gen_random_uuid(), $2, 'student', 'active', now(), now()) returning id`,
    [workspaceId, student.userId],
  );
  const api = teacherContext.request;
  const course = (await (await api.post(`${w}/courses`, { data: { title: 'فيزياء' } })).json()) as {
    id: string;
  };
  const cls = (await (
    await api.post(`${w}/classes`, { data: { name: 'فصل', courseId: course.id } })
  ).json()) as {
    id: string;
  };
  await api.post(`${w}/classes/${cls.id}/students`, { data: { membershipIds: [member?.id] } });
  const q1 = (await (
    await api.post(`${w}/courses/${course.id}/questions`, {
      data: { kind: 'mcq', body: 'وحدة القوة؟', choices: ['نيوتن', 'جول'], correctIndex: 0 },
    })
  ).json()) as { id: string };
  const q2 = (await (
    await api.post(`${w}/courses/${course.id}/questions`, {
      data: { kind: 'true_false', body: 'الضوء أسرع من الصوت', value: true },
    })
  ).json()) as { id: string };
  const now = Date.now();
  const exam = (await (
    await api.post(`${w}/courses/${course.id}/exams`, {
      data: {
        title: 'امتحان قصير',
        timeLimitMinutes: 20,
        opensAt: new Date(now - 60_000).toISOString(),
        closesAt: new Date(now + 3_600_000).toISOString(),
        classIds: [cls.id],
        questionIds: [q1.id, q2.id],
      },
    })
  ).json()) as { id: string };
  await api.post(`${w}/exams/${exam.id}/publish`, { data: { published: true } });

  const page = await studentContext.newPage();
  await page.goto(`/ar/w/${workspaceId}/exams`);
  await page.getByRole('button', { name: 'ابدأ الامتحان' }).click();
  await expect(page.getByRole('timer')).toContainText(/^(19|20):\d\d$/);
  await page.getByRole('radio', { name: 'نيوتن' }).check();
  await expect(page.getByText('محفوظ ✓')).toBeVisible();

  await studentContext.setOffline(true);
  await page.getByRole('radio', { name: 'صح' }).check();
  await expect(page.getByText('لم يُحفظ بعد', { exact: true })).toBeVisible();
  await studentContext.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
  await expect(page.getByText('لم يُحفظ بعد', { exact: true })).toHaveCount(0);

  page.once('dialog', (dialog) => void dialog.accept());
  await page.getByRole('button', { name: 'تسليم الامتحان' }).click();
  await expect(page).toHaveURL(new RegExp(`/ar/w/${workspaceId}/exams$`));

  const teacherPage = await teacherContext.newPage();
  await teacherPage.goto(`/ar/w/${workspaceId}/exams/${exam.id}`);
  await expect(teacherPage.getByText('2 من 2')).toBeVisible();
  await teacherContext.close();
  await studentContext.close();
});
