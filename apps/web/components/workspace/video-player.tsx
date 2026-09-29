'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../lib/api';

interface Playback {
  token: string;
  playlist: string;
  videoId: string;
}

/** Renewed before the 10-minute token expires (REQ-VIDEO-001). */
const RENEW_MS = 8 * 60 * 1000;
const PROGRESS_SECONDS = 15;

/** Approximate data per hour for each rendition (video plus 96 kbps audio), in MB. */
const LEVELS = [
  { label: '240p', mbPerHour: 180 },
  { label: '480p', mbPerHour: 400 },
];

function prefersLowData(): boolean {
  const connection = (
    navigator as Navigator & {
      connection?: { saveData?: boolean; type?: string };
    }
  ).connection;
  return Boolean(connection?.saveData) || connection?.type === 'cellular';
}

/**
 * The lesson player (REQ-VIDEO-001 to -004): HLS through hls.js, a playback token renewed while
 * playing and appended to every request, a moving watermark with the platform code and first
 * name (never the phone), watch time reported for the view limit, and the lowest quality first.
 */
export function VideoPlayer({
  base,
  lessonId,
  watermark,
}: {
  base: string;
  lessonId: string;
  watermark: string;
}) {
  const t = useTranslations('video');
  const video = useRef<HTMLVideoElement>(null);
  const token = useRef<string>('');
  const hlsRef = useRef<{ currentLevel: number; destroy: () => void } | null>(null);
  const [level, setLevel] = useState(0);
  /** 'loading', 'ready', 'none', a video status, or an API error code. */
  const [status, setStatus] = useState<string>('loading');
  const [spot, setSpot] = useState({ top: 10, left: 10 });

  useEffect(() => {
    let cancelled = false;
    let renew: ReturnType<typeof setInterval> | undefined;
    let progress: ReturnType<typeof setInterval> | undefined;

    const start = async () => {
      const info = await api<{ video: { id: string; status: string } | null }>(
        `${base}/lessons/${lessonId}/video`,
      );
      if (!info.video) return setStatus('none');
      if (info.video.status !== 'ready') return setStatus(info.video.status);
      const playback = await api<Playback>(`${base}/lessons/${lessonId}/playback`, {
        method: 'POST',
      });
      if (cancelled || !video.current) return;
      token.current = playback.token;
      const { default: Hls } = await import('hls.js');
      if (Hls.isSupported()) {
        const hls = new Hls({
          startLevel: 0,
          capLevelToPlayerSize: true,
          // Every playlist and segment request carries the current token.
          xhrSetup: (xhr, url) => {
            xhr.open('GET', url.replace(/([?&])t=[^&]*/, `$1t=${token.current}`), true);
          },
        });
        if (prefersLowData()) hls.autoLevelCapping = 1;
        hls.loadSource(playback.playlist);
        hls.attachMedia(video.current);
        hlsRef.current = hls;
      } else {
        video.current.src = playback.playlist; // Safari plays HLS natively
      }
      setStatus('ready');
      renew = setInterval(() => {
        api<Playback>(`${base}/lessons/${lessonId}/playback`, { method: 'POST' })
          .then((next) => {
            token.current = next.token;
          })
          .catch(() => undefined);
      }, RENEW_MS);
      progress = setInterval(() => {
        if (video.current && !video.current.paused) {
          void api(`${base}/video/${playback.videoId}/progress`, {
            method: 'POST',
            body: { seconds: PROGRESS_SECONDS },
          }).catch(() => undefined);
        }
      }, PROGRESS_SECONDS * 1000);
    };

    start().catch((err: unknown) => {
      setStatus(err instanceof ApiError ? err.code : 'error');
    });
    const move = setInterval(() => {
      setSpot({ top: 5 + Math.random() * 75, left: 5 + Math.random() * 60 });
    }, 5000);
    return () => {
      cancelled = true;
      clearInterval(move);
      if (renew) clearInterval(renew);
      if (progress) clearInterval(progress);
      hlsRef.current?.destroy();
    };
  }, [base, lessonId]);

  if (status === 'none') return null;
  if (status !== 'ready' && status !== 'loading') {
    return (
      <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900" role="status">
        {t.has(`status.${status}`) ? t(`status.${status}`) : t('status.error')}
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="relative overflow-hidden rounded-2xl bg-black">
        <video
          ref={video}
          controls
          playsInline
          controlsList="nodownload"
          onContextMenu={(event) => event.preventDefault()}
          className="aspect-video w-full"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute select-none text-sm font-semibold text-white/40 transition-all duration-1000"
          style={{ top: `${String(spot.top)}%`, left: `${String(spot.left)}%` }}
          dir="ltr"
        >
          {watermark}
        </span>
      </div>
      <label className="flex items-center gap-2 text-sm">
        {t('quality')}
        <select
          value={level}
          onChange={(event) => {
            const next = Number(event.target.value);
            setLevel(next);
            if (hlsRef.current) hlsRef.current.currentLevel = next;
          }}
          className="rounded-lg border px-2 py-1"
        >
          {LEVELS.map((l, i) => (
            <option key={l.label} value={i}>
              {t('level', { label: l.label, mb: l.mbPerHour })}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}
