#include "NarOscReceiver.h"

#include "OSCManager.h"
#include "OSCAddress.h"
#include "OSCMessage.h"
#include "Engine/World.h"
#include "Kismet/KismetMaterialLibrary.h"
#include "Materials/MaterialParameterCollection.h"
#include "NiagaraComponent.h"

ANarOscReceiver::ANarOscReceiver()
{
    PrimaryActorTick.bCanEverTick = true;
    PrimaryActorTick.TickInterval = 0.5f; // The watchdog only needs to run twice a second.
}

void ANarOscReceiver::BeginPlay()
{
    Super::BeginPlay();

    // Start a UDP OSC server. The engine plugin handles the socket plumbing;
    // we just need to register a handler for the messages we expect.
    Server = UOSCManager::CreateOSCServer(ListenAddress, ListenPort, /* bMulticastLoopback */ false,
        /* bStartListening */ true, FString("NarOscReceiver"), this);

    if (!Server)
    {
        UE_LOG(LogTemp, Error, TEXT("[NarOscReceiver] Could not start OSC server on %s:%d — port already in use?"),
            *ListenAddress, ListenPort);
        return;
    }

    Server->OnOscMessageReceived.AddDynamic(this, &ANarOscReceiver::HandleMessage);
    UE_LOG(LogTemp, Log, TEXT("[NarOscReceiver] Listening on %s:%d"), *ListenAddress, ListenPort);
}

void ANarOscReceiver::EndPlay(const EEndPlayReason::Type EndPlayReason)
{
    if (Server)
    {
        Server->OnOscMessageReceived.RemoveAll(this);
        Server->Stop();
        Server = nullptr;
    }
    Super::EndPlay(EndPlayReason);
}

void ANarOscReceiver::Tick(float DeltaSeconds)
{
    Super::Tick(DeltaSeconds);
    // Mark disconnected after 2 s of silence. The Visualizer can fade
    // particles, throttle camera shake, or swap to a default scene off this.
    const float Now = GetWorld() ? GetWorld()->GetTimeSeconds() : 0.f;
    bConnected = (LastPacketTime > 0.f) && (Now - LastPacketTime < 2.f);
}

void ANarOscReceiver::HandleMessage(const FOSCAddress& Address, const FOSCMessage& Message,
    const FString& /*IPAddress*/, int32 /*Port*/)
{
    // Address comes through as "/nar/bpm" etc. We dispatch by string compare —
    // the schema is small and stable, so a switch on FName is overkill.
    const FString Path = Address.GetFullPath();

    // Helper to read the first numeric arg as a float regardless of OSC type.
    auto ReadFloat = [&Message]() -> float
    {
        float V = 0.f;
        if (UOSCManager::GetFloat(Message, 0, V)) return V;
        int32 I = 0;
        if (UOSCManager::GetInt32(Message, 0, I)) return static_cast<float>(I);
        return 0.f;
    };

    auto ReadInt = [&Message]() -> int32
    {
        int32 I = 0;
        if (UOSCManager::GetInt32(Message, 0, I)) return I;
        float F = 0.f;
        if (UOSCManager::GetFloat(Message, 0, F)) return static_cast<int32>(F);
        return 0;
    };

    if (Path == TEXT("/nar/bpm"))            Bpm        = ReadFloat();
    else if (Path == TEXT("/nar/bpmLocked")) BpmLocked  = ReadFloat();
    else if (Path == TEXT("/nar/level"))     Level      = ReadFloat();
    else if (Path == TEXT("/nar/bass"))      Bass       = ReadFloat();
    else if (Path == TEXT("/nar/mid"))       Mid        = ReadFloat();
    else if (Path == TEXT("/nar/treble"))    Treble     = ReadFloat();
    else if (Path == TEXT("/nar/centroid"))  Centroid   = ReadFloat();
    else if (Path == TEXT("/nar/beatPhase")) BeatPhase  = ReadFloat();
    else if (Path == TEXT("/nar/lufs"))      Lufs       = ReadFloat();
    else if (Path == TEXT("/nar/beat"))
    {
        // Beat events carry an incrementing counter as the only arg; firing
        // a delegate is the cleanest way to expose "one-shot" semantics.
        const int32 N = ReadInt();
        if (N != BeatCount)
        {
            BeatCount = N;
            OnBeat.Broadcast(N);
        }
        // Don't push to MPC/Niagara — counters aren't meaningful as floats.
        return;
    }
    else
    {
        // Unknown address — surface to the generic event so the operator
        // can still bind custom routes from Blueprints if they extend the
        // schema NAR-Studio-side.
        const float V = ReadFloat();
        OnMetric.Broadcast(FName(*Path), V);
        LastPacketTime = GetWorld() ? GetWorld()->GetTimeSeconds() : LastPacketTime;
        return;
    }

    // Mirror to MPC + Niagara + generic event. Names map directly: trailing
    // /nar/ segment becomes the Niagara/MPC parameter name in TitleCase.
    const FName Tail = FName(*Path.RightChop(5)); // strip "/nar/"
    LastPacketTime = GetWorld() ? GetWorld()->GetTimeSeconds() : LastPacketTime;
    const float Value =
          Path == TEXT("/nar/bpm")        ? Bpm
        : Path == TEXT("/nar/bpmLocked")  ? BpmLocked
        : Path == TEXT("/nar/level")      ? Level
        : Path == TEXT("/nar/bass")       ? Bass
        : Path == TEXT("/nar/mid")        ? Mid
        : Path == TEXT("/nar/treble")     ? Treble
        : Path == TEXT("/nar/centroid")   ? Centroid
        : Path == TEXT("/nar/beatPhase")  ? BeatPhase
        : Lufs;

    ApplyToMpc(Tail, Value);
    ApplyToNiagara(Tail, Value);
    OnMetric.Broadcast(Tail, Value);
}

void ANarOscReceiver::ApplyToMpc(FName Name, float Value) const
{
    if (!SharedParameters) return;
    // SetScalarParameterValue silently no-ops if the MPC doesn't have a
    // parameter of this name — that's fine, we don't need them all present.
    UKismetMaterialLibrary::SetScalarParameterValue(GetWorld(), SharedParameters, Name, Value);
}

void ANarOscReceiver::ApplyToNiagara(FName Name, float Value) const
{
    // Niagara User Parameters are namespaced "User.Foo" — prepend if needed.
    const FString Wanted = FString::Printf(TEXT("User.%s"), *Name.ToString());
    const FName WantedName(*Wanted);
    for (const TObjectPtr<UNiagaraComponent>& Comp : NiagaraTargets)
    {
        if (!Comp) continue;
        Comp->SetVariableFloat(WantedName, Value);
    }
}
