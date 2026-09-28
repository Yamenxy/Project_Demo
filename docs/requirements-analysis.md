# Requirements Analysis and Roadmap

## 1. Requirement Classification

### Functional requirements

- Authentication and account management: registration, login, logout, password reset, remember me, session expiry, optional 2FA, email verification settings.
- User management: admin, teacher, student, and optional parent accounts.
- Student lifecycle: create, edit, activate, suspend, archive, restore, reset password, status tracking, academic and payment history retention.
- Teacher lifecycle: create, edit, assign to classes, assign subjects, workload and reporting.
- Class management: roster, capacity, enrollment approvals, transfers, waitlist, status transitions.
- Scheduling: recurring schedules, calendar, conflict detection, cancellation and rescheduling notifications.
- Course and lesson management: course metadata, content ordering, draft/publish lifecycle, content access rules by access type.
- Video and file management: upload, streaming, public/private access, resume support, thumbnails, duration, secure storage, versioning.
- Homework management: create, publish, grade, feedback, resubmission, history.
- Quiz and exam management: question banks, random questions, scheduling, attempts, automatic/manual grading, answer visibility, time enforcement.
- Attendance management: manual mark, QR/barcode scan, history, notes, reports.
- Grade management: weighted grade composition, calculations, overrides, approvals, finalization.
- Performance analytics: trends, at-risk indicators, missing homework, low performance.
- Payments and subscriptions: manual payments, review workflow, proof validation, subscription lifecycle and expiry notices.
- Messaging and notifications: website notifications, push/email, read state, preferences, related-content links.
- Reporting and exports: teacher/admin reports in PDF/Excel/CSV.
- Import/export: CSV/Excel student import and report export.
- Audit logging and backups: sensitive change tracking and recovery procedures.

### Non-functional requirements

- Responsive desktop, tablet, and mobile access.
- Multi-browser compatibility.
- High availability and scalability expectations.
- API performance budgets and pagination.
- Background job processing for large file and video workflows.
- Data retention and archival strategy.
- Multi-environment separation for development, staging, and production.
- Export/report generation and monitoring.
- Support for bilingual Arabic and English UI and localization rules.
- Accessibility support using WCAG-aligned design.

### Security requirements

- Secure password hashing and session management.
- HTTPS-ready deployment and secure headers.
- Rate limiting and brute-force protection.
- RBAC and server-side authorization.
- Object-level authorization to prevent IDOR.
- Input validation, SQL injection prevention, XSS/CSRF protection.
- File validation and secure private storage.
- Malware scanning and executable upload blocking.
- Audit logging for sensitive decisions.

### Business rules

- Academic/payment history must persist after account deactivation or suspension.
- Manual payment decisions require approvals and audit trails.
- Content access must be enforced on the backend, not only in the UI.
- Allowed lifecycle transitions must be stateful.
- Students, teachers, and parents may have role-specific data visibility rules.
- Parent access is future-ready and should not allow record modification.
- Exam integrity is honor-system unless proctoring is added.

### User roles and permissions

1. Super Admin
   - Full platform control, platform settings, audit access, payment approvals, subscriptions, categories, reports.
2. Teacher
   - Course/class/homework/exam/attendance/grade authority within assigned cohorts.
3. Student
   - Course access, submissions, attendance and grade viewing, communication, self-service subscription/payment tasks.
4. Parent
   - Read-only monitoring of linked students; no academic modification authority.

### Data requirements

- Relational data model with foreign keys, constraints, soft-delete/archive mechanisms, timestamps, and indexes.
- Core entities: users, roles, permissions, students, parents, teachers, centers, classrooms, classes, enrollments, courses, lessons, videos, files, homework, questions, submissions, exams, exam attempts, attendance, grades, grade components, subscriptions, payments, notifications, messages, announcements, reports, audit logs, academic calendars.
- Sensitive data storage must be privacy-conscious, with strict access scopes and retention policy.

### API requirements

- RESTful resource-based APIs with consistent status codes.
- Authentication, authorization, validation, rate limiting, and OpenAPI documentation.
- Error envelopes with standard structure and no internal stack traces.
- Versioning and pagination for large collections.

### UI/UX requirements

- Role-based dashboards and workflows.
- Clear navigation, cards, tables, forms, modals, toasts, empty and loading states.
- Arabic/English support with RTL/LTR behavior.
- Mobile-first student experience for video, homework, exams, grades, notifications.
- Accessibility and high-contrast design.

### Architecture requirements

- Layered architecture: frontend → API/controllers → service layer → repository/data layer → database.
- DI, modular services, and separation of concerns.
- Event-driven notifications and background jobs.
- Extensible security and file handling.

## 2. Dependency Mapping

