#pragma once

#include <gdkmm/pixbuf.h>
#include <gtkmm/widget.h>
#include <webkit2/webkit2.h>

namespace wil::ui
{
    namespace detail
    {
        void loadChanged(WebKitWebView*, WebKitLoadEvent loadEvent, gpointer userData);
        void webProcessTerminated(WebKitWebView*, WebKitWebProcessTerminationReason reason, gpointer userData);
    }

    class WebView : public Gtk::Widget
    {
        public:
            WebView();
            ~WebView() override;

            operator WebKitWebView*();

        public:
            void            refresh();
            WebKitLoadEvent getLoadStatus() const noexcept;
            void            setHwAccelPolicy(WebKitHardwareAccelerationPolicy policy);
            void            setUserAgent(std::string const& userAgent);
            void            setTheme(int index);
            void            sendRequest(std::string url);
            void            openPhoneNumber(std::string const& phoneNumber);
            bool            pasteClipboardImage();
            void            pasteImage(Glib::RefPtr<Gdk::Pixbuf> const& pixbuf);
            void            wrapSelection(std::string const& prefix, std::string const& suffix);
            void            zoomIn();
            void            zoomOut();
            void            resetZoom();
            double          getZoomLevel();
            std::string     getZoomLevelString();
            void            setMinFontSize(unsigned int fontSize);

            sigc::signal<void, WebKitLoadEvent>& signalLoadStatus() noexcept;
            sigc::signal<void, bool>&            signalNotification() noexcept;
            sigc::signal<void>&                  signalNotificationClicked() noexcept;

        private:
            void onLoadStatusChanged(WebKitLoadEvent loadEvent);
            void onWebProcessTerminated(WebKitWebProcessTerminationReason reason);
            bool onTimeout();
            void applyCustomCss(const std::string& cssFilePath);
            void addStyleSheet(std::string const& css);
            void injectCrashRecoveryScript();

            friend void detail::loadChanged(WebKitWebView*, WebKitLoadEvent, gpointer);
            friend void detail::webProcessTerminated(WebKitWebView*, WebKitWebProcessTerminationReason, gpointer);

        private:
            WebKitLoadEvent                     m_loadStatus;
            bool                                m_stoppedResponding;
            int                                 m_crashCount;
            gint64                              m_lastCrashTime;
            sigc::signal<void, WebKitLoadEvent> m_signalLoadStatus;
            sigc::signal<void, bool>            m_signalNotification;
            sigc::signal<void>                  m_signalNotificationClicked;
    };
}
