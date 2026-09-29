import { integer, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

const tstz = (name: string) => timestamp(name, { withTimezone: true });

/** Mirrors drizzle/0026_video.sql. */
export const lessonVideos = pgTable('lesson_videos', {
  workspaceId: uuid('workspace_id').notNull(),
  id: uuid('id').primaryKey(),
  lessonId: uuid('lesson_id').notNull(),
  status: text('status', { enum: ['processing', 'ready', 'failed'] }).notNull(),
  durationSeconds: integer('duration_seconds'),
  renditions: text('renditions').array().notNull().default([]),
  viewLimitSeconds: integer('view_limit_seconds'),
  error: text('error'),
  uploadedBy: uuid('uploaded_by').notNull(),
  createdAt: tstz('created_at').notNull(),
  updatedAt: tstz('updated_at').notNull(),
});

export const videoWatchTime = pgTable(
  'video_watch_time',
  {
    workspaceId: uuid('workspace_id').notNull(),
    videoId: uuid('video_id').notNull(),
    membershipId: uuid('membership_id').notNull(),
    watchedSeconds: integer('watched_seconds').notNull(),
    updatedAt: tstz('updated_at').notNull(),
  },
  (t) => [primaryKey({ columns: [t.videoId, t.membershipId] })],
);
