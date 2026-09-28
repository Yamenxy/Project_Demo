namespace EducationPlatform.Api.Models;

public enum UserRole
{
    SuperAdmin,
    Teacher,
    Student,
    Parent
}

public class User
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Email { get; set; } = string.Empty;
    public string PasswordHash { get; set; } = string.Empty;
    public UserRole Role { get; set; }
    public bool IsActive { get; set; } = true;
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime? UpdatedAt { get; set; }
    public string? Phone { get; set; }
    public string? ParentPhone { get; set; }
    public string? StudentCode { get; set; }
    public string? Status { get; set; } = "Active";
}

public class StudentProfile
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public string StudentCode { get; set; } = string.Empty;
    public string Status { get; set; } = "Active";
    public string? ParentPhone { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public User? User { get; set; }
}

public class TeacherProfile
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public string Status { get; set; } = "Active";
    public string? Subject { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public User? User { get; set; }
}

public class ClassRoom
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Subject { get; set; } = string.Empty;
    public string Grade { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public int? TeacherId { get; set; }
    public int Capacity { get; set; }
    public string Status { get; set; } = "Active";
    public DateTime StartDate { get; set; }
    public DateTime EndDate { get; set; }
    public TeacherProfile? Teacher { get; set; }
    public ICollection<Enrollment> Enrollments { get; set; } = new List<Enrollment>();
}

public class Enrollment
{
    public int Id { get; set; }
    public int StudentId { get; set; }
    public int ClassId { get; set; }
    public string Status { get; set; } = "Active";
    public DateTime EnrolledAt { get; set; } = DateTime.UtcNow;
    public StudentProfile? Student { get; set; }
    public ClassRoom? Class { get; set; }
}

public class Course
{
    public int Id { get; set; }
    public string Name { get; set; } = string.Empty;
    public string Subject { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public int TeacherId { get; set; }
    public string Status { get; set; } = "Active";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public TeacherProfile? Teacher { get; set; }
    public ICollection<Lesson> Lessons { get; set; } = new List<Lesson>();
}

public class Lesson
{
    public int Id { get; set; }
    public int CourseId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public int Order { get; set; }
    public string AccessType { get; set; } = "Free";
    public bool IsPublished { get; set; }
    public bool IsDownloadable { get; set; }
    public string Status { get; set; } = "Draft";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public Course? Course { get; set; }
}

public class Homework
{
    public int Id { get; set; }
    public int ClassId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Description { get; set; } = string.Empty;
    public string Status { get; set; } = "Draft";
    public DateTime ReleaseDate { get; set; } = DateTime.UtcNow;
    public DateTime Deadline { get; set; }
    public int MaxScore { get; set; } = 100;
    public string LatePolicy { get; set; } = "Allowed";
    public string ResubmissionPolicy { get; set; } = "Allowed";
    public ClassRoom? Class { get; set; }
    public ICollection<HomeworkSubmission> Submissions { get; set; } = new List<HomeworkSubmission>();
}

public class HomeworkSubmission
{
    public int Id { get; set; }
    public int HomeworkId { get; set; }
    public int StudentId { get; set; }
    public string Status { get; set; } = "Submitted";
    public bool IsLate { get; set; }
    public string? Feedback { get; set; }
    public int Score { get; set; }
    public DateTime SubmittedAt { get; set; } = DateTime.UtcNow;
    public Homework? Homework { get; set; }
    public StudentProfile? Student { get; set; }
}

public class Exam
{
    public int Id { get; set; }
    public int ClassId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Status { get; set; } = "Draft";
    public int TimeLimitMinutes { get; set; }
    public int MaxScore { get; set; } = 100;
    public int PassingScore { get; set; } = 60;
    public bool AutoSubmit { get; set; } = true;
    public string QuestionType { get; set; } = "MCQ";
    public DateTime StartTime { get; set; }
    public DateTime EndTime { get; set; }
    public ClassRoom? Class { get; set; }
    public ICollection<ExamAttempt> Attempts { get; set; } = new List<ExamAttempt>();
}

public class ExamAttempt
{
    public int Id { get; set; }
    public int ExamId { get; set; }
    public int StudentId { get; set; }
    public string State { get; set; } = "Active";
    public DateTime StartedAt { get; set; } = DateTime.UtcNow;
    public DateTime? SubmittedAt { get; set; }
    public int Score { get; set; }
    public Exam? Exam { get; set; }
    public StudentProfile? Student { get; set; }
}

public class AttendanceRecord
{
    public int Id { get; set; }
    public int StudentId { get; set; }
    public int ClassId { get; set; }
    public DateTime Date { get; set; }
    public string Status { get; set; } = "Present";
    public string? Notes { get; set; }
    public StudentProfile? Student { get; set; }
    public ClassRoom? Class { get; set; }
}

public class GradeRecord
{
    public int Id { get; set; }
    public int StudentId { get; set; }
    public int ClassId { get; set; }
    public string Category { get; set; } = "Homework";
    public decimal Score { get; set; }
    public decimal Weight { get; set; }
    public bool Finalized { get; set; }
    public string? Comment { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public StudentProfile? Student { get; set; }
    public ClassRoom? Class { get; set; }
}

public class PaymentRequest
{
    public int Id { get; set; }
    public int StudentId { get; set; }
    public decimal Amount { get; set; }
    public string PaymentMethod { get; set; } = "BankTransfer";
    public string Status { get; set; } = "Pending";
    public string? ReferenceNumber { get; set; }
    public string? Notes { get; set; }
    public int? ApprovedByUserId { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public StudentProfile? Student { get; set; }
    public User? ApprovedBy { get; set; }
}

public class Subscription
{
    public int Id { get; set; }
    public int StudentId { get; set; }
    public string PlanName { get; set; } = "Standard";
    public string Status { get; set; } = "Active";
    public DateTime StartDate { get; set; } = DateTime.UtcNow;
    public DateTime EndDate { get; set; }
    public string PaymentStatus { get; set; } = "Paid";
    public StudentProfile? Student { get; set; }
}

public class NotificationItem
{
    public int Id { get; set; }
    public int UserId { get; set; }
    public string Title { get; set; } = string.Empty;
    public string Message { get; set; } = string.Empty;
    public bool IsRead { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public User? User { get; set; }
}

public class AuditLog
{
    public int Id { get; set; }
    public int? UserId { get; set; }
    public string EntityName { get; set; } = string.Empty;
    public string Action { get; set; } = string.Empty;
    public string? OldValue { get; set; }
    public string? NewValue { get; set; }
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public User? User { get; set; }
}
