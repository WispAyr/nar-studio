// Module entry point — required for any UE C++ module. The real work lives
// in NarOscReceiver.{h,cpp}; this file just satisfies UBT's module contract.

#pragma once

#include "CoreMinimal.h"
#include "Modules/ModuleManager.h"

class FNarVisualizerModule : public IModuleInterface
{
public:
    virtual void StartupModule() override;
    virtual void ShutdownModule() override;
};
