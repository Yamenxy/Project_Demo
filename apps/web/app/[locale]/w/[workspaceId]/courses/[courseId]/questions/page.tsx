import { use } from 'react';
import { QuestionsView } from '../../../../../../../components/workspace/questions-view';

export default function Page({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = use(params);
  return <QuestionsView courseId={courseId} />;
}
