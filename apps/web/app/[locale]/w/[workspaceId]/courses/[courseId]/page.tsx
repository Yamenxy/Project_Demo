import { use } from 'react';
import { CourseView } from '../../../../../../components/workspace/courses-view';

export default function Page({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = use(params);
  return <CourseView courseId={courseId} />;
}
