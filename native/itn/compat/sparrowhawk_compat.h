// SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
// OpenFST 1.8 / Sparrowhawk compatibility shim for the Spoke ITN helper.
//
// Sparrowhawk's public headers were written against OpenFST <=1.7. OpenFST
// 1.8 removed several legacy aliases and changed the token-type name. The
// protobuf header must be included first: newer protobuf releases define LOG
// macros that OpenFST's log header intentionally replaces.
#pragma once

#include <google/protobuf/message.h>
#include <fst/types.h>
#include <fst/log.h>
#include <fst/string.h>

#include <cstdint>
#include <string>

using int8 = int8_t;
using int16 = int16_t;
using int32 = int32_t;
using int64 = int64_t;
using uint8 = uint8_t;
using uint16 = uint16_t;
using uint32 = uint32_t;
using uint64 = uint64_t;

using std::string;

namespace fst {
using StringTokenType = TokenType;
}  // namespace fst

#ifndef DISALLOW_COPY_AND_ASSIGN
#define DISALLOW_COPY_AND_ASSIGN(TypeName) \
    TypeName(const TypeName&) = delete;    \
    TypeName& operator=(const TypeName&) = delete
#endif
