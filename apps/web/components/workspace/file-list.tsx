'use client';

import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import { api, ApiError, uploadFile } from '../../lib/api';
import { ErrorMessage } from '../form';

interface FileItem {
  id: string;
  name: string;
  contentType: string;
  sizeBytes: number;
  status: 'quarantine' | 'available' | 'rejected';
}

/** Largest upload, as the API enforces it (REQ-FILE-001). */
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * Files of a lesson or a payment request. Downloads go through the API, which checks access on
 * every request; uploads wait in quarantine until the check job accepts them.
 */
export function FileList({
  base,
  owner,
  ownerId,
  canUpload,
  accept,
}: {
  base: string;
  owner: 'lessons' | 'payment-requests' | 'homework-submissions';
  ownerId: string;
  canUpload: boolean;
  accept: string;
}) {
  const t = useTranslations('files');
  const [items, setItems] = useState<FileItem[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const url = `${base}/${owner}/${ownerId}/files`;

  const load = useCallback(async () => {
    try {
      setItems((await api<{ files: FileItem[] }>(url)).files);
    } catch (err) {
      setError(err);
    }
  }, [url]);

  useEffect(() => {
    void load();
  }, [load]);

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
    uploadFile(`${url}?name=${encodeURIComponent(file.name)}`, file)
      .then(() => load())
      .catch(setError)
      .finally(() => setBusy(false));
  };

  return (
    <div className="flex flex-col gap-2 text-sm">
      <ErrorMessage error={error} />
      <ul className="flex flex-col gap-1">
        {items.map((f) => (
          <li key={f.id} className="flex items-center justify-between gap-2">
            {f.status === 'available' ? (
              <a href={`/api/v1${base}/files/${f.id}`} className="underline" download={f.name}>
                {f.name}
              </a>
            ) : (
              <span className="text-muted">{f.name}</span>
            )}
            <span className="text-xs text-muted">{t(`status.${f.status}`)}</span>
          </li>
        ))}
      </ul>
      {canUpload ? (
        <label className="inline-block cursor-pointer self-start rounded-lg border px-3 py-1">
          {busy ? t('uploading') : t('upload')}
          <input
            type="file"
            accept={accept}
            className="sr-only"
            disabled={busy}
            onChange={choose}
          />
        </label>
      ) : null}
    </div>
  );
}
