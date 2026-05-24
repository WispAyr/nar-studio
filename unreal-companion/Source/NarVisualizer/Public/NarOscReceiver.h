// OSC receiver actor — drop one of these into the level and it auto-binds
// to UDP :9000, decodes every metric NAR Studio sends, and surfaces them
// as Blueprint-readable properties that you can wire straight into Niagara
// User Parameters, Material Parameter Collections, Sequencer cues, etc.
//
// Schema (matches NAR Studio's OSC bridge):
//   /nar/bpm        float
//   /nar/bpmLocked  float (0/1)
//   /nar/level      float
//   /nar/bass       float
//   /nar/mid        float
//   /nar/treble     float
//   /nar/centroid   float
//   /nar/beatPhase  float
//   /nar/lufs       float
//   /nar/beat       int   — monotonically increments once per onset

#pragma once

#include "CoreMinimal.h"
#include "GameFramework/Actor.h"
#include "OSCServer.h"
#include "OSCMessage.h"
#include "NiagaraComponent.h"
#include "NarOscReceiver.generated.h"

class UNiagaraSystem;
class UNiagaraComponent;
class UMaterialParameterCollection;

/** One-event delegate fired once per detected beat — bind from Blueprints to
 *  spawn particle bursts, swap shots, trigger Sequencer cues, etc. */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_OneParam(FNarOnBeat, int32, BeatCount);

/** Generic "any metric updated" delegate — useful for debugging visualisers. */
DECLARE_DYNAMIC_MULTICAST_DELEGATE_TwoParams(FNarOnMetric, FName, Address, float, Value);

UCLASS(BlueprintType, Blueprintable, Category = "NAR Studio")
class NARVISUALIZER_API ANarOscReceiver : public AActor
{
    GENERATED_BODY()

public:
    ANarOscReceiver();

    // ── Configuration ────────────────────────────────────────────────────────

    /** UDP port to listen on. Must match the OSC port set in NAR Studio. */
    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "NAR Studio")
    int32 ListenPort = 9000;

    /** Listen IP. 0.0.0.0 accepts from anywhere; 127.0.0.1 restricts to the
     *  local machine. NAR Studio defaults to 127.0.0.1 (same-machine setup). */
    UPROPERTY(EditAnywhere, BlueprintReadOnly, Category = "NAR Studio")
    FString ListenAddress = TEXT("0.0.0.0");

    /**
     * Optional Material Parameter Collection — when set, the receiver writes
     * each metric into the MPC by the same name (Bpm, Bass, Mid, …) so any
     * material referencing this MPC reacts globally without per-actor wiring.
     */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "NAR Studio")
    TObjectPtr<UMaterialParameterCollection> SharedParameters = nullptr;

    /**
     * Optional Niagara components on the same actor whose User Parameters of
     * matching names (e.g. "User.Bpm") get auto-poked on every metric tick.
     * Add an emitter, set a float user parameter called User.Bpm in Niagara,
     * and it just works.
     */
    UPROPERTY(EditAnywhere, BlueprintReadWrite, Category = "NAR Studio")
    TArray<TObjectPtr<UNiagaraComponent>> NiagaraTargets;

    // ── Live metric values — read these from any Blueprint ──────────────────

    UPROPERTY(BlueprintReadOnly, Category = "NAR Studio|Metrics") float Bpm = 0.f;
    UPROPERTY(BlueprintReadOnly, Category = "NAR Studio|Metrics") float BpmLocked = 0.f;
    UPROPERTY(BlueprintReadOnly, Category = "NAR Studio|Metrics") float Level = 0.f;
    UPROPERTY(BlueprintReadOnly, Category = "NAR Studio|Metrics") float Bass = 0.f;
    UPROPERTY(BlueprintReadOnly, Category = "NAR Studio|Metrics") float Mid = 0.f;
    UPROPERTY(BlueprintReadOnly, Category = "NAR Studio|Metrics") float Treble = 0.f;
    UPROPERTY(BlueprintReadOnly, Category = "NAR Studio|Metrics") float Centroid = 0.f;
    UPROPERTY(BlueprintReadOnly, Category = "NAR Studio|Metrics") float BeatPhase = 0.f;
    UPROPERTY(BlueprintReadOnly, Category = "NAR Studio|Metrics") float Lufs = -60.f;
    UPROPERTY(BlueprintReadOnly, Category = "NAR Studio|Metrics") int32 BeatCount = 0;

    /** Wall-clock time of the last received packet — useful for the watchdog. */
    UPROPERTY(BlueprintReadOnly, Category = "NAR Studio|Health")
    float LastPacketTime = 0.f;

    /** True when packets have been arriving in the last 2 seconds. */
    UPROPERTY(BlueprintReadOnly, Category = "NAR Studio|Health")
    bool bConnected = false;

    // ── Events ───────────────────────────────────────────────────────────────

    UPROPERTY(BlueprintAssignable, Category = "NAR Studio|Events")
    FNarOnBeat OnBeat;

    UPROPERTY(BlueprintAssignable, Category = "NAR Studio|Events")
    FNarOnMetric OnMetric;

protected:
    virtual void BeginPlay() override;
    virtual void EndPlay(const EEndPlayReason::Type EndPlayReason) override;
    virtual void Tick(float DeltaSeconds) override;

private:
    UPROPERTY()
    TObjectPtr<UOSCServer> Server = nullptr;

    UFUNCTION()
    void HandleMessage(const FOSCAddress& Address, const FOSCMessage& Message, const FString& IPAddress, int32 Port);

    void ApplyToNiagara(FName Name, float Value) const;
    void ApplyToMpc(FName Name, float Value) const;
};
