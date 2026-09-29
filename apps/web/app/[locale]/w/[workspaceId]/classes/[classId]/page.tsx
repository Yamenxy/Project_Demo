import { use } from 'react';
import { ClassView } from '../../../../../../components/workspace/classes-view';

export default function Page({ params }: { params: Promise<{ classId: string }> }) {
  const { classId } = use(params);
  return <ClassView classId={classId} />;
}
