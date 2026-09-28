using EducationPlatform.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EducationPlatform.Api.Controllers;

[ApiController]
[Route("api/v1/[controller]")]
[Authorize(Roles = "SuperAdmin,Teacher")]
public class DashboardController : ControllerBase
{
    private readonly AppDbContext _dbContext;

    public DashboardController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    [HttpGet("summary")]
    public async Task<IActionResult> GetSummary()
    {
        var totalStudents = await _dbContext.Students.CountAsync();
        var totalTeachers = await _dbContext.Teachers.CountAsync();
        var totalClasses = await _dbContext.Classes.CountAsync();
        var pendingPayments = await _dbContext.Payments.CountAsync(p => p.Status == "Pending");
        var activeStudents = await _dbContext.Students.CountAsync(s => s.Status == "Active");

        return Ok(new
        {
            totalStudents,
            activeStudents,
            totalTeachers,
            totalClasses,
            pendingPayments,
            todaysClasses = 0,
            attendancePercentage = 92,
            monthlyRevenue = 12500,
            upcomingExams = 3,
            pendingHomework = 8
        });
    }
}
