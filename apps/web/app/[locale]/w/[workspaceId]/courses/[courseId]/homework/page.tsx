import { use } from 'react';
import { CourseHomeworkView } from '../../../../../../../components/workspace/homework-view';

export default function Page({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = use(params);
  return <CourseHomeworkView courseId={courseId} />;
}
