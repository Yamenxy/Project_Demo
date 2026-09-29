import { use } from 'react';
import { ExamTaker } from '../../../../../../components/workspace/exam-taker';

export default function Page({ params }: { params: Promise<{ attemptId: string }> }) {
  const { attemptId } = use(params);
  return <ExamTaker attemptId={attemptId} />;
}
