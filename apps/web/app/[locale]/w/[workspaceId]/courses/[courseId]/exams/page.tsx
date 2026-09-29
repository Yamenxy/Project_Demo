import { use } from 'react';
import { CourseExamsView } from '../../../../../../../components/workspace/exams-admin';

export default function Page({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = use(params);
  return <CourseExamsView courseId={courseId} />;
}
