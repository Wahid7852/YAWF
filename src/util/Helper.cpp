#include "Helper.hpp"
#include <cstdio>
#include <cstdlib>
#include <fcntl.h>
#include <unistd.h>
#include <fstream>
#include <iostream>
#include <utility>
#include <vector>
#include <giomm/file.h>
#include <glibmm/fileutils.h>
#include <glibmm/miscutils.h>
#include "Config.hpp"

namespace wil::util
{
    namespace
    {
        bool fileHasContent(std::string const& path)
        {
            auto stream = std::ifstream{path, std::ios::binary | std::ios::ate};
            return stream && stream.tellg() > 0;
        }
    }

    std::optional<std::string> captureScreenRegionToPng(bool& toolMissing)
    {
        toolMissing = true;

        auto path = std::string{};
        try
        {
            auto const fd = Glib::file_open_tmp(path, "yawf-XXXXXX.png");
            ::close(fd);
        }
        catch (Glib::FileError const& error)
        {
            std::cerr << "Screenshot: Failed to create temp file: " << error.what() << std::endl;
            return std::nullopt;
        }

        // Region-capture commands per desktop, in priority order; each writes a PNG to `path`
        // and runs via the shell (they use $(...) / redirection).
        auto const tools = std::vector<std::pair<std::string, std::string>>{
            {"spectacle", "spectacle -rbno '" + path + "'"},                // KDE
            {"grim", "grim -g \"$(slurp)\" '" + path + "'"},                // wlroots (Sway/Hyprland)
            {"gnome-screenshot", "gnome-screenshot -a -f '" + path + "'"},  // GNOME
            {"maim", "maim -s '" + path + "'"},                             // X11
            {"flameshot", "flameshot gui --raw > '" + path + "'"},          // X11/Wayland
            {"import", "import '" + path + "'"},                            // X11 (ImageMagick)
        };

        for (auto const& [bin, command] : tools)
        {
            if (Glib::find_program_in_path(bin).empty())
            {
                continue;
            }
            if (bin == "grim" && Glib::find_program_in_path("slurp").empty())
            {
                continue;
            }

            toolMissing = false;

            auto const status = std::system(command.c_str());
            if (status == 0 && fileHasContent(path))
            {
                return path;
            }

            // Capture failed or was cancelled; don't try another tool (it would re-prompt).
            ::unlink(path.c_str());
            return std::nullopt;
        }

        ::unlink(path.c_str());
        return std::nullopt;
    }

    void redirectOutputToLogger()
    {
        if (!Gio::File::create_for_path("/dev/log")->query_exists() && !Gio::File::create_for_path("/var/run/syslog")->query_exists())
        {
            std::cerr << "Skipping redirection of output to logger since the user doesn't have an active syslog" << std::endl;
            return;
        }

        // No "-s": that echoes every line back to stderr, doubling volume and risking duplication.
        auto const fl = ::popen("logger -i -t " WIL_NAME, "w");
        if (!fl)
        {
            auto const errorNumber = errno;
            std::cerr << "Failed to open pipe to logger: " << strerror(errorNumber) << std::endl;
            return;
        }

        auto const fd = ::fileno(fl);
        ::dup2(fd, STDERR_FILENO);

        // The web process inherits this stderr. A flood (e.g. GST_DEBUG) must never block it on a
        // full pipe and stall the renderer, so make writes non-blocking: under flood they drop with
        // EAGAIN instead of stalling. Dropped log lines are an acceptable trade for a responsive UI.
        ::fcntl(STDERR_FILENO, F_SETFL, O_NONBLOCK);
    }
}
