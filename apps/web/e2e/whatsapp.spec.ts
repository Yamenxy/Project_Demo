import { expect, test } from '@playwright/test';
import { adminQuery, createWorkspace, signUp } from './fixtures';

test('staff who can see phones get WhatsApp links for the student and the guardian', async ({
  browser,
}) => {
  const context = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const owner = await signUp(context, { name: 'أ. وليد عمر', twoFactor: true });
  const workspaceId = await createWorkspace(owner.userId, 'أ. وليد عمر — رياضيات');
  const student = await signUp(await browser.newContext({ baseURL: 'http://localhost:3100' }), {
    name: 'جود مصطفى',
  });
  await adminQuery(`update users set guardian_phone_e164 = '+201066660000' where id = $1`, [
    student.userId,
  ]);
  await adminQuery(
    `insert into memberships (workspace_id, id, user_id, role, status, created_at, updated_at)
     values ($1, gen_random_uuid(), $2, 'student', 'active', now(), now())`,
    [workspaceId, student.userId],
  );
  const [phone] = await adminQuery<{ phone: string }>(
    'select phone_e164 as phone from users where id = $1',
    [student.userId],
  );

  const page = await context.newPage();
  await page.goto(`/ar/w/${workspaceId}/students`);
  const studentLink = page.getByRole('link', { name: 'واتساب الطالب' });
  await expect(studentLink).toHaveAttribute(
    'href',
    `https://wa.me/${(phone?.phone ?? '').slice(1)}?text=${encodeURIComponent(
      'السلام عليكم يا جود مصطفى، معك أ. وليد عمر — رياضيات.',
    )}`,
  );
  await expect(studentLink).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.getByRole('link', { name: 'واتساب ولي الأمر' })).toHaveAttribute(
    'href',
    /^https:\/\/wa\.me\/201066660000\?text=/,
  );
  await context.close();
});
