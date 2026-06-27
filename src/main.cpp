#include <algorithm>
#include <clocale>
#include <cstdio>
#include <string>
#include <vector>
#include <glibmm/i18n.h>
#include <jsc/jsc.h>
#include <webkit2/webkit2.h>
#include "Config.hpp"
#include "ui/Application.hpp"
#include "util/Helper.hpp"
#include "util/Profile.hpp"

namespace
{
    // Consume "--profile <name>" (so multiple accounts can run side by side) before GTK parses
    // the arguments, compacting it out of argv. Returns the remaining argument count.
    int extractProfile(int argc, char** argv)
    {
        auto remaining = std::vector<char*>{};
        for (int i = 0; i < argc; ++i)
        {
            if (std::string{argv[i]} == "--profile" && i + 1 < argc)
            {
                wil::util::profileName() = argv[++i];
                continue;
            }
            remaining.push_back(argv[i]);
        }

        std::copy(remaining.begin(), remaining.end(), argv);
        return static_cast<int>(remaining.size());
    }

    void sigterm(int)
    {
        wil::ui::Application::getInstance().quit();
    }

    // Use 25% of physical RAM as the WebKit memory accounting base, clamped to [1024, 3072] MB.
    // This ensures the conservative/strict cache-release thresholds actually fire on real hardware.
    // The hardcoded 8192 MB base meant thresholds only triggered at 5.3/6.8 GB, well above the
    // ~3 GB the web process reaches before the OS OOM-kills it.
    guint webKitMemoryLimitMB()
    {
        unsigned long memKB = 0;
        if (auto* f = std::fopen("/proc/meminfo", "r"))
        {
            char line[128];
            while (std::fgets(line, sizeof(line), f))
                if (std::sscanf(line, "MemTotal: %lu kB", &memKB) == 1)
                    break;
            std::fclose(f);
        }
        if (memKB == 0)
            return 3072U;
        auto const fortyPct = static_cast<guint>(memKB / 1024UL * 2UL / 5UL);
        return std::max(2048U, std::min(4096U, fortyPct));
    }

    // Bound the web process so a long-running WhatsApp Web session releases caches and
    // gets garbage-collected instead of ballooning to several GB. Must be configured
    // before the first web context (i.e. the first WebView) is created.
    void applyMemoryPressureSettings()
    {
        // Only release caches under pressure; never set a kill threshold — SIGKILLing the web
        // process mid-write corrupts WhatsApp's IndexedDB and logs the user out. Strict before
        // conservative (the setters assert conservative < strict).
        WebKitMemoryPressureSettings* const settings = webkit_memory_pressure_settings_new();
        webkit_memory_pressure_settings_set_memory_limit(settings, webKitMemoryLimitMB());
        webkit_memory_pressure_settings_set_strict_threshold(settings, 0.85);        // release all caches
        webkit_memory_pressure_settings_set_conservative_threshold(settings, 0.65);  // start releasing caches
        webkit_memory_pressure_settings_set_poll_interval(settings, 5.0);            // seconds; was 30

        webkit_website_data_manager_set_memory_pressure_settings(settings);
        webkit_memory_pressure_settings_free(settings);
    }

    // Configure JavaScriptCore GC for WhatsApp Web's workload (many short-lived message objects
    // under burst traffic). Must be called before the first web context is created.
    void applyJscOptions()
    {
        // Run GC work concurrently with JS execution — reduces the main-thread stall that causes
        // UI stutters during heavy message storms.
        jsc_options_set_boolean("useConcurrentGC", TRUE);
        // Collect short-lived objects cheaply in the nursery before they promote to the major heap.
        jsc_options_set_boolean("useGenerationalGC", TRUE);
    }

    // Intel + WebKitGTK's GStreamer GL sink can't map hardware-decoded DMABuf frames, so videos
    // render glitched. Route video through system memory: disable the GL sink and derank the VA
    // decoders so software decode yields mappable frames. Set before any web process spawns;
    // explicit user overrides are respected.
    void applyVideoWorkarounds()
    {
        g_setenv("WEBKIT_GST_DISABLE_GL_SINK", "1", FALSE);
        g_setenv("GST_PLUGIN_FEATURE_RANK", "vah264dec:NONE,vah265dec:NONE,vavp8dec:NONE,vavp9dec:NONE,vaav1dec:NONE", FALSE);

        // Avoid the libEGL teardown crash the web process hits on Intel/Mesa under Wayland.
        g_setenv("WEBKIT_DISABLE_DMABUF_RENDERER", "1", FALSE);

        // Cap GStreamer logging so it can't flood the logger (an explicit GST_DEBUG still wins).
        g_setenv("GST_DEBUG", "1", FALSE);
    }
}

int main(int argc, char** argv)
{
    argc = extractProfile(argc, argv);

    wil::util::migrateLegacyUserData();

    applyVideoWorkarounds();
    applyJscOptions();
    applyMemoryPressureSettings();

    setlocale(LC_ALL, "");

    bindtextdomain(GETTEXT_PACKAGE, WIL_LOCALEDIR);
    bind_textdomain_codeset(GETTEXT_PACKAGE, "UTF-8");
    textdomain(GETTEXT_PACKAGE);

    auto app = wil::ui::Application{argc, argv};

    wil::util::redirectOutputToLogger();

    signal(SIGINT, sigterm);
    signal(SIGTERM, sigterm);
    signal(SIGPIPE, SIG_IGN);

    return app.run();
}
