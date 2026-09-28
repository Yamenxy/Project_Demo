using System.Security.Cryptography;
using System.Text;

namespace EducationPlatform.Api.Services;

public static class PasswordService
{
    public static string Hash(string password)
    {
        using var sha = SHA256.Create();
        var bytes = sha.ComputeHash(Encoding.UTF8.GetBytes(password));
        return Convert.ToHexString(bytes);
    }

    public static bool Verify(string password, string passwordHash)
    {
        return Hash(password).Equals(passwordHash, StringComparison.OrdinalIgnoreCase);
    }
}