- Student registration and authentication are prerequisites for nearly all user journeys.
- Class enrollments depend on student creation, teacher assignment, and course/class configuration.
- Homework and exam systems depend on class membership and scheduling.
- Attendance and grades depend on schedule and class enrollment.
- Subscription and payment rules affect content access, class enrollment, and premium features.
- Audit logging is cross-cutting and required for payments, grades, attendance, account changes, and content modifications.
- File storage and video processing must be in place before lesson and homework upload features are used.
- Notification and messaging depend on user, class, and content events.
- Reporting depends on attendance, grades, payments, subscriptions, and usage data.

## 3. Configurable vs Hard-Coded Decisions

The original requirements intentionally leave several business rules unspecified. These must be configuration-driven rather than fixed in code:

- Student can belong to multiple classes? configurable.
- Teacher can teach multiple classes? configurable.
- Student transfer rules and approval workflow? configurable.
- Subscription expiry behavior and access retention? configurable.
- Grade/final-grade modification policy? configurable.
- Attendance edit rules? configurable.
- Payment approval roles and resubmission policy? configurable.
- Exam retakes, negative marking, and integrity policy? configurable.
- Parent requirement for minors? configurable.
- Multi-center support? configurable.
- Arabic vs English requirement and locale behavior? configurable.
- Payment methods and subscription plans? configurable.
- Waitlist and class capacity threshold behavior? configurable.

## 4. Ambiguities and Potential Conflicts

- Proctoring vs honor-system exams: the requirement allows honor system but the product must clearly communicate this limitation.
- Subscription access and academic record retention: requirements say records must be preserved after deactivation, but access rules may vary by policy.
- Parent access and data privacy: must be read-only but likely require legal consent and access scope rules.
- Manual payment methods: the requirements say “manual payment” but do not define the supported list for first release.
- Multi-class behavior can create scheduling conflicts, which must be handled by validation logic.
- File security vs ease of use: private storage and authorization checks are necessary but must not block legitimate teacher/student workflows.
- Backup and retention policy conflicts with privacy deletion requirements: deletion/anonymization must not violate legal retention obligations.

## 5. Assumptions to Implement Safely

Where the requirement is intentionally undefined, the project should adopt extensible defaults and document them explicitly:

- Multi-class participation is allowed by default, with configuration toggles for enrollment rules.
- Teachers can teach multiple classes, but schedule conflict validation is mandatory.
- Subscription expiry disables premium access but preserves historical academic records.
- Grade finalization cannot be changed without explicit authorization and is logged as an audit event.
- Parent accounts are optional and read-only for linked student records.
- Exams are honor-system unless proctoring is added later.
- Payment approvals require admin privileges and can be re-submitted based on policy configuration.
- Account deletion is soft-delete/anonymize by default; full data deletion is a scheduled compliance action.

## 6. Critical Design Constraints

- No requirement is optional in terms of security. Authentication, authorization, file rules, and auditing are mandatory.
- The architecture must support event-driven notifications and background processing without becoming unnecessarily heavy.
- The product must avoid fake or superficial “admin” functionality; security and stateful business logic matter more than dashboard polish.
- The system must preserve historical records even when a user is suspended, deactivated, or archived.

## 7. Implementation Roadmap

### Phase 1 — Architecture & design approval

- Confirm technology stack.
- Finalize configurable business-rule defaults.
- Produce ERD and module map.
- Produce RBAC and API contract outline.

### Phase 2 — Database and foundation

- Users, roles, permissions, organizations/centers, classes, enrollments.
- Migrations, indexes, constraints, soft-delete patterns.
- Seed data and configuration tables.

### Phase 3 — Backend core modules

- Authentication, identity, sessions, password reset.
- Student/teacher/class/course/lesson management.
- Homework, exams, attendance, grades.
- Payment and subscription logic.
- Notifications, messaging, audit logging.
- File upload and storage enforcement.

### Phase 4 — Frontend dashboards and workflows

- Login, registration, role dashboards.
- Student and teacher operational workflows.
- Admin reporting and monitoring.
- Parent read-only portal.

### Phase 5 — Security hardening

- Policy review for secure auth, file upload, IDOR, RBAC, rate limiting, and observability.
- Security tests and production hardening.

### Phase 6 — Testing and rollout

- Unit, integration, API, authentication, security, and performance tests.
- Staging validation and release readiness review.

### Phase 7 — Deployment and operations

- Environment configuration, deployment automation, database migration runbooks, backup and restore, monitoring, rollback plan.

## 8. Summary

The requirements describe a full education platform with strong operational concerns, not a single-tenant demo. The system must balance role-based access, academic data integrity, file security, payment governance, and reporting. The architecture should be enterprise-ready, modular, and configurable without over-engineering early implementation.
