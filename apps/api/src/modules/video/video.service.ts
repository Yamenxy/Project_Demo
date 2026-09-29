import { execFile } from 'node:child_process';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import { AppError, Clock, IdGenerator, notFound } from '../../common';
import { VIDEO_UPLOAD_LIMIT_BYTES } from '../../common/http/request-id';
import { APP_CONFIG, type AppConfig } from '../../config';
import { TenantDb, type DbTx } from '../../database';
import { JobsRuntime } from '../../jobs';
import { AuditService } from '../audit';
import { AccessService, courseScope, courses, lessons } from '../content';
import { studentScope, memberships, type WorkspaceContext } from '../tenancy';
import { lessonVideos, videoWatchTime } from './schema';

const run = promisify(execFile);

/** Playback tokens live at most 10 minutes (REQ-VIDEO-001). */
export const TOKEN_TTL_MS = 10 * 60 * 1000;

/** Renditions made by the free adapter; playback starts at the lowest (REQ-VIDEO-004). */
export const RENDITIONS = [
  { name: '240p', height: 240, videoKbps: 300 },
  { name: '480p', height: 480, videoKbps: 800 },
] as const;

/** Files a player may fetch; anything else is refused. */
const PLAYLIST = /^(master|240p|480p)\.m3u8$/;
const SEGMENT = /^(240p|480p)_\d{3,5}\.ts$/;

export interface Actor {
  userId: string;
  requestId?: string;
}

export interface VideoView {
  id: string;
  status: 'processing' | 'ready' | 'failed';
  durationSeconds: number | null;
  viewLimitSeconds: number | null;
}

/**
 * Lesson video through the `self-hls` adapter (REQ-VIDEO-001, -003, -005): ffmpeg turns the
 * upload into HLS renditions; playlists and segments are served only with a playback token that
 * is bound to the viewer's session and issued after AccessPolicy and the view limit pass.
 */
@Injectable()
export class VideoService {
  private readonly logger = new Logger('Video');
  private readonly root: string;
  private readonly tokenKey: Buffer;

  constructor(
    private readonly db: TenantDb,
    private readonly jobs: JobsRuntime,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    this.root = path.resolve(config.storage.dir);
    this.tokenKey = createHmac('sha256', config.secretEncryptionKey)
      .update('video-playback-token')
      .digest();
  }

  private sourcePath(workspaceId: string, videoId: string): string {
    return path.join(this.root, 'video-src', workspaceId, `${videoId}.src`);
  }

  private outputDir(workspaceId: string, videoId: string): string {
    return path.join(this.root, 'video', workspaceId, videoId);
  }

