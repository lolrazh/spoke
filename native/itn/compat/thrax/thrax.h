// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
// Sparrowhawk's configure script checks for this umbrella header. The Spoke
// helper loads precompiled FAR grammars and does not compile Thrax grammars at
// runtime, so the source-compatible GrmManager below is sufficient.
#pragma once

#include "grm-manager.h"
