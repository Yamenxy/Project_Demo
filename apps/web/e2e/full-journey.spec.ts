import { expect, test } from '@playwright/test';
import { adminQuery, createWorkspace, joinCodeOf, signUp } from './fixtures';

/**
 * The whole product in one story, through the real screens, in Arabic: a teacher and a student
 * from the day the student joins to released results. For demos, watch it run:
 *
 *   $env:DEMO_SLOWMO = 600; pnpm --filter @lms/web test:demo      (PowerShell)
 */
test.use({ launchOptions: { slowMo: Number(process.env.DEMO_SLOWMO ?? 0) } });

test('a full teaching month: join, lesson, attendance, payment, exam, homework, announcement', async ({
  browser,
}) => {
  test.setTimeout(process.env.DEMO_SLOWMO ? 600_000 : 180_000);
  const teacherContext = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const studentContext = await browser.newContext({ baseURL: 'http://localhost:3100' });
  const teacher = await signUp(teacherContext, { name: 'أ. نادية حسن', twoFactor: true });
  await signUp(studentContext, { name: 'مريم أشرف' });
  // In real use the platform owners create the workspace from their console.
  const workspaceId = await createWorkspace(teacher.userId, 'أ. نادية حسن — كيمياء');
  const base = `/ar/w/${workspaceId}`;
  const api = `/api/v1/w/${workspaceId}`;
  const t = await teacherContext.newPage();
  const s = await studentContext.newPage();

  await test.step('the student joins with the teacher’s code, and the teacher approves', async () => {
    const code = await joinCodeOf(workspaceId);
    await s.goto(`/ar/join?code=${code}`);
    await s.getByRole('button', { name: 'إرسال الطلب' }).click();
    await expect(s.getByText('تم إرسال طلبك إلى')).toBeVisible();
    await t.goto(`${base}/students`);
    await t.getByRole('button', { name: /طلبات الانضمام/ }).click();
    await t.getByRole('button', { name: 'قبول', exact: true }).click();
    await t.getByRole('button', { name: 'كل الطلاب' }).click();
    await expect(t.getByText('مريم أشرف')).toBeVisible();
  });

  let courseUrl = '';
  await test.step('the teacher writes a course and publishes a lesson', async () => {
    await t.goto(`${base}/courses`);
    await t.getByLabel('اسم المقرر').fill('كيمياء — الترم الأول');
    await t.getByRole('button', { name: 'إنشاء' }).click();
    await t.getByRole('link', { name: /كيمياء — الترم الأول/ }).click();
    await expect(t.getByRole('heading', { name: 'كيمياء — الترم الأول' })).toBeVisible();
    courseUrl = t.url();
    await t.getByLabel('عنوان الدرس').fill('الروابط الكيميائية');
    await t.getByRole('button', { name: 'إضافة' }).click();
    await t.getByRole('button', { name: 'نشر' }).click();
    await expect(t.getByText('منشور')).toBeVisible();
  });

  let classId = '';
  await test.step('the teacher makes a class and adds the student', async () => {
    await t.goto(`${base}/classes`);
    await t.getByLabel('اسم الفصل').fill('مجموعة السبت');
    await t.getByRole('button', { name: 'إنشاء' }).click();
    await t.getByRole('link', { name: /مجموعة السبت/ }).click();
    await expect(t.getByRole('heading', { name: 'مجموعة السبت' })).toBeVisible();
    classId = t.url().split('/').at(-1) ?? '';
    await t.getByLabel('ابحث باسم الطالب أو الكود أو الرقم').fill('مريم');
    await t.getByRole('button', { name: 'إضافة', exact: true }).click();
    await expect(t.getByRole('heading', { name: 'طالب واحد' })).toBeVisible();
  });

  await test.step('an access group opens the lesson, and the student reads it', async () => {
    await s.goto(`${base}/lessons`);
    await expect(s.getByText('لا توجد دروس متاحة لك بعد.')).toBeVisible();
    await t.goto(`${base}/groups`);
    await t.getByLabel('اسم المجموعة').fill('مشتركو أكتوبر');
    await t.getByRole('button', { name: 'إنشاء' }).click();
    await t.getByRole('button', { name: /مشتركو أكتوبر/ }).click();
    await t.getByRole('checkbox', { name: 'الروابط الكيميائية' }).click();
    await t.getByLabel('ابحث عن طالب لإضافته').fill('مريم');
    await t.getByRole('button', { name: 'إضافة', exact: true }).click();
    await expect(t.getByRole('button', { name: 'إخراج' })).toBeVisible();
    await s.reload();
    await s.getByRole('link', { name: 'الروابط الكيميائية' }).click();
    await expect(s.getByRole('heading', { name: 'الروابط الكيميائية' })).toBeVisible();
  });

  await test.step('the teacher takes attendance for the Saturday class', async () => {
    await t.goto(`${base}/classes/${classId}`);
    await t.getByRole('button', { name: 'إضافة موعد أسبوعي' }).click();
    await t.getByRole('link', { name: /السبت/ }).first().click();
    await t.getByRole('group', { name: 'مريم أشرف' }).getByRole('button', { name: 'حاضر' }).click();
    await t.getByRole('button', { name: 'حفظ تغيير واحد' }).click();
    await expect(t.getByText('تم الحفظ.')).toBeVisible();
  });

  await test.step('a cash payment is recorded, and the student sees the receipt', async () => {
    await adminQuery(
      `insert into price_items (workspace_id, id, name, amount_piastres, created_at, updated_at)
       values ($1, gen_random_uuid(), 'اشتراك أكتوبر', 25000, now(), now())`,
      [workspaceId],
    );
    await t.goto(`${base}/payments`);
    await t.getByLabel('ابحث عن الطالب بالاسم أو الكود').fill('مريم');
    await t.getByRole('button', { name: /مريم أشرف/ }).click();
    await t.getByLabel('البند').selectOption({ index: 1 });
    await t.getByRole('button', { name: 'تسجيل الدفعة' }).click();
    await expect(t.getByText('تم التسجيل: إيصال رقم 1.')).toBeVisible();
    await s.goto(`${base}/my-payments`);
    await s.getByRole('link', { name: /إيصال 1/ }).click();
    await expect(s.getByText('اشتراك أكتوبر')).toBeVisible();
  });

  let examId = '';
  await test.step('the student takes an online exam, and the teacher releases the results', async () => {
    const courseId = courseUrl.split('/').at(-1) ?? '';
    const post = async <T>(url: string, data: object): Promise<T> =>
      (await (await teacherContext.request.post(`${api}${url}`, { data })).json()) as T;
    const q1 = await post<{ id: string }>(`/courses/${courseId}/questions`, {
      kind: 'mcq',
      body: 'نوع الرابطة في كلوريد الصوديوم؟',
      choices: ['أيونية', 'تساهمية'],
      correctIndex: 0,
    });
    const q2 = await post<{ id: string }>(`/courses/${courseId}/questions`, {
      kind: 'true_false',
      body: 'الماء مركب تساهمي',
      value: true,
    });
    const now = Date.now();
    examId = (
      await post<{ id: string }>(`/courses/${courseId}/exams`, {
        title: 'اختبار الروابط',
        timeLimitMinutes: 20,
        opensAt: new Date(now - 60_000).toISOString(),
        closesAt: new Date(now + 3_600_000).toISOString(),
        classIds: [classId],
        questionIds: [q1.id, q2.id],
      })
    ).id;
    await teacherContext.request.post(`${api}/exams/${examId}/publish`, {
      data: { published: true },
    });

    await s.goto(`${base}/exams`);
    await s.getByRole('button', { name: 'ابدأ الامتحان' }).click();
    await expect(s.getByRole('timer')).toBeVisible();
    await s.getByRole('radio', { name: 'أيونية' }).check();
    await s.getByRole('radio', { name: 'صح' }).check();
    await expect(s.getByText('محفوظ ✓')).toHaveCount(2);
    s.once('dialog', (dialog) => void dialog.accept());
    await s.getByRole('button', { name: 'تسليم الامتحان' }).click();
    await expect(s).toHaveURL(new RegExp(`${base}/exams$`));

    await t.goto(`${base}/exams/${examId}`);
    t.once('dialog', (dialog) => void dialog.accept());
    await t.getByRole('button', { name: 'إعلان النتائج وإضافتها للدرجات' }).click();
    await expect(t.getByText('النتائج معلنة')).toBeVisible();
    await s.goto(`${base}/grades`);
    await expect(s.getByText('اختبار الروابط')).toBeVisible();
  });

  await test.step('homework: submitted, graded with feedback, and discussed', async () => {
    await t.goto(`${courseUrl}/homework`);
    await t.getByLabel('عنوان الواجب').fill('واجب الروابط');
    await t.getByLabel('موعد التسليم (بتوقيت القاهرة)').fill('2099-01-01T20:00');
    const cls = t.getByRole('checkbox', { name: 'مجموعة السبت' });
    if (!(await cls.isChecked())) await cls.check();
    await t.getByRole('button', { name: 'إنشاء الواجب' }).click();
    await t.getByRole('button', { name: 'نشر', exact: true }).click();
    await expect(t.getByRole('button', { name: 'إلغاء النشر' })).toBeVisible();

    await s.goto(`${base}/homework`);
    await s.getByLabel('إجابتك').fill('الرابطة الأيونية تنتج عن انتقال الإلكترونات.');
    await s.getByRole('button', { name: 'تسليم', exact: true }).click();
    await expect(s.getByText(/^التسليم 1 في/)).toBeVisible();

    await t.reload();
    await t.getByRole('button', { name: 'التسليمات' }).click();
    await t.getByLabel('الدرجة', { exact: true }).fill('9');
    await t.getByLabel('ملاحظات', { exact: true }).fill('إجابة ممتازة');
    await t.getByRole('button', { name: 'حفظ الدرجة' }).click();
    await t.getByLabel('اكتب تعليقًا').fill('أضيفي مثالًا للرابطة التساهمية');
    await t.getByRole('button', { name: 'إرسال', exact: true }).click();
    await t.getByRole('button', { name: 'إعلان النتائج' }).click();
    await expect(t.getByText(/النتائج معلنة/)).toBeVisible();

    await s.reload();
    await expect(s.getByText('الدرجة: 9 من 10')).toBeVisible();
    await expect(s.getByText('أضيفي مثالًا للرابطة التساهمية')).toBeVisible();
  });

  await test.step('an announcement reaches the student', async () => {
    await t.goto(`${base}/announcements`);
    await t.getByLabel('العنوان').fill('مراجعة قبل الامتحان');
    await t.getByLabel('نص الإعلان').fill('المراجعة يوم الخميس الساعة 6 مساءً.');
    await t.getByRole('button', { name: 'نشر الإعلان' }).click();
    await expect(t.getByRole('status')).toHaveText('يُرسل الإعلان إلى طالب واحد.');
    await expect(async () => {
      await s.goto('/ar/notifications');
      await expect(s.getByText('إعلان جديد: «مراجعة قبل الامتحان».')).toBeVisible({
        timeout: 1000,
      });
    }).toPass({ timeout: 20_000 });
  });

  await test.step('the owner sees everything that happened in the activity log', async () => {
    await t.goto(`${base}/audit-log`);
    await expect(t.getByText('payment.recorded').first()).toBeVisible();
    await t.getByLabel('المجال').selectOption('homework');
    await expect(t.getByText('homework.results_released')).toBeVisible();
  });

  await teacherContext.close();
  await studentContext.close();
});
