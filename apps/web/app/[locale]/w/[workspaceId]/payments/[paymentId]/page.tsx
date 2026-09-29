import { use } from 'react';
import { ReceiptView } from '../../../../../../components/workspace/payments-view';

export default function Page({ params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = use(params);
  return <ReceiptView paymentId={paymentId} />;
}
