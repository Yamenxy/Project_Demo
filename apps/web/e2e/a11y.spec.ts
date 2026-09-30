import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { adminQuery, createWorkspace, signUp } from './fixtures';

/** Serious and critical WCAG 2.1 A/AA violations on the page, as "rule: target" lines. */
async function violations(page: Page): Promise<string[]> {
  // After an in-app navigation Next.js sets the title a moment later; check the settled page.
  await expect(page).toHaveTitle(/\S/);
  const result = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  return result.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(' ')}`));
}

test('the student flows have no serious accessibility problems, and an exam works by keyboard alone (REQ-A11Y-001)', async ({
  browser,
}) => {
  test.setTimeout(60_000);
  const guest = await browser.newContext({ baseURL: 'http://localhost:3100' });
  // Control: the checker does report a real problem (an input without a label).
  const control = await guest.newPage();
  await control.setContent(
    '<html lang="ar"><title>x</title><main><input type="text"></main></html>',
  );
  expect((await violations(control)).some((v) => v.startsWith('label:'))).toBe(true);
  const loginPage = await guest.newPage();
  await loginPage.goto('/ar/login');
  expect(await violations(loginPage), 'login').toEqual([]);
  await guest.close();

  const teacherContext = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const studentContext = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const teacher = await signUp(teacherContext, { name: 'أ. لبنى سامي', twoFactor: true });
  const student = await signUp(studentContext, { name: 'زياد فريد' });
  const workspaceId = await createWorkspace(teacher.userId, 'أ. لبنى سامي — علوم');
  const w = `/api/v1/w/${workspaceId}`;
  const [member] = await adminQuery<{ id: string }>(
    `insert into memberships (workspace_id, id, user_id, role, status, created_at, updated_at)
     values ($1, gen_random_uuid(), $2, 'student', 'active', now(), now()) returning id`,
    [workspaceId, student.userId],
  );
  const api = teacherContext.request;
  const post = async <T>(url: string, data: object): Promise<T> =>
    (await (await api.post(`${w}${url}`, { data })).json()) as T;
  const course = await post<{ id: string }>('/courses', { title: 'علوم' });
  const cls = await post<{ id: string }>('/classes', { name: 'فصل', courseId: course.id });
  await api.post(`${w}/classes/${cls.id}/students`, { data: { membershipIds: [member?.id] } });
  const [lesson] = await adminQuery<{ id: string }>(
    `insert into lessons (workspace_id, id, course_id, title, body, position, published_at, created_at, updated_at)
     values ($1, gen_random_uuid(), $2, 'الخلية', 'الخلية هي وحدة بناء الكائن الحي.', 0, now(), now(), now())
     returning id`,
    [workspaceId, course.id],
  );
  await adminQuery(
    `insert into lesson_rules (workspace_id, membership_id, lesson_id, kind, set_by, set_at)
     values ($1, $2, $3, 'grant', $4, now())`,
    [workspaceId, member?.id, lesson?.id, teacher.userId],
  );
  const q1 = await post<{ id: string }>(`/courses/${course.id}/questions`, {
    kind: 'mcq',
    body: 'وحدة بناء الكائن الحي؟',
    choices: ['الخلية', 'الذرة'],
    correctIndex: 0,
  });
  const q2 = await post<{ id: string }>(`/courses/${course.id}/questions`, {
    kind: 'short',
    body: 'ما عضية إنتاج الطاقة؟',
    accepted: ['الميتوكوندريا'],
  });
  const now = Date.now();
  const exam = await post<{ id: string }>(`/courses/${course.id}/exams`, {
    title: 'اختبار الخلية',
    timeLimitMinutes: 15,
    opensAt: new Date(now - 60_000).toISOString(),
    closesAt: new Date(now + 3_600_000).toISOString(),
    classIds: [cls.id],
    questionIds: [q1.id, q2.id],
  });
  await api.post(`${w}/exams/${exam.id}/publish`, { data: { published: true } });

  const page = await studentContext.newPage();
  await page.goto(`/ar/w/${workspaceId}/lessons/${lesson?.id ?? ''}`);
  await expect(page.getByRole('heading', { name: 'الخلية' })).toBeVisible();
  expect(await violations(page), 'lesson').toEqual([]);

  await page.goto(`/ar/w/${workspaceId}/my-payments`);
  await expect(page.getByRole('heading').first()).toBeVisible();
  expect(await violations(page), 'payment request').toEqual([]);

  // The exam, with the keyboard only: Tab to the controls, Space and Enter to act.
  await page.goto(`/ar/w/${workspaceId}/exams`);
  await expect(page.getByRole('button', { name: 'ابدأ الامتحان' })).toBeVisible();
  expect(await violations(page), 'exam list').toEqual([]);
  await page.getByRole('button', { name: 'ابدأ الامتحان' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('timer')).toBeVisible();
  expect(await violations(page), 'exam').toEqual([]);
  const choice = page.getByRole('radio', { name: 'الخلية' });
  while (!(await choice.evaluate((el) => el === document.activeElement))) {
    await page.keyboard.press('Tab');
  }
  await page.keyboard.press('Space');
  await expect(choice).toBeChecked();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  const answer = page.getByRole('textbox');
  while (!(await answer.evaluate((el) => el === document.activeElement))) {
    await page.keyboard.press('Tab');
  }
  await page.keyboard.type('الميتوكوندريا');
  await expect(page.getByText('محفوظ ✓')).toHaveCount(2);
  const submit = page.getByRole('button', { name: 'تسليم الامتحان' });
  while (!(await submit.evaluate((el) => el === document.activeElement))) {
    await page.keyboard.press('Tab');
  }
  page.once('dialog', (dialog) => void dialog.accept());
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/ar/w/${workspaceId}/exams$`));
  await teacherContext.close();
  await studentContext.close();
});
