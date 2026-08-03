// Minimal stand-in for the cppcodec submodule, which is not checked out.
// Only the two calls src/tools/replay.cpp makes are provided.
#pragma once
#include <cstdint>
#include <string>
#include <vector>

namespace cppcodec {
struct base64_rfc4648 {
	static constexpr const char* A =
		"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

	static std::string encode(const char* p, size_t n) {
		std::string out;
		out.reserve((n + 2) / 3 * 4);
		for (size_t i = 0; i < n; i += 3) {
			uint32_t v = uint8_t(p[i]) << 16;
			if (i + 1 < n) v |= uint8_t(p[i + 1]) << 8;
			if (i + 2 < n) v |= uint8_t(p[i + 2]);
			out += A[(v >> 18) & 63];
			out += A[(v >> 12) & 63];
			out += (i + 1 < n) ? A[(v >> 6) & 63] : '=';
			out += (i + 2 < n) ? A[v & 63] : '=';
		}
		return out;
	}

	static std::vector<uint8_t> decode(const char* p, size_t n) {
		int8_t rev[256];
		for (int i = 0; i < 256; i++) rev[i] = -1;
		for (int i = 0; i < 64; i++) rev[uint8_t(A[i])] = int8_t(i);
		std::vector<uint8_t> out;
		uint32_t acc = 0;
		int bits = 0;
		for (size_t i = 0; i < n; i++) {
			int8_t d = rev[uint8_t(p[i])];
			if (d < 0) continue; // newline, padding, whitespace
			acc = (acc << 6) | uint32_t(d);
			bits += 6;
			if (bits >= 8) {
				bits -= 8;
				out.push_back(uint8_t((acc >> bits) & 0xFF));
			}
		}
		return out;
	}
};
} // namespace cppcodec
