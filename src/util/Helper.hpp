#pragma once

#include <optional>
#include <string>

namespace wil::util
{
    void redirectOutputToLogger();

    // Capture an interactively-selected screen region to a temporary PNG and return its path
    // (caller owns the file and should unlink it). Picks the first available capture tool so it
    // works across desktops (KDE/GNOME/wlroots/X11). Returns nullopt if no tool is found or the
    // capture was cancelled/failed.
    std::optional<std::string> captureScreenRegionToPng();
}
