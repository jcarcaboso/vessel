using System.Xml.Linq;

namespace Vessel.Tests;

public sealed class ArchitectureTests
{
    [Theory]
    [InlineData("Domain", "")]
    [InlineData("Application", "Domain")]
    [InlineData("Persistence", "Application,Domain")]
    [InlineData("Infrastructure", "Application")]
    [InlineData("Api", "Application,Infrastructure,Persistence")]
    public void Project_dependencies_point_inward(string project, string expected)
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, "Vessel.slnx")))
            directory = directory.Parent;
        Assert.NotNull(directory);
        var xml = XDocument.Load(Path.Combine(directory.FullName, "src", $"Vessel.{project}", $"Vessel.{project}.csproj"));
        var references = xml.Descendants("ProjectReference")
            .Select(x => Path.GetFileNameWithoutExtension(x.Attribute("Include")!.Value).Replace("Vessel.", ""))
            .Order().ToArray();
        Assert.Equal(expected.Split(',', StringSplitOptions.RemoveEmptyEntries).Order(), references);
        if (project is "Domain" or "Application")
        {
            Assert.Empty(xml.Descendants("PackageReference"));
            Assert.Empty(xml.Descendants("FrameworkReference"));
        }
    }
}
