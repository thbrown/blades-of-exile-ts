// The one Mac-resource-fork graphics loader the wasm build leaves out.
#include <filesystem>
namespace sf { class Image; }
bool tryLoadPictFromResourceFile(std::filesystem::path& gpath, sf::Image& graphics_store);
bool tryLoadPictFromResourceFile(std::filesystem::path&, sf::Image&) { return false; }

// ---- native main loop -------------------------------------------------
// Under Emscripten the loop is handed to the browser; natively we just call
// it. It stops when the game says so, or when the replay runs out — otherwise
// it would spin forever waiting for input from a window that doesn't exist.
extern bool replaying;
extern bool All_Done;
static bool shim_loop_running = false;

extern "C" void boe_shim_cancel_main_loop() { shim_loop_running = false; }

extern "C" void boe_shim_run_main_loop(void (*f)()) {
	shim_loop_running = true;
	bool was_replaying = replaying;
	while (shim_loop_running && !All_Done) {
		f();
		if (was_replaying && !replaying) break;
	}
}

// ---- crash trace -------------------------------------------------------
// The sandbox this harness runs in doesn't allow a debugger to attach, so a
// segfault is otherwise a bare exit 139. Print the stack ourselves.
#include <csignal>
#include <cstdio>
#include <cstdlib>
#include <execinfo.h>
#include <unistd.h>

extern "C" void boe_shim_crash_handler(int sig) {
	void* frames[64];
	int n = backtrace(frames, 64);
	fprintf(stderr, "\n[CRASH] signal %d\n", sig);
	backtrace_symbols_fd(frames, n, 2);
	_exit(139);
}

__attribute__((constructor)) static void boe_shim_install_crash_handler() {
	signal(SIGSEGV, boe_shim_crash_handler);
	signal(SIGBUS, boe_shim_crash_handler);
	signal(SIGABRT, boe_shim_crash_handler);
}
