import { Injectable } from '@nestjs/common';
import { and, eq, inArray, isNotNull, ne } from 'drizzle-orm';
import { AppError, Clock, IdGenerator } from '../../common';
import { isUniqueViolation, TenantDb } from '../../database';
import { AuditService } from '../audit';
import { users } from '../identity';
import { readSpreadsheet, SpreadsheetError } from './import/spreadsheet';
import { toStudentRows, type ParsedRow } from './import/student-rows';
import { memberships, workspaceSettings } from './schema';
import type { Actor } from './students.service';

export const MAX_IMPORT_BYTES = 512 * 1024;
export const MAX_IMPORT_ROWS = 1000;

export type ImportRowStatus =
  | 'ok'
  | 'missing_name'
  | 'missing_phone'
  | 'invalid_phone'
  | 'duplicate_in_file'
  | 'already_member'
  | 'code_taken';

export interface ImportRow {
  row: number;
  name: string;
  phone: string;
  internalCode: string | null;
  status: ImportRowStatus;
}

export interface ImportReport {
  committed: boolean;
  /** Rows added (or, in a preview, that would be added). */
  added: number;
  rows: ImportRow[];
}

/**
 * Bulk import of students from CSV or XLSX (REQ-USER-002). Every accepted row becomes a managed
 * student record, whether or not the phone already has an account, so the report reads the same
 * either way (SEC-02). The student takes the record over by joining with the workspace code or a
 * claim link, signed in with that phone (REQ-USER-003).
 */
@Injectable()
export class StudentImportService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async import(
    workspaceId: string,
    file: { fileName: string; data: Buffer },
    options: { commit: boolean },
    actor: Actor,
  ): Promise<ImportReport> {
    if (file.data.length === 0 || file.data.length > MAX_IMPORT_BYTES) {
      throw new AppError(400, 'import_too_large', 'The file is empty or larger than 512 KB');
    }
    let parsed: ParsedRow[];
    try {
      parsed = toStudentRows(readSpreadsheet(file.fileName, file.data));
    } catch (err) {
      if (err instanceof SpreadsheetError) {
        throw new AppError(400, 'import_unreadable', 'The file could not be read');
      }
      throw err;
    }
    if (parsed.length === 0) throw new AppError(400, 'import_empty', 'No students in the file');
    if (parsed.length > MAX_IMPORT_ROWS) {
      throw new AppError(400, 'import_too_large', 'At most 1000 students per file');
    }

    try {
      return await this.db.inWorkspace(workspaceId, async (tx) => {
        // One import (or claim) at a time per workspace, so duplicate checks stay true.
        await tx
          .select({ id: workspaceSettings.workspaceId })
          .from(workspaceSettings)
          .for('update');

        const phones = [...new Set(parsed.filter((r) => !r.problem).map((r) => r.phone))];
        const codes = [
          ...new Set(parsed.map((r) => r.internalCode).filter((c): c is string => Boolean(c))),
        ];
        const taken = new Set<string>();
        if (phones.length > 0) {
          const managed = await tx
            .select({ phone: memberships.provisionalPhone })
            .from(memberships)
            .where(
              and(inArray(memberships.provisionalPhone, phones), ne(memberships.status, 'removed')),
            );
          const members = await tx
            .select({ phone: users.phoneE164 })
            .from(memberships)
            .innerJoin(users, eq(users.id, memberships.userId))
            .where(and(inArray(users.phoneE164, phones), ne(memberships.status, 'removed')));
          for (const { phone } of [...managed, ...members]) if (phone) taken.add(phone);
        }
        const usedCodes = new Set<string>();
        if (codes.length > 0) {
          const rows = await tx
            .select({ code: memberships.internalCode })
            .from(memberships)
            .where(
              and(isNotNull(memberships.internalCode), inArray(memberships.internalCode, codes)),
            );
          for (const { code } of rows) if (code) usedCodes.add(code);
        }

        const seenPhones = new Set<string>();
        const seenCodes = new Set<string>();
        const report: ImportRow[] = parsed.map((row) => {
          let status: ImportRowStatus = row.problem ?? 'ok';
          if (status === 'ok') {
            if (taken.has(row.phone)) status = 'already_member';
            else if (seenPhones.has(row.phone)) status = 'duplicate_in_file';
            else if (
              row.internalCode &&
              (usedCodes.has(row.internalCode) || seenCodes.has(row.internalCode))
            ) {
              status = 'code_taken';
            }
          }
          if (status === 'ok') {
            seenPhones.add(row.phone);
            if (row.internalCode) seenCodes.add(row.internalCode);
          }
          return {
            row: row.row,
            name: row.name,
            phone: row.phone,
            internalCode: row.internalCode,
            status,
          };
        });
        const accepted = report.filter((r) => r.status === 'ok');
        if (!options.commit || accepted.length === 0) {
          return { committed: false, added: accepted.length, rows: report };
        }

        const now = this.clock.now();
        const values = accepted.map((row) => ({
          workspaceId,
          id: this.ids.newId(),
          userId: null,
          role: 'student' as const,
          status: 'active' as const,
          provisionalName: row.name,
          provisionalPhone: row.phone,
          internalCode: row.internalCode,
          createdAt: now,
          updatedAt: now,
          version: 1,
        }));
        for (let i = 0; i < values.length; i += 200) {
          await tx.insert(memberships).values(values.slice(i, i + 200));
        }
        const importId = this.ids.newId();
        for (const value of values) {
          await this.audit.record(tx, {
            action: 'student.managed_created',
            workspaceId,
            actor: { type: 'user', userId: actor.userId },
            entity: { type: 'membership', id: value.id },
            newValue: { source: 'import', importId },
            requestId: actor.requestId,
          });
        }
        await this.audit.record(tx, {
          action: 'students.imported',
          workspaceId,
          actor: { type: 'user', userId: actor.userId },
          entity: { type: 'import', id: importId },
          newValue: {
            fileName: file.fileName.slice(0, 200),
            added: values.length,
            skipped: report.length - values.length,
          },
          requestId: actor.requestId,
        });
        return { committed: true, added: values.length, rows: report };
      });
    } catch (err) {
      if (isUniqueViolation(err, 'memberships_internal_code_uq')) {
        throw new AppError(409, 'import_conflict', 'Students changed meanwhile; try again');
      }
      throw err;
    }
  }
}
