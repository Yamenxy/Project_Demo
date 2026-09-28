using EducationPlatform.Api.Data;
using EducationPlatform.Api.Models;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;

namespace EducationPlatform.Api.Controllers;

[ApiController]
[Route("api/v1/[controller]")]
[Authorize(Roles = "SuperAdmin")]
public class UsersController : ControllerBase
{
    private readonly AppDbContext _dbContext;

    public UsersController(AppDbContext dbContext)
    {
        _dbContext = dbContext;
    }

    [HttpGet]
    public async Task<IActionResult> GetAll()
    {
        var users = await _dbContext.Users
            .OrderBy(u => u.Name)
            .Select(u => new { u.Id, u.Name, u.Email, Role = u.Role.ToString(), u.Status, u.IsActive })
            .ToListAsync();

        return Ok(users);
    }

    [HttpGet("{id:int}")]
    public async Task<IActionResult> GetById(int id)
    {
        var user = await _dbContext.Users.FirstOrDefaultAsync(u => u.Id == id);
        if (user is null) return NotFound();

        return Ok(new { user.Id, user.Name, user.Email, Role = user.Role.ToString(), user.Status, user.IsActive });
    }
}
