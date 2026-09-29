'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from '../../i18n/navigation';
import { api, ApiError } from '../../lib/api';
import {
  classify,
  dequeue,
  enqueue,
  ScanStore,
  type CachedRoster,
  type QueuedScan,
  type ScanResult,
} from '../../lib/scan';
import type { Roster } from './attendance-view';
import { useWorkspace } from './workspace-shell';

interface Detector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
type DetectorClass = new (options: { formats: string[] }) => Detector;

const COLORS: Record<ScanResult['kind'], string> = {
  ok: 'bg-green-600 text-white',
  paused: 'bg-amber-500 text-white',
  not_in_class: 'bg-amber-500 text-white',
  unknown: 'bg-red-600 text-white',
};

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * QR attendance (REQ-ATT-001). The roster is cached when the page opens online; scans are
 * classified on the device and queued, then uploaded as idempotent upserts whenever there's a
 * connection. Uses the browser's BarcodeDetector when present; typing the code always works.
 */
export function ScannerView({ sessionId }: { sessionId: string }) {
  const t = useTranslations('scanner');
  const { workspace } = useWorkspace();
  const base = `/w/${workspace.id}`;
  const store = useRef<ScanStore | null>(null);
  const [roster, setRoster] = useState<CachedRoster | null>(null);
  const [queue, setQueue] = useState<QueuedScan[]>([]);
  const [sent, setSent] = useState(0);
  const [last, setLast] = useState<ScanResult | null>(null);
  const [online, setOnline] = useState(true);
  const [camera, setCamera] = useState<'off' | 'on' | 'unsupported'>('off');
  const [error, setError] = useState<string | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const lastCode = useRef<{ code: string; at: number } | null>(null);
  /** One upload at a time, so a batch is never counted twice. */
  const uploading = useRef(false);

  useEffect(() => {
    const s = new ScanStore(sessionId, storage());
    store.current = s;
    setRoster(s.roster());
    setQueue(s.queue());
    setOnline(navigator.onLine);
    api<Roster>(`${base}/sessions/${sessionId}/attendance`)
      .then((data) => {
        const cached: CachedRoster = {
          sessionId,
          students: data.students,
          others: data.others,
        };
        s.saveRoster(cached);
        setRoster(cached);
      })
      .catch(() => undefined); // offline: the cached roster (if any) is used
  }, [base, sessionId]);

  const upload = useCallback(async () => {
    const s = store.current;
    if (!s || uploading.current) return;
    const pending = s.queue();
    if (pending.length === 0) return;
    uploading.current = true;
    try {
      await api(`${base}/sessions/${sessionId}/attendance`, {
        method: 'POST',
        body: {
          records: pending.map((q) => ({
            membershipId: q.membershipId,
            status: 'present',
            method: 'qr',
            takenAt: q.takenAt,
          })),
        },
      });
      const rest = dequeue(s.queue(), pending);
      s.saveQueue(rest);
      setQueue(rest);
      setSent((n) => n + pending.length);
      setError(null);
    } catch (err) {
      // Offline or server busy: keep the queue and try again later. A refusal is shown.
      if (err instanceof ApiError && err.status < 500) setError(err.code);
    } finally {
      uploading.current = false;
    }
  }, [base, sessionId]);

  useEffect(() => {
    const goOnline = () => {
      setOnline(true);
      void upload();
    };
    const goOffline = () => setOnline(false);
    window.addEventListener('online', goOnline);
    window.addEventListener('offline', goOffline);
    const timer = setInterval(() => void upload(), 15_000);
    return () => {
      window.removeEventListener('online', goOnline);
      window.removeEventListener('offline', goOffline);
      clearInterval(timer);
    };
  }, [upload]);

  const accept = useCallback(
    (raw: string) => {
      const s = store.current;
      if (!roster || !s) return;
      const result = classify(raw, roster);
      setLast(result);
      if (result.kind !== 'ok') return;
      const next = enqueue(s.queue(), {
        membershipId: result.student.membershipId,
        takenAt: new Date().toISOString(),
      });
      s.saveQueue(next);
      setQueue(next);
      void upload();
    },
    [roster, upload],
  );

  const recordAnyway = () => {
    const s = store.current;
    if (!s || !last || last.kind === 'unknown' || last.kind === 'ok') return;
    const next = enqueue(s.queue(), {
      membershipId: last.student.membershipId,
      takenAt: new Date().toISOString(),
    });
    s.saveQueue(next);
    setQueue(next);
    setLast({ kind: 'ok', student: last.student });
    void upload();
  };

  const startCamera = async () => {
    const Detector = (window as unknown as { BarcodeDetector?: DetectorClass }).BarcodeDetector;
    if (!Detector || !navigator.mediaDevices?.getUserMedia) {
      setCamera('unsupported');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      if (!video.current) return;
      video.current.srcObject = stream;
      await video.current.play();
      setCamera('on');
      const detector = new Detector({ formats: ['qr_code'] });
      const tick = async () => {
        if (!video.current || video.current.srcObject !== stream) return;
        try {
          const codes = await detector.detect(video.current);
          const raw = codes[0]?.rawValue;
          const now = Date.now();
          // The same code seen again within 3 seconds is the same scan.
          if (raw && (lastCode.current?.code !== raw || now - lastCode.current.at > 3000)) {
            lastCode.current = { code: raw, at: now };
            accept(raw);
          }
        } catch {
          // A frame that can't be read; try the next one.
        }
        setTimeout(() => void tick(), 300);
      };
      void tick();
    } catch {
      setCamera('unsupported');
    }
  };

  useEffect(() => {
    const element = video.current;
    return () => {
      const stream = element?.srcObject as MediaStream | null;
      stream?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  const typed = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const input = event.currentTarget.elements.namedItem('code') as HTMLInputElement;
    if (input.value.trim()) accept(input.value);
    input.value = '';
    input.focus();
  };

  if (!roster) {
    return (
      <p className="text-muted" role="status">
        {t('noRoster')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <Link href={`${base}/sessions/${sessionId}`} className="text-sm underline">
          {t('backToList')}
        </Link>
      </div>
      <p className="text-sm" role="status">
        {online ? t('online') : t('offline')} · {t('waiting', { count: queue.length })} ·{' '}
        {t('uploaded', { count: sent })}
      </p>
      {error ? (
        <p className="rounded-lg bg-red-50 p-2 text-sm text-red-800">{t('refused')}</p>
      ) : null}

      <video
        ref={video}
        className={camera === 'on' ? 'w-full rounded-xl' : 'hidden'}
        muted
        playsInline
      />
      {camera === 'off' ? (
        <button
          type="button"
          onClick={() => void startCamera()}
          className="rounded-lg bg-brand px-4 py-3 font-semibold text-brand-contrast"
        >
          {t('startCamera')}
        </button>
      ) : null}
      {camera === 'unsupported' ? (
        <p className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">{t('noCamera')}</p>
      ) : null}

      <form onSubmit={typed} className="flex gap-2">
        <input
          name="code"
          aria-label={t('typeCode')}
          placeholder={t('typeCode')}
          dir="ltr"
          autoCapitalize="characters"
          autoComplete="off"
          className="min-w-0 flex-1 rounded-lg border px-3 py-2 font-mono"
        />
        <button type="submit" className="rounded-lg border px-4 py-2">
          {t('check')}
        </button>
      </form>

      {last ? (
        <div role="alert" className={`rounded-2xl p-5 text-center ${COLORS[last.kind]}`}>
          <p className="text-lg font-semibold">
            {last.kind === 'unknown' ? last.code : last.student.name}
          </p>
          <p>{t(`result.${last.kind}`)}</p>
          {last.kind === 'paused' || last.kind === 'not_in_class' ? (
            <button
              type="button"
              onClick={recordAnyway}
              className="mt-2 rounded-lg bg-white px-3 py-1 text-sm text-gray-900"
            >
              {t('recordAnyway')}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
