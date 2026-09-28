using EducationPlatform.Api.Data;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EducationPlatform.Api.Controllers;

[ApiController]
[Route("api/v1/[controller]")]
[Authorize(Roles = "SuperAdmin,Teacher")]
public class StudentsController : ControllerBase
{
    private readonly AppDbContext _dbContext;

    public StudentsController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var students = await _dbContext.Students
            .Include(s => s.User)
            .Select(s => new
            {
                s.Id,
                s.StudentCode,
                s.Status,
                UserName = s.User!.Name,
                Email = s.User.Email,
                Phone = s.User.Phone,
                ParentPhone = s.User.ParentPhone
            })
            .ToListAsync();

        return Ok(students);
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetById(int id)
    {
        var student = await _dbContext.Students
            .Include(s => s.User)
            .FirstOrDefaultAsync(s => s.Id == id);

        if (student is null) return NotFound();

        return Ok(new
        {
            student.Id,
            student.StudentCode,
            student.Status,
            student.ParentPhone,
            Name = student.User!.Name,
            Email = student.User.Email,
            Phone = student.User.Phone
        });
    }
}
