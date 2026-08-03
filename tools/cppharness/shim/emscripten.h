// Scratch shim: lets the Emscripten source path compile with a native clang++.
// EM_ASM blocks are JS; natively they become no-ops.
#pragma once
#include <cstdio>
#define EM_ASM(...)            ((void)0)
#define EM_ASM_(...)           ((void)0)
#define EM_ASM_INT(...)        (0)
#define EM_ASM_DOUBLE(...)     (0.0)
#define EM_ASM_PTR(...)        (0)
#define EMSCRIPTEN_KEEPALIVE
// The native driver: run the iteration function until the replay is spent.
extern "C" void boe_shim_run_main_loop(void (*f)());
extern "C" void boe_shim_cancel_main_loop();
#define emscripten_set_main_loop(f, fps, loop) boe_shim_run_main_loop(f)
#define emscripten_cancel_main_loop()          boe_shim_cancel_main_loop()
#define emscripten_sleep(ms)                   ((void)0)
