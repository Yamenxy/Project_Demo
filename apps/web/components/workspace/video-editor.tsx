'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import { api, ApiError, uploadFile } from '../../lib/api';
import { ErrorMessage } from '../form';

interface Video {
  id: string;
  status: 'processing' | 'ready' | 'failed';
  durationSeconds: number | null;
  viewLimitSeconds: number | null;
}

const MAX_BYTES = 200 * 1024 * 1024;

/** Staff upload a lesson's video and set its view limit (REQ-VIDEO-003, -005). */
export function VideoEditor({ base, lessonId }: { base: string; lessonId: string }) {
  const t = useTranslations('video');
  const [video, setVideo] = useState<Video | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setVideo((await api<{ video: Video | null }>(`${base}/lessons/${lessonId}/video`)).video);
    } catch (err) {
      setError(err);
    }
  }, [base, lessonId]);

  useEffect(() => {
    void load();
  }, [load]);

  // While processing, check again every few seconds.
  useEffect(() => {
    if (video?.status !== 'processing') return;
    const timer = setInterval(() => void load(), 4000);
    return () => clearInterval(timer);
  }, [video?.status, load]);

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_BYTES) {
      setError(new ApiError(400, 'file_too_large'));
      return;
    }
    setBusy(true);
    setError(null);
    uploadFile(`${base}/lessons/${lessonId}/video`, file)
      .then(() => load())
      .catch(setError)
      .finally(() => setBusy(false));
  };

  const setLimit = (value: string) => {
    const minutes = value.trim() ? Number(value) : null;
    if (minutes !== null && (!Number.isInteger(minutes) || minutes < 1)) return;
    setBusy(true);
    api(`${base}/lessons/${lessonId}/video/limit`, {
      method: 'POST',
      body: { limitMinutes: minutes },
    })
      .then(() => load())
      .catch(setError)
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex flex-col gap-2 text-sm">
      <ErrorMessage error={error} />
      {video ? (
        <p>
          {t(`status.${video.status}`)}
          {video.durationSeconds
            ? ` · ${t('minutes', { count: Math.ceil(video.durationSeconds / 60) })}`
            : ''}
        </p>
      ) : (
        <p className="text-muted">{t('noVideo')}</p>
      )}
      <label className="inline-block cursor-pointer self-start rounded-lg border px-3 py-1">
        {busy ? t('uploading') : video ? t('replace') : t('upload')}
        <input type="file" accept="video/*" className="sr-only" disabled={busy} onChange={choose} />
      </label>
      {video?.status === 'ready' ? (
        <label className="flex items-center gap-2">
          {t('limit')}
          <input
            type="number"
            min={1}
            dir="ltr"
            defaultValue={video.viewLimitSeconds ? String(video.viewLimitSeconds / 60) : ''}
            onBlur={(event) => setLimit(event.target.value)}
            className="w-24 rounded-lg border px-2 py-1"
          />
        </label>
      ) : null}
    </div>
  );
}
