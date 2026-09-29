'use client';

import { useTranslations } from 'next-intl';
import { useState, type ChangeEvent } from 'react';
import { api, ApiError } from '../../lib/api';
import { Ltr } from '../../lib/bidi';
import { ErrorMessage } from '../form';

type RowStatus =
  | 'ok'
  | 'missing_name'
  | 'missing_phone'
  | 'invalid_phone'
  | 'duplicate_in_file'
  | 'already_member'
  | 'code_taken';

interface Report {
  committed: boolean;
  added: number;
  rows: {
    row: number;
    name: string;
    phone: string;
    internalCode: string | null;
    status: RowStatus;
  }[];
}

/** Matches the API limit (REQ-USER-002). */
const MAX_BYTES = 512 * 1024;

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Import students from an Excel or CSV file: check first, then add (REQ-USER-002). */
export function StudentImport({
  workspaceId,
  onDone,
}: {
  workspaceId: string;
  onDone: () => void;
}) {
  const t = useTranslations('studentImport');
  const [file, setFile] = useState<{ name: string; content: string } | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const send = async (content: { name: string; content: string }, commit: boolean) => {
    setBusy(true);
    setError(null);
    try {
      const result = await api<Report>(`/w/${workspaceId}/students/import`, {
        method: 'POST',
        body: { fileName: content.name, content: content.content, commit },
      });
      setReport(result);
      if (commit) {
        setFile(null);
        onDone();
      }
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const choose = (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0];
    event.target.value = '';
    setReport(null);
    setError(null);
    if (!chosen) return;
    if (chosen.size > MAX_BYTES) {
      setFile(null);
      setError(new ApiError(400, 'import_too_large'));
      return;
    }
    void chosen.arrayBuffer().then((buffer) => {
      const next = { name: chosen.name, content: toBase64(buffer) };
      setFile(next);
      void send(next, false);
    });
  };

  const problems = report?.rows.filter((row) => row.status !== 'ok') ?? [];

  return (
    <section className="rounded-2xl bg-surface p-6 shadow-sm">
      <h2 className="mb-1 font-semibold">{t('title')}</h2>
      <p className="mb-4 text-sm text-muted">{t('explain')}</p>
      <label className="inline-block cursor-pointer rounded-lg border px-4 py-2 text-sm font-semibold">
        {t('choose')}
        <input
          type="file"
          accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          className="sr-only"
          disabled={busy}
          onChange={choose}
        />
      </label>
      <ErrorMessage error={error} />

      {report ? (
        <div className="mt-4 flex flex-col gap-3" role="status">
          <p className="font-semibold">
            {report.committed
              ? t('added', { count: report.added })
              : t('ready', { count: report.added, total: report.rows.length })}
          </p>
          {problems.length > 0 ? (
            <div className="overflow-x-auto">
              <p className="mb-2 text-sm">{t('skipped', { count: problems.length })}</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-start text-muted">
                    <th className="p-1 text-start">{t('row')}</th>
                    <th className="p-1 text-start">{t('name')}</th>
                    <th className="p-1 text-start">{t('phone')}</th>
                    <th className="p-1 text-start">{t('reason')}</th>
                  </tr>
                </thead>
                <tbody>
                  {problems.map((row) => (
                    <tr key={row.row} className="border-t">
                      <td className="p-1">{row.row}</td>
                      <td className="p-1">{row.name}</td>
                      <td className="p-1">
                        <Ltr>{row.phone}</Ltr>
                      </td>
                      <td className="p-1">{t(`status.${row.status}`)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          {!report.committed && file && report.added > 0 ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void send(file, true)}
              className="rounded-lg bg-brand px-4 py-3 font-semibold text-brand-contrast"
            >
              {t('confirm', { count: report.added })}
            </button>
          ) : null}
          {report.committed && report.added > 0 ? (
            <p className="text-sm text-muted">{t('next')}</p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
