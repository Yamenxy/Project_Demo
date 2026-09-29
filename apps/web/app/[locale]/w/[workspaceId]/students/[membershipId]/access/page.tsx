import { use } from 'react';
import { StudentAccessView } from '../../../../../../../components/workspace/access-views';

export default function Page({ params }: { params: Promise<{ membershipId: string }> }) {
  const { membershipId } = use(params);
  return <StudentAccessView membershipId={membershipId} />;
}
