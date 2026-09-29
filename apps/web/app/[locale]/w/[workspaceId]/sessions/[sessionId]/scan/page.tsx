import { use } from 'react';
import { ScannerView } from '../../../../../../../components/workspace/scanner-view';

export default function Page({ params }: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = use(params);
  return <ScannerView sessionId={sessionId} />;
}
