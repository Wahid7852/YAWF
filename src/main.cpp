#include <clocale>
#include <cstdlib>
#include <cstring>
#include <glibmm/i18n.h>
#include <webkit2/webkit2.h>
#include "Config.hpp"
#include "ui/Application.hpp"
#include "util/Helper.hpp"

namespace
{
    void sigterm(int)
    {
        wil::ui::Application::getInstance().quit();
    }

    // WebKitGTK's DMABUF renderer is broken on wlroots-based Wayland compositors
    // (Hyprland, Sway, river, ...) with Mesa, causing runaway GPU usage and frequent
    // web-process crashes. GNOME (Mutter) and KDE (KWin) are unaffected, so only force
    // the stable path on wlroots. Honour a user-provided value (overwrite = 0).
    void applyWlrootsWorkarounds()
    {
        char const* const wayland = std::getenv("WAYLAND_DISPLAY");
        if (!wayland || !*wayland)
        {
            return;
        }

        char const* const desktop      = std::getenv("XDG_CURRENT_DESKTOP");
        bool const        isGnomeOrKde = desktop && (std::strstr(desktop, "GNOME") || std::strstr(desktop, "KDE") || std::strstr(desktop, "Plasma"));

        if (!isGnomeOrKde)
        {
            setenv("WEBKIT_DISABLE_DMABUF_RENDERER", "1", 0);
        }
    }

    // Bound the web process so a long-running WhatsApp Web session releases caches and
    // gets garbage-collected instead of ballooning to several GB. Must be configured
    // before the first web context (i.e. the first WebView) is created.
    void applyMemoryPressureSettings()
    {
        // Note: WhatsApp Web's live JS heap (~1 GB) cannot be reclaimed by cache eviction; these
        // thresholds keep caches small and, as a last resort, kill a truly runaway web process
        // (the kill is caught by WebView's crash handler, which reloads the page).
        WebKitMemoryPressureSettings* const settings = webkit_memory_pressure_settings_new();
        webkit_memory_pressure_settings_set_memory_limit(settings, 1536U);           // MB
        webkit_memory_pressure_settings_set_conservative_threshold(settings, 0.33);  // start releasing caches
        webkit_memory_pressure_settings_set_strict_threshold(settings, 0.5);         // release all caches
        webkit_memory_pressure_settings_set_kill_threshold(settings, 1.5);           // kill a runaway process
        webkit_memory_pressure_settings_set_poll_interval(settings, 15.0);           // seconds

        webkit_website_data_manager_set_memory_pressure_settings(settings);
        webkit_memory_pressure_settings_free(settings);
    }
}

int main(int argc, char** argv)
{
    applyWlrootsWorkarounds();
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
