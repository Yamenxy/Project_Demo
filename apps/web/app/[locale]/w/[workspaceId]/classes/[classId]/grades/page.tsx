import { use } from 'react';
import { GradebookView } from '../../../../../../../components/workspace/gradebook-view';

export default function Page({ params }: { params: Promise<{ classId: string }> }) {
  const { classId } = use(params);
  return <GradebookView classId={classId} />;
}
