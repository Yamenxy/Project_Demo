using EducationPlatform.Api.Models;
using EducationPlatform.Api.Services;
using Microsoft.EntityFrameworkCore;

namespace EducationPlatform.Api.Data;

public class AppDbContext : DbContext
{
    public AppDbContext(DbContextOptions<AppDbContext> options) : base(options)
    {
    }

    public DbSet<User> Users => Set<User>();
    public DbSet<StudentProfile> Students => Set<StudentProfile>();
    public DbSet<TeacherProfile> Teachers => Set<TeacherProfile>();
    public DbSet<ClassRoom> Classes => Set<ClassRoom>();
    public DbSet<Enrollment> Enrollments => Set<Enrollment>();
    public DbSet<Course> Courses => Set<Course>();
    public DbSet<Lesson> Lessons => Set<Lesson>();
    public DbSet<Homework> Homeworks => Set<Homework>();
    public DbSet<HomeworkSubmission> HomeworkSubmissions => Set<HomeworkSubmission>();
    public DbSet<Exam> Exams => Set<Exam>();
    public DbSet<ExamAttempt> ExamAttempts => Set<ExamAttempt>();
    public DbSet<AttendanceRecord> AttendanceRecords => Set<AttendanceRecord>();
    public DbSet<GradeRecord> GradeRecords => Set<GradeRecord>();
    public DbSet<PaymentRequest> Payments => Set<PaymentRequest>();
    public DbSet<Subscription> Subscriptions => Set<Subscription>();
    public DbSet<NotificationItem> Notifications => Set<NotificationItem>();
    public DbSet<AuditLog> AuditLogs => Set<AuditLog>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        base.OnModelCreating(modelBuilder);

        modelBuilder.Entity<User>(entity =>
        {
            entity.HasIndex(u => u.Email).IsUnique();
            entity.Property(u => u.Email).HasMaxLength(200);
            entity.Property(u => u.Name).HasMaxLength(200);
        });

