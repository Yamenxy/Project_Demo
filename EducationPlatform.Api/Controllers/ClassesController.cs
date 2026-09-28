using EducationPlatform.Api.Data;
using EducationPlatform.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EducationPlatform.Api.Controllers;

[ApiController]
[Route("api/v1/[controller]")]
[Authorize(Roles = "SuperAdmin,Teacher")]
public class ClassesController : ControllerBase
{
    private readonly AppDbContext _dbContext;

    public ClassesController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var classes = await _dbContext.Classes
            .Include(c => c.Teacher)
            .ThenInclude(t => t!.User)
            .Select(c => new
            {
                c.Id,
                c.Name,
                c.Subject,
                c.Grade,
                c.Status,
                TeacherName = c.Teacher!.User!.Name,
                c.Capacity,
                c.StartDate,
                c.EndDate
            })
            .ToListAsync();

        return Ok(classes);
    }

    [HttpPost]
    public async Task<IActionResult> Create([FromBody] ClassRoom request)
    {
        if (string.IsNullOrWhiteSpace(request.Name))
        {
            return BadRequest(new { message = "Class name is required." });
        }

        _dbContext.Classes.Add(request);
        await _dbContext.SaveChangesAsync();

        return Ok(new { message = "Class created", request.Id });
    }
}
