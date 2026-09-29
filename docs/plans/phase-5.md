# Phase 5 plan: content and access

Goal: the teacher publishes lessons and decides, by hand, who can open them (OD-02): access
groups, individual grants and blocks, and "pause all access". One `AccessPolicy` answers every
lesson, file and video request. Everything free; paid items stay in
[paid-services.md](../paid-services.md).

| # | Task | Requirements | Modules |
|---|---|---|---|
| 5.1 | Courses and lessons: create, order, edit text, publish and unpublish, soft delete restorable for 30 days; a class can be linked to a course, which turns on the "same course" enrolment rule with an audited override | REQ-CONTENT-002, REQ-CLASS-001 | content (new), classes, web |
| 5.2 | Access: groups (lessons and students, "add all students from class"), individual grant or block per (student, lesson), pause and resume, "remove from all groups and grants" (owner), bulk operations in one audited transaction each; `AccessPolicy` with a table-driven test; the student's lesson list with the reason for access | REQ-CONTENT-001, -005 to -010, REQ-PAY-009 shortcuts | content, web |
| 5.3 | Files: a storage adapter (local disk for the free setup; S3-compatible later), uploads in quarantine checked by a job (size, magic bytes), lesson attachments served only through `AccessPolicy`, proof images on payment requests | REQ-FILE-001, REQ-PAY-010 | files (new), content, payments, web |
| 5.4 | Video `self-hls`: ffmpeg job to HLS renditions, short-lived session-bound playback tokens after `AccessPolicy`, watermark with the platform code and first name, view limits by watch time | REQ-VIDEO-001 to -005 | video (new), web |

Task 5.4 needs ffmpeg on the worker machine; the free demo setup documents how to install it.

**Status (2026-09-30):** tasks 5.1 to 5.4 are done on branch `phase-5/content` (ffmpeg 9.0.1
installed with winget for local runs; CI installs it with apt). Not done: the concurrent-stream
limit and segment encryption for video, image re-encoding and the separate file origin
(paid-services.md), and purging content deleted more than 30 days ago (a maintenance job).

Each task ships with tests (integration against Postgres, cross-tenant suite, browser flow where
there's UI), audit events, translations in Arabic and English, and doc updates.

**Risks:** the access rules must be exact (a table-driven test over every term: block beats group
and grant, pause beats everything, unpublished refuses even with a grant); bulk changes must be
atomic and idempotent; files and video must never be reachable without the policy.
