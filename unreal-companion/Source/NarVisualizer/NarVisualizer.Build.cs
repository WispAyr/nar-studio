// Build rules for the NAR Studio companion module.
//
// Lists every public module we depend on. `OSC` is the standout — that's the
// engine-shipped OSC server we use to receive metrics from NAR Studio over
// UDP. Niagara is listed so the actor can poke emitter parameters directly
// from C++ without going through Blueprints.

using UnrealBuildTool;

public class NarVisualizer : ModuleRules
{
    public NarVisualizer(ReadOnlyTargetRules Target) : base(Target)
    {
        PCHUsage = PCHUsageMode.UseExplicitOrSharedPCHs;

        PublicDependencyModuleNames.AddRange(new[]
        {
            "Core",
            "CoreUObject",
            "Engine",
            "InputCore",
            "OSC",
            "Niagara",
        });

        PrivateDependencyModuleNames.AddRange(new[]
        {
            "Slate",
            "SlateCore",
        });
    }
}