  /** Staff with `content.edit` for the course upload (or replace) the lesson's video. */
  async upload(
    ctx: WorkspaceContext,
    lessonId: string,
    data: unknown,
    actor: Actor,
  ): Promise<VideoView> {
    await this.db.inWorkspace(ctx.workspaceId, (tx) => this.editableLesson(tx, ctx, lessonId));
    if (!Buffer.isBuffer(data)) {
      throw new AppError(
        415,
        'unsupported_media_type',
        'Send the video as application/octet-stream',
      );
    }
    if (data.length === 0 || data.length > VIDEO_UPLOAD_LIMIT_BYTES) {
      throw new AppError(400, 'file_too_large', 'The video is empty or larger than 200 MB');
    }
    const id = this.ids.newId();
    const source = this.sourcePath(ctx.workspaceId, id);
    await mkdir(path.dirname(source), { recursive: true });
    await writeFile(source, data);
    const now = this.clock.now();
    await this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const [previous] = await tx
        .select({ id: lessonVideos.id })
        .from(lessonVideos)
        .where(eq(lessonVideos.lessonId, lessonId));
      if (previous) {
        await tx.delete(videoWatchTime).where(eq(videoWatchTime.videoId, previous.id));
        await tx.delete(lessonVideos).where(eq(lessonVideos.id, previous.id));
      }
      await tx.insert(lessonVideos).values({
        workspaceId: ctx.workspaceId,
        id,
        lessonId,
        status: 'processing',
        uploadedBy: actor.userId,
        createdAt: now,
        updatedAt: now,
      });
      await this.jobs.enqueue(tx, 'video.transcode', { workspaceId: ctx.workspaceId, videoId: id });
      await this.audit.record(tx, {
        action: 'video.uploaded',
        workspaceId: ctx.workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'lesson', id: lessonId },
        newValue: { videoId: id, sizeBytes: data.length, replaced: previous?.id ?? null },
        requestId: actor.requestId,
      });
      if (previous)
        await rm(this.outputDir(ctx.workspaceId, previous.id), { recursive: true, force: true });
    });
    return { id, status: 'processing', durationSeconds: null, viewLimitSeconds: null };
  }

  /** The transcode job: probe, then one ffmpeg run producing every rendition. Safe to repeat. */
  async transcode(workspaceId: string, videoId: string): Promise<void> {
    const [video] = await this.db.inWorkspace(workspaceId, (tx) =>
      tx.select().from(lessonVideos).where(eq(lessonVideos.id, videoId)),
    );
    if (!video || video.status !== 'processing') return;
    const source = this.sourcePath(workspaceId, videoId);
    const out = this.outputDir(workspaceId, videoId);
    try {
      const probe = await run(this.config.video.ffprobePath, [
        '-v',
        'error',
        '-show_entries',
        'format=duration:stream=codec_type',
        '-of',
        'json',
        source,
      ]);
      const info = JSON.parse(probe.stdout) as {
        format?: { duration?: string };
        streams?: { codec_type?: string }[];
      };
      const streams = info.streams ?? [];
      if (!streams.some((s) => s.codec_type === 'video')) throw new Error('no video stream');
      const hasAudio = streams.some((s) => s.codec_type === 'audio');
      await rm(out, { recursive: true, force: true });
      await mkdir(out, { recursive: true });
      await run(this.config.video.ffmpegPath, ffmpegArgs(source, out, hasAudio), {
        maxBuffer: 16 * 1024 * 1024,
      });
      await this.db.inWorkspace(workspaceId, (tx) =>
        tx
          .update(lessonVideos)
          .set({
            status: 'ready',
            durationSeconds: Math.round(Number(info.format?.duration ?? 0)),
            renditions: RENDITIONS.map((r) => r.name),
            updatedAt: this.clock.now(),
          })
          .where(eq(lessonVideos.id, videoId)),
      );
      // Originals stay kept (REQ-VIDEO-005); here on the same disk as the renditions.
    } catch (err) {
      this.logger.warn({ event: 'video_transcode_failed', videoId, err });
      await this.db.inWorkspace(workspaceId, (tx) =>
        tx
          .update(lessonVideos)
          .set({ status: 'failed', error: 'transcode_failed', updatedAt: this.clock.now() })
          .where(eq(lessonVideos.id, videoId)),
      );
    }
  }

  async forLesson(ctx: WorkspaceContext, lessonId: string): Promise<VideoView | null> {
    await this.access.lesson(ctx, lessonId); // students: AccessPolicy; staff: preview scope
    const [video] = await this.db.inWorkspace(ctx.workspaceId, (tx) =>
      tx.select().from(lessonVideos).where(eq(lessonVideos.lessonId, lessonId)),
    );
    return video ? view(video) : null;
  }

  /** Staff set or clear the view limit (REQ-VIDEO-003). */
  async setViewLimit(
    ctx: WorkspaceContext,
    lessonId: string,
    limitSeconds: number | null,
    actor: Actor,
  ): Promise<void> {
    await this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      await this.editableLesson(tx, ctx, lessonId);
      const updated = await tx
        .update(lessonVideos)
        .set({ viewLimitSeconds: limitSeconds, updatedAt: this.clock.now() })
        .where(eq(lessonVideos.lessonId, lessonId))
        .returning({ id: lessonVideos.id });
      if (updated.length === 0) throw notFound('Video not found');
      await this.audit.record(tx, {
        action: 'video.view_limit_set',
        workspaceId: ctx.workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'lesson', id: lessonId },
        newValue: { limitSeconds },
        requestId: actor.requestId,
      });
    });
  }

  /** Staff with `access.grants` reset a student's watch time (REQ-VIDEO-003). */
  async resetWatchTime(
    ctx: WorkspaceContext,
    lessonId: string,
    membershipId: string,
    actor: Actor,
  ): Promise<void> {
    await this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const [student] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(and(eq(memberships.id, membershipId), studentScope(ctx, 'access.grants')));
      if (!student) throw notFound('Student not found');
      const [video] = await tx
        .select({ id: lessonVideos.id })
        .from(lessonVideos)
        .where(eq(lessonVideos.lessonId, lessonId));
      if (!video) throw notFound('Video not found');
      await tx
        .delete(videoWatchTime)
        .where(
          and(eq(videoWatchTime.videoId, video.id), eq(videoWatchTime.membershipId, membershipId)),
        );
      await this.audit.record(tx, {
        action: 'video.watch_time_reset',
        workspaceId: ctx.workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'membership', id: membershipId },
        newValue: { lessonId },
        requestId: actor.requestId,
      });
    });
  }

  /**
   * A playback token, only after AccessPolicy and the view limit pass (REQ-VIDEO-001, -003).
   * The token is bound to this session and expires in 10 minutes; the player renews it.
   */
  async playback(
    ctx: WorkspaceContext,
    lessonId: string,
    sessionId: string,
  ): Promise<{ token: string; expiresAt: Date; playlist: string; videoId: string }> {
    await this.access.lesson(ctx, lessonId);
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const [video] = await tx
        .select()
        .from(lessonVideos)
        .where(eq(lessonVideos.lessonId, lessonId));
      if (!video || video.status !== 'ready') throw notFound('Video not ready');
      if (ctx.role === 'student' && video.viewLimitSeconds !== null) {
        const [watched] = await tx
          .select({ seconds: videoWatchTime.watchedSeconds })
          .from(videoWatchTime)
          .where(
            and(
              eq(videoWatchTime.videoId, video.id),
              eq(videoWatchTime.membershipId, ctx.membershipId),
            ),
          );
        if ((watched?.seconds ?? 0) >= video.viewLimitSeconds) {
          throw new AppError(403, 'view_limit_reached', 'The view limit for this video is used up');
        }
      }
      const expiresAt = new Date(this.clock.now().getTime() + TOKEN_TTL_MS);
      const token = this.sign(video.id, sessionId, expiresAt.getTime());
      return {
        token,
        expiresAt,
        videoId: video.id,
        playlist: `/api/v1/w/${ctx.workspaceId}/video/${video.id}/master.m3u8?t=${token}`,
      };
    });
  }

  /** Watch time reported by the player, capped per report, for the view limit. */
  async progress(ctx: WorkspaceContext, videoId: string, seconds: number): Promise<void> {
    await this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const [video] = await tx
        .select({ id: lessonVideos.id })
        .from(lessonVideos)
        .where(eq(lessonVideos.id, videoId));
      if (!video) throw notFound('Video not found');
      if (ctx.role !== 'student') return; // only students have a view limit
      await tx
        .insert(videoWatchTime)
        .values({
          workspaceId: ctx.workspaceId,
          videoId,
          membershipId: ctx.membershipId,
          watchedSeconds: seconds,
          updatedAt: this.clock.now(),
        })
        .onConflictDoUpdate({
          target: [videoWatchTime.videoId, videoWatchTime.membershipId],
          set: {
            watchedSeconds: sql`${videoWatchTime.watchedSeconds} + ${seconds}`,
            updatedAt: this.clock.now(),
          },
        });
    });
  }

  /**
   * A playlist or segment. The token must be valid, unexpired, for this video and this session.
   * Playlists also pass AccessPolicy again, so a revoked student stops at the next playlist.
   */
  async file(
    ctx: WorkspaceContext,
    videoId: string,
    name: string,
    token: string,
    sessionId: string,
  ): Promise<{ data: Buffer; contentType: string }> {
    // The video must belong to this workspace first (404), then the token must match (403).
    const [video] = await this.db.inWorkspace(ctx.workspaceId, (tx) =>
      tx.select().from(lessonVideos).where(eq(lessonVideos.id, videoId)),
    );
    if (!video || video.status !== 'ready') throw notFound('Not found');
    if (!this.verify(token, videoId, sessionId)) {
      throw new AppError(403, 'invalid_playback_token', 'Playback token is invalid or expired');
    }
    const isPlaylist = PLAYLIST.test(name);
    if (!isPlaylist && !SEGMENT.test(name)) throw notFound('Not found');
    if (isPlaylist) await this.access.lesson(ctx, video.lessonId);
    const data = await readFile(path.join(this.outputDir(ctx.workspaceId, videoId), name)).catch(
      () => {
        throw notFound('Not found');
      },
    );
    if (!isPlaylist) return { data, contentType: 'video/mp2t' };
    // Every URI in the playlist carries the token, so the player's requests stay authorised.
    const text = data
      .toString('utf-8')
      .split('\n')
      .map((line) => (line && !line.startsWith('#') ? `${line.trim()}?t=${token}` : line))
      .join('\n');
    return { data: Buffer.from(text, 'utf-8'), contentType: 'application/vnd.apple.mpegurl' };
  }

  private sign(videoId: string, sessionId: string, expiresAtMs: number): string {
    const payload = `${videoId}.${sessionId}.${String(expiresAtMs)}`;
    const mac = createHmac('sha256', this.tokenKey).update(payload).digest('base64url');
    return `${Buffer.from(payload).toString('base64url')}.${mac}`;
  }

  private verify(token: string, videoId: string, sessionId: string): boolean {
    const [encoded, mac] = token.split('.');
    if (!encoded || !mac) return false;
    const payload = Buffer.from(encoded, 'base64url').toString('utf-8');
    const expected = createHmac('sha256', this.tokenKey).update(payload).digest();
    const given = Buffer.from(mac, 'base64url');
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
    const [tokenVideo, tokenSession, expires] = payload.split('.');
    return (
      tokenVideo === videoId &&
      tokenSession === sessionId &&
      Number(expires) > this.clock.now().getTime()
    );
  }

  private async editableLesson(tx: DbTx, ctx: WorkspaceContext, lessonId: string): Promise<void> {
    const [row] = await tx
      .select({ id: lessons.id })
      .from(lessons)
      .innerJoin(courses, eq(courses.id, lessons.courseId))
      .where(and(eq(lessons.id, lessonId), courseScope(ctx, 'content.edit')));
    if (!row || ctx.role === 'student') throw notFound('Lesson not found');
  }
}