        modelBuilder.Entity<StudentProfile>(entity =>
        {
            entity.HasIndex(s => s.StudentCode).IsUnique();
            entity.HasOne(s => s.User)
                .WithMany()
                .HasForeignKey(s => s.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<TeacherProfile>(entity =>
        {
            entity.HasOne(t => t.User)
                .WithMany()
                .HasForeignKey(t => t.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<ClassRoom>(entity =>
        {
            entity.HasOne(c => c.Teacher)
                .WithMany()
                .HasForeignKey(c => c.TeacherId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<Enrollment>(entity =>
        {
            entity.HasOne(e => e.Student)
                .WithMany()
                .HasForeignKey(e => e.StudentId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(e => e.Class)
                .WithMany(c => c.Enrollments)
                .HasForeignKey(e => e.ClassId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Course>(entity =>
        {
            entity.HasOne(c => c.Teacher)
                .WithMany()
                .HasForeignKey(c => c.TeacherId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Lesson>(entity =>
        {
            entity.HasOne(l => l.Course)
                .WithMany(c => c.Lessons)
                .HasForeignKey(l => l.CourseId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Homework>(entity =>
        {
            entity.HasOne(h => h.Class)
                .WithMany()
                .HasForeignKey(h => h.ClassId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<HomeworkSubmission>(entity =>
        {
            entity.HasOne(h => h.Homework)
                .WithMany(h => h.Submissions)
                .HasForeignKey(h => h.HomeworkId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(h => h.Student)
                .WithMany()
                .HasForeignKey(h => h.StudentId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<Exam>(entity =>
        {
            entity.HasOne(e => e.Class)
                .WithMany()
                .HasForeignKey(e => e.ClassId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<ExamAttempt>(entity =>
        {
            entity.HasOne(e => e.Exam)
                .WithMany(e => e.Attempts)
                .HasForeignKey(e => e.ExamId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(e => e.Student)
                .WithMany()
                .HasForeignKey(e => e.StudentId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<AttendanceRecord>(entity =>
        {
            entity.HasOne(a => a.Student)
                .WithMany()
                .HasForeignKey(a => a.StudentId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(a => a.Class)
                .WithMany()
                .HasForeignKey(a => a.ClassId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<GradeRecord>(entity =>
        {
            entity.HasOne(g => g.Student)
                .WithMany()
                .HasForeignKey(g => g.StudentId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(g => g.Class)
                .WithMany()
                .HasForeignKey(g => g.ClassId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<PaymentRequest>(entity =>
        {
            entity.HasOne(p => p.Student)
                .WithMany()
                .HasForeignKey(p => p.StudentId)
                .OnDelete(DeleteBehavior.Cascade);

            entity.HasOne(p => p.ApprovedBy)
                .WithMany()
                .HasForeignKey(p => p.ApprovedByUserId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        modelBuilder.Entity<Subscription>(entity =>
        {
            entity.HasOne(s => s.Student)
                .WithMany()
                .HasForeignKey(s => s.StudentId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<NotificationItem>(entity =>
        {
            entity.HasOne(n => n.User)
                .WithMany()
                .HasForeignKey(n => n.UserId)
                .OnDelete(DeleteBehavior.Cascade);
        });

        modelBuilder.Entity<AuditLog>(entity =>
        {
            entity.HasOne(a => a.User)
                .WithMany()
                .HasForeignKey(a => a.UserId)
                .OnDelete(DeleteBehavior.SetNull);
        });

        SeedData(modelBuilder);
    }

    private static void SeedData(ModelBuilder modelBuilder)
    {
        var adminUserId = 1;
        var teacherUserId = 2;
        var studentUserId = 3;

        modelBuilder.Entity<User>().HasData(
            new User
            {
                Id = adminUserId,
                Name = "Super Admin",
                Email = "admin@edu.com",
                PasswordHash = PasswordService.Hash("admin123"),
                Role = UserRole.SuperAdmin,
                IsActive = true,
                Status = "Active",
                CreatedAt = DateTime.UtcNow,
                Phone = "+966500000001"
            },
            new User
            {
                Id = teacherUserId,
                Name = "Teacher One",
                Email = "teacher@edu.com",
                PasswordHash = PasswordService.Hash("teacher123"),
                Role = UserRole.Teacher,
                IsActive = true,
                Status = "Active",
                CreatedAt = DateTime.UtcNow,
                Phone = "+966500000002"
            },
            new User
            {
                Id = studentUserId,
                Name = "Student One",
                Email = "student@edu.com",
                PasswordHash = PasswordService.Hash("student123"),
                Role = UserRole.Student,
                IsActive = true,
                Status = "Active",
                CreatedAt = DateTime.UtcNow,
                Phone = "+966500000003",
                ParentPhone = "+966500000004",
                StudentCode = "ST-1001"
            }
        );

        modelBuilder.Entity<TeacherProfile>().HasData(
            new TeacherProfile
            {
                Id = 1,
                UserId = teacherUserId,
                Status = "Active",
                Subject = "Mathematics",
                CreatedAt = DateTime.UtcNow
            }
        );

        modelBuilder.Entity<StudentProfile>().HasData(
            new StudentProfile
            {
                Id = 1,
                UserId = studentUserId,
                StudentCode = "ST-1001",
                Status = "Active",
                ParentPhone = "+966500000004",
                CreatedAt = DateTime.UtcNow
            }
        );

        modelBuilder.Entity<ClassRoom>().HasData(
            new ClassRoom
            {
                Id = 1,
                Name = "Algebra Basics",
                Subject = "Mathematics",
                Grade = "Grade 8",
                Description = "Core algebra for middle school learners.",
                TeacherId = 1,
                Capacity = 30,
                Status = "Active",
                StartDate = DateTime.UtcNow.AddDays(-7),
                EndDate = DateTime.UtcNow.AddDays(90)
            }
        );

        modelBuilder.Entity<Enrollment>().HasData(
            new Enrollment
            {
                Id = 1,
                StudentId = 1,
                ClassId = 1,
                Status = "Active",
                EnrolledAt = DateTime.UtcNow.AddDays(-5)
            }
        );

        modelBuilder.Entity<Course>().HasData(
            new Course
            {
                Id = 1,
                Name = "Mathematics Foundations",
                Subject = "Mathematics",
                Description = "A foundational course for algebra and problem solving.",
                TeacherId = 1,
                Status = "Active",
                CreatedAt = DateTime.UtcNow
            }
        );

        modelBuilder.Entity<Lesson>().HasData(
            new Lesson
            {
                Id = 1,
                CourseId = 1,
                Title = "Introduction to Algebra",
                Description = "Learn variables and simple equations.",
                Order = 1,
                AccessType = "Free",
                IsPublished = true,
                IsDownloadable = false,
                Status = "Published",
                CreatedAt = DateTime.UtcNow
            }
        );

        modelBuilder.Entity<Homework>().HasData(
            new Homework
            {
                Id = 1,
                ClassId = 1,
                Title = "Algebra Practice",
                Description = "Solve basic equations and word problems.",
                Status = "Published",
                ReleaseDate = DateTime.UtcNow.AddDays(-2),
                Deadline = DateTime.UtcNow.AddDays(4),
                MaxScore = 100,
                LatePolicy = "Allowed",
                ResubmissionPolicy = "Allowed"
            }
        );

        modelBuilder.Entity<Exam>().HasData(
            new Exam
            {
                Id = 1,
                ClassId = 1,
                Title = "Midterm Review",
                Status = "Scheduled",
                TimeLimitMinutes = 45,
                MaxScore = 100,
                PassingScore = 60,
                AutoSubmit = true,
                QuestionType = "MCQ",
                StartTime = DateTime.UtcNow.AddDays(3),
                EndTime = DateTime.UtcNow.AddDays(3).AddHours(1)
            }
        );

        modelBuilder.Entity<AttendanceRecord>().HasData(
            new AttendanceRecord
            {
                Id = 1,
                StudentId = 1,
                ClassId = 1,
                Date = DateTime.UtcNow.AddDays(-1),
                Status = "Present",
                Notes = "On time"
            }
        );

        modelBuilder.Entity<GradeRecord>().HasData(
            new GradeRecord
            {
                Id = 1,
                StudentId = 1,
                ClassId = 1,
                Category = "Homework",
                Score = 92,
                Weight = 20,
                Finalized = true,
                Comment = "Strong performance",
                CreatedAt = DateTime.UtcNow
            }
        );

        modelBuilder.Entity<PaymentRequest>().HasData(
            new PaymentRequest
            {
                Id = 1,
                StudentId = 1,
                Amount = 250.00m,
                PaymentMethod = "BankTransfer",
                Status = "Approved",
                ReferenceNumber = "REF-1001",
                Notes = "Paid for January plan",
                ApprovedByUserId = adminUserId,
                CreatedAt = DateTime.UtcNow.AddDays(-1)
            }
        );

        modelBuilder.Entity<Subscription>().HasData(
            new Subscription
            {
                Id = 1,
                StudentId = 1,
                PlanName = "Basic",
                Status = "Active",
                StartDate = DateTime.UtcNow.AddDays(-20),
                EndDate = DateTime.UtcNow.AddDays(30),
                PaymentStatus = "Paid"
            }
        );

        modelBuilder.Entity<NotificationItem>().HasData(
            new NotificationItem
            {
                Id = 1,
                UserId = studentUserId,
                Title = "New lesson available",
                Message = "Introduction to Algebra is now published.",
                IsRead = false,
                CreatedAt = DateTime.UtcNow.AddHours(-2)
            }
        );
    }
}
