// SPDX-FileCopyrightText: Copyright (c) 2026 Spoke contributors
// SPDX-License-Identifier: Apache-2.0
//
// Small persistent wrapper around NeMo-Speech.cpp's FST normalizer. The
// application sends UTF-8 strings as little-endian uint32 length-prefixed
// frames on stdin and receives the normalized UTF-8 strings on stdout.

#include "fst_normalizer.h"

#include <cstdint>
#include <exception>
#include <iostream>
#include <stdexcept>
#include <string>

namespace {

constexpr std::uint32_t kMaxFrameBytes = 16 * 1024 * 1024;

bool read_u32(std::uint32_t* value) {
    unsigned char bytes[sizeof(std::uint32_t)]{};
    if (std::cin.read(reinterpret_cast<char*>(bytes), sizeof(bytes))) {
        *value = static_cast<std::uint32_t>(bytes[0]) |
                 (static_cast<std::uint32_t>(bytes[1]) << 8) |
                 (static_cast<std::uint32_t>(bytes[2]) << 16) |
                 (static_cast<std::uint32_t>(bytes[3]) << 24);
        return true;
    }
    if (std::cin.gcount() == 0 && std::cin.eof())
        return false;
    throw std::runtime_error("truncated ITN frame length");
}

bool write_frame(const std::string& text) {
    if (text.size() > kMaxFrameBytes)
        throw std::runtime_error("ITN output frame is too large");
    const auto size = static_cast<std::uint32_t>(text.size());
    const unsigned char bytes[] = {
        static_cast<unsigned char>(size & 0xff),
        static_cast<unsigned char>((size >> 8) & 0xff),
        static_cast<unsigned char>((size >> 16) & 0xff),
        static_cast<unsigned char>((size >> 24) & 0xff),
    };
    std::cout.write(reinterpret_cast<const char*>(bytes), sizeof(bytes));
    std::cout.write(text.data(), static_cast<std::streamsize>(text.size()));
    std::cout.flush();
    return static_cast<bool>(std::cout);
}

}  // namespace

int main(int argc, char** argv) {
    if (argc != 2 || argv[1][0] == '\0') {
        std::cerr << "usage: spoke-itn <grammar-directory>\n";
        return 64;
    }

    try {
        nemo_speech::text_normalization::FstNormalizer normalizer(argv[1]);
        std::uint32_t size = 0;
        while (read_u32(&size)) {
            if (size > kMaxFrameBytes)
                throw std::runtime_error("ITN input frame is too large");
            std::string input(size, '\0');
            if (size > 0 &&
                !std::cin.read(input.data(), static_cast<std::streamsize>(size))) {
                throw std::runtime_error("truncated ITN input frame");
            }
            if (!write_frame(normalizer.normalize(input)))
                return 74;
        }
    } catch (const std::exception& error) {
        std::cerr << "spoke-itn: " << error.what() << '\n';
        return 70;
    }
    return 0;
}
