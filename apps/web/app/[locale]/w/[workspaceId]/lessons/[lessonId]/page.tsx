import { use } from 'react';
import { LessonView } from '../../../../../../components/workspace/lessons-view';

export default function Page({ params }: { params: Promise<{ lessonId: string }> }) {
  const { lessonId } = use(params);
  return <LessonView lessonId={lessonId} />;
}
