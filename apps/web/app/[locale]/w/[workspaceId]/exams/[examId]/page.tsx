import { use } from 'react';
import { ExamAdminView } from '../../../../../../components/workspace/exams-admin';

export default function Page({ params }: { params: Promise<{ examId: string }> }) {
  const { examId } = use(params);
  return <ExamAdminView examId={examId} />;
}
