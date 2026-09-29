import { Suspense } from 'react';
import { StudentsView } from '../../../../../components/workspace/students-view';

export default function Page() {
  return (
    <Suspense>
      <StudentsView />
    </Suspense>
  );
}