function view(video: typeof lessonVideos.$inferSelect): VideoView {
  return {
    id: video.id,
    status: video.status,
    durationSeconds: video.durationSeconds,
    viewLimitSeconds: video.viewLimitSeconds,
  };
}

/** One ffmpeg run: every rendition, 6-second segments, a master playlist. */
export function ffmpegArgs(source: string, out: string, hasAudio: boolean): string[] {
  const split = `[0:v]split=${String(RENDITIONS.length)}${RENDITIONS.map((_, i) => `[v${String(i)}]`).join('')}`;
  const scales = RENDITIONS.map(
    (r, i) => `[v${String(i)}]scale=-2:${String(r.height)}[v${String(i)}o]`,
  );
  const args = ['-y', '-i', source, '-filter_complex', [split, ...scales].join(';')];
  RENDITIONS.forEach((r, i) => {
    args.push('-map', `[v${String(i)}o]`);
    if (hasAudio) args.push('-map', '0:a:0');
    args.push(`-b:v:${String(i)}`, `${String(r.videoKbps)}k`);
  });
  args.push('-c:v', 'libx264', '-preset', 'veryfast', '-g', '48', '-sc_threshold', '0');
  if (hasAudio) args.push('-c:a', 'aac', '-b:a', '96k', '-ac', '2');
  const streamMap = RENDITIONS.map((r, i) =>
    hasAudio ? `v:${String(i)},a:${String(i)},name:${r.name}` : `v:${String(i)},name:${r.name}`,
  ).join(' ');
  args.push(
    '-f',
    'hls',
    '-hls_time',
    '6',
    '-hls_playlist_type',
    'vod',
    '-hls_segment_filename',
    path.join(out, '%v_%03d.ts'),
    '-master_pl_name',
    'master.m3u8',
    '-var_stream_map',
    streamMap,
    path.join(out, '%v.m3u8'),
  );
  return args;
}
