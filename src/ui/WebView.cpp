#include "WebView.hpp"
#include <iostream>
#include <string>
#include <fstream>
#include <streambuf>
#include <optional>
#include <locale>
#include <glibmm/base64.h>
#include <glibmm/i18n.h>
#include <glibmm/main.h>
#include <glibmm/miscutils.h>
#include <gtkmm/clipboard.h>
#include <gtkmm/messagedialog.h>
#include <gtkmm/filechooserdialog.h>
#include "../util/Profile.hpp"
#include "../util/Settings.hpp"
#include "Config.hpp"

namespace wil::ui
{
    namespace
    {
        constexpr auto const WHATSAPP_WEB_URI = "https://web.whatsapp.com";

        // Default profile uses WebKit's shared default context (so existing sessions are
        // untouched); a named profile gets an isolated data manager under its own directory.
        GtkWidget* makeWebView()
        {
            if (util::profileName().empty())
            {
                return webkit_web_view_new();
            }

            auto const dataDir  = Glib::get_user_data_dir() + "/" WIL_NAME + util::profilePathSuffix();
            auto const cacheDir = Glib::get_user_cache_dir() + "/" WIL_NAME + util::profilePathSuffix();
            g_mkdir_with_parents(dataDir.c_str(), 0700);

            auto* const manager = webkit_website_data_manager_new("base-data-directory", dataDir.c_str(), "base-cache-directory", cacheDir.c_str(), nullptr);
            auto* const context = webkit_web_context_new_with_website_data_manager(manager);
            return webkit_web_view_new_with_context(context);
        }
        constexpr auto const USER_AGENT = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Safari/537.36";

        // webkit2gtk >= 2.40 dropped the ON_DEMAND policy; the enum is now { ALWAYS = 0, NEVER = 1 }.
        // Our stored "hw-accel" setting uses the same two values. ALWAYS is the sane default for GPU
        // compositing; clamp anything unexpected (including legacy 3-value settings) to ALWAYS.
        WebKitHardwareAccelerationPolicy toHwAccelPolicy(int value)
        {
            return value == WEBKIT_HARDWARE_ACCELERATION_POLICY_NEVER ? WEBKIT_HARDWARE_ACCELERATION_POLICY_NEVER : WEBKIT_HARDWARE_ACCELERATION_POLICY_ALWAYS;
        }

        std::optional<std::string> getSystemLanguage()
        {
            try
            {
                auto const lang = std::locale{""}.name();
                return lang.substr(0, lang.find('.'));
            }
            catch (std::runtime_error const& error)
            {
                std::cerr << "WebView: Failed to get system language: " << error.what() << std::endl;
                return std::nullopt;
            }
        }

        gboolean permissionRequest(WebKitWebView*, WebKitPermissionRequest* request, GtkWindow*)
        {
            if (util::Settings::getInstance().getValue<bool>("web", "allow-permissions"))
            {
                webkit_permission_request_allow(request);
                return TRUE;
            }

            auto dialog = Gtk::MessageDialog{_("Permission Request"), false, Gtk::MESSAGE_QUESTION, Gtk::BUTTONS_YES_NO};
            dialog.set_secondary_text(_("Would you like to allow permissions?"));

            auto const allow = (dialog.run() == Gtk::RESPONSE_YES);
            allow ? webkit_permission_request_allow(request) : webkit_permission_request_deny(request);
            util::Settings::getInstance().setValue("web", "allow-permissions", allow);

            return TRUE;
        }

        gboolean decidePolicy(WebKitWebView*, WebKitPolicyDecision* decision, WebKitPolicyDecisionType decisionType, gpointer)
        {
            switch (decisionType)
            {
                case WEBKIT_POLICY_DECISION_TYPE_NEW_WINDOW_ACTION:
                {
                    auto const navigationDecision = WEBKIT_NAVIGATION_POLICY_DECISION(decision);
                    auto const navigationAction   = webkit_navigation_policy_decision_get_navigation_action(navigationDecision);
                    auto const request            = webkit_navigation_action_get_request(navigationAction);
                    auto const uri                = webkit_uri_request_get_uri(request);

                    if (GError* error = nullptr; !gtk_show_uri_on_window(nullptr, uri, GDK_CURRENT_TIME, &error))
                    {
                        std::cerr << "WebView: Failed to show uri: " << error->message << std::endl;
                    }
                    return TRUE;
                }

                default:
                    return FALSE;
            }
        }

        gboolean downloadDecideDestination(WebKitDownload* download, char* suggestedFilename, gpointer)
        {
            auto dialog = Gtk::FileChooserDialog{_("Save File"), Gtk::FILE_CHOOSER_ACTION_SAVE};
            dialog.add_button(_("Ok"), Gtk::RESPONSE_OK);
            dialog.add_button(_("Cancel"), Gtk::RESPONSE_CANCEL);
            dialog.set_current_name(suggestedFilename);

            auto const result = dialog.run();
            switch (result)
            {
                case Gtk::RESPONSE_OK:
                {
                    auto const destination = "file://" + dialog.get_filename();
                    webkit_download_set_destination(download, destination.c_str());
                    return TRUE;
                }

                case Gtk::RESPONSE_CANCEL:
                default:
                    webkit_download_cancel(download);
                    return FALSE;
            }
        }

        void downloadStarted(WebKitWebContext*, WebKitDownload* download, gpointer)
        {
            g_signal_connect(download, "decide-destination", G_CALLBACK(downloadDecideDestination), nullptr);
        }

        void initializeNotificationPermission(WebKitWebContext* context, gpointer)
        {
            if (util::Settings::getInstance().getValue<bool>("web", "allow-permissions"))
            {
                auto const origin         = webkit_security_origin_new_for_uri(WHATSAPP_WEB_URI);
                auto const allowedOrigins = g_list_alloc();
                allowedOrigins->data      = origin;

                webkit_web_context_initialize_notification_permissions(context, allowedOrigins, nullptr);

                g_list_free(allowedOrigins);
            }
            else
            {
                webkit_web_context_initialize_notification_permissions(context, nullptr, nullptr);
            }
        }

        void notificationDestroyed(WebKitNotification*, gpointer userData)
        {
            if (auto const webView = reinterpret_cast<WebView*>(userData); webView)
            {
                webView->signalNotification().emit(false);
            }
        }

        void notificationClicked(WebKitNotification*, gpointer userData)
        {
            if (auto const webView = reinterpret_cast<WebView*>(userData); webView)
            {
                webView->signalNotificationClicked().emit();
            }
        }

        gboolean showNotification(WebKitWebView*, WebKitNotification* notification, gpointer userData)
        {
            auto const webView = reinterpret_cast<WebView*>(userData);
            if (webView)
            {
                webView->signalNotification().emit(true);
            }

            g_signal_connect(notification, "clicked", G_CALLBACK(notificationClicked), webView);
            g_signal_connect(notification, "closed", G_CALLBACK(notificationDestroyed), webView);

            return FALSE;
        }

        bool cssFileExists(const std::string& filePath)
        {
            auto const file = std::ifstream(filePath);
            return file.good();
        }

        std::string loadCssContent(const std::string& cssFilePath)
        {
            auto cssFile    = std::ifstream(cssFilePath);
            auto cssContent = std::string((std::istreambuf_iterator<char>(cssFile)), std::istreambuf_iterator<char>());

            return cssContent;
        }

        // Built-in theme presets, keyed by the combo box index used in the preferences window.
        // Deliberately uses generic selectors (not WhatsApp's obfuscated class names) so the
        // presets keep working as the web app changes.
        std::string themeCss(int index)
        {
            switch (index)
            {
                case 1:  // Reduce Motion (also lowers CPU/GPU from animations)
                    return "*, *::before, *::after { animation-duration: 0.001s !important; animation-delay: 0s !important; "
                           "transition-duration: 0.001s !important; }";
                case 2:  // Thin Scrollbars
                    return "::-webkit-scrollbar { width: 8px !important; height: 8px !important; }";
                default:  // None
                    return "";
            }
        }
    }

    namespace detail
    {
        void loadChanged(WebKitWebView*, WebKitLoadEvent loadEvent, gpointer userData)
        {
            if (auto const webView = reinterpret_cast<WebView*>(userData); webView)
            {
                webView->onLoadStatusChanged(loadEvent);
            }
        }

        void webProcessTerminated(WebKitWebView*, WebKitWebProcessTerminationReason reason, gpointer userData)
        {
            if (auto const webView = reinterpret_cast<WebView*>(userData); webView)
            {
                webView->onWebProcessTerminated(reason);
            }
        }
    }


    WebView::WebView()
        : Gtk::Widget{makeWebView()}
        , m_loadStatus{WEBKIT_LOAD_STARTED}
        , m_stoppedResponding{false}
        , m_crashCount{0}
        , m_lastCrashTime{0}
        , m_signalLoadStatus{}
        , m_signalNotification{}
        , m_signalNotificationClicked{}
    {
        auto const webContext = webkit_web_view_get_context(*this);

        auto configDir   = Glib::get_user_config_dir();
        auto cssFilePath = configDir + "/" + WIL_NAME + "/web.css";

        // Persist cookies to disk (the default context keeps them in memory only, which
        // contributes to random logouts). Stored alongside the rest of the app's web data.
        auto const dataDir       = Glib::get_user_data_dir() + "/" + WIL_NAME + util::profilePathSuffix();
        auto const cookieStore   = dataDir + "/cookies.sqlite";
        auto const cookieManager = webkit_web_context_get_cookie_manager(webContext);
        webkit_cookie_manager_set_persistent_storage(cookieManager, cookieStore.c_str(), WEBKIT_COOKIE_PERSISTENT_STORAGE_SQLITE);

        // Use the web-browser cache model so WhatsApp's static assets are kept on disk and warm
        // reloads (after a crash-recovery or a manual refresh) don't refetch the whole SPA.
        webkit_web_context_set_cache_model(webContext, WEBKIT_CACHE_MODEL_WEB_BROWSER);

        g_signal_connect(*this, "load-changed", G_CALLBACK(detail::loadChanged), this);
        g_signal_connect(*this, "permission-request", G_CALLBACK(permissionRequest), nullptr);
        g_signal_connect(*this, "decide-policy", G_CALLBACK(decidePolicy), nullptr);
        g_signal_connect(*this, "show-notification", G_CALLBACK(showNotification), this);
        g_signal_connect(*this, "web-process-terminated", G_CALLBACK(detail::webProcessTerminated), this);
        g_signal_connect(webContext, "download-started", G_CALLBACK(downloadStarted), nullptr);
        g_signal_connect(webContext, "initialize-notification-permissions", G_CALLBACK(initializeNotificationPermission), nullptr);
        Glib::signal_timeout().connect(sigc::mem_fun(*this, &WebView::onTimeout), 5000);

        if (auto const lang = getSystemLanguage(); lang.has_value())
        {
            gchar const* const spellCheckingLangs[] = {lang.value().c_str(), nullptr};
            webkit_web_context_set_spell_checking_enabled(webContext, TRUE);
            webkit_web_context_set_spell_checking_languages(webContext, spellCheckingLangs);
        }

        auto const settings  = webkit_web_view_get_settings(*this);
        auto const userAgent = util::Settings::getInstance().getValue<Glib::ustring>("web", "user-agent", "");
        webkit_settings_set_user_agent(settings, userAgent.empty() ? USER_AGENT : userAgent.c_str());
        webkit_settings_set_enable_developer_extras(settings, TRUE);
        auto const hwAccelPolicy = toHwAccelPolicy(util::Settings::getInstance().getValue<int>("web", "hw-accel", WEBKIT_HARDWARE_ACCELERATION_POLICY_ALWAYS));
        webkit_settings_set_hardware_acceleration_policy(settings, hwAccelPolicy);
        webkit_settings_set_minimum_font_size(settings, util::Settings::getInstance().getValue<int>("web", "min-font-size", 0));

        webkit_web_view_set_zoom_level(*this, util::Settings::getInstance().getValue<double>("general", "zoom-level", 1.0));

        if (cssFileExists(cssFilePath))
        {
            applyCustomCss(cssFilePath);
        }
        addStyleSheet(themeCss(util::Settings::getInstance().getValue<int>("web", "theme", 0)));

        injectCrashRecoveryScript();
        injectCtrlEnterSendScript();

        webkit_web_view_load_uri(*this, WHATSAPP_WEB_URI);
    }

    WebView::~WebView()
    {
        webkit_web_view_terminate_web_process(*this);
    }

    WebView::operator WebKitWebView*()
    {
        return WEBKIT_WEB_VIEW(gobj());
    }

    void WebView::refresh()
    {
        webkit_web_view_reload(*this);
    }

    WebKitLoadEvent WebView::getLoadStatus() const noexcept
    {
        return m_loadStatus;
    }

    void WebView::setHwAccelPolicy(WebKitHardwareAccelerationPolicy policy)
    {
        auto const settings = webkit_web_view_get_settings(*this);
        webkit_settings_set_hardware_acceleration_policy(settings, policy);
    }

    void WebView::setUserAgent(std::string const& userAgent)
    {
        auto const settings = webkit_web_view_get_settings(*this);
        webkit_settings_set_user_agent(settings, userAgent.empty() ? USER_AGENT : userAgent.c_str());
        webkit_web_view_reload(*this);
    }

    void WebView::sendRequest(std::string url)
    {
        if (auto const uriPrefix = std::string{"whatsapp:/"}; url.find(uriPrefix) != std::string::npos)
        {
            url.replace(0U, uriPrefix.size(), WHATSAPP_WEB_URI);

            std::cerr << "WebView: Sending request: " << url << std::endl;

            auto script = std::string{};
            script.append("(function(){"
                          "var a = document.createElement(\"a\");"
                          "a.href = \"");
            script.append(url);
            script.append("\";"
                          "document.body.appendChild(a);"
                          "a.click();"
                          "a.remove();"
                          "})();");

            webkit_web_view_evaluate_javascript(*this, script.c_str(), -1, nullptr, nullptr, nullptr, nullptr, nullptr);
        }
        else
        {
            std::cerr << "WebView: Invalid url: " << url << std::endl;
        }
    }

    void WebView::openPhoneNumber(std::string const& phoneNumber)
    {
        sendRequest("whatsapp://send?phone=" + phoneNumber);
    }

    bool WebView::pasteClipboardImage()
    {
        // WebKitGTK only hands text from the clipboard to the page's paste event, never images,
        // so a copied screenshot never reaches WhatsApp's composer. Bridge it ourselves: if the
        // clipboard holds an image, inject it; otherwise report "not handled" so normal text paste
        // still runs.
        auto const clipboard = Gtk::Clipboard::get();
        if (!clipboard->wait_is_image_available())
        {
            return false;
        }

        auto const pixbuf = clipboard->wait_for_image();
        if (!pixbuf)
        {
            return false;
        }

        pasteImage(pixbuf);
        return true;
    }

    void WebView::wrapSelection(std::string const& prefix, std::string const& suffix)
    {
        // Surround the current selection with WhatsApp markdown markers. execCommand('insertText')
        // fires the beforeinput/input events WhatsApp's editor listens for, so the change registers
        // (a direct DOM edit would be ignored). With no selection, insert the empty pair and park
        // the caret between the markers so the user can type the formatted text.
        auto const esc = [](std::string const& s)
        {
            auto out = std::string{};
            for (auto const c : s)
            {
                if (c == '\\' || c == '\'')
                {
                    out.push_back('\\');
                }
                out.push_back(c);
            }
            return out;
        };

        auto script = std::string{};
        script.append("(function(){var sel=window.getSelection();if(!sel)return;"
                      "var pre='");
        script.append(esc(prefix));
        script.append("';var suf='");
        script.append(esc(suffix));
        script.append("';var text=sel.toString();"
                      "if(text.length===0){document.execCommand('insertText',false,pre+suf);"
                      "for(var i=0;i<suf.length;i++){sel.modify('move','backward','character');}return;}"
                      "document.execCommand('insertText',false,pre+text+suf);})();");

        webkit_web_view_evaluate_javascript(*this, script.c_str(), -1, nullptr, nullptr, nullptr, nullptr, nullptr);
    }

    void WebView::clearFormatting()
    {
        // Strip WhatsApp markdown markers (``` then * _ ~) from the selection and re-insert the
        // plain text via execCommand so the editor registers the change.
        static char const* const script = "(function(){var sel=window.getSelection();if(!sel)return;var text=sel.toString();"
                                          "if(text.length===0)return;"
                                          "document.execCommand('insertText',false,text.replace(/```/g,'').replace(/[*_~]/g,''));})();";

        webkit_web_view_evaluate_javascript(*this, script, -1, nullptr, nullptr, nullptr, nullptr, nullptr);
    }

    void WebView::pasteImage(Glib::RefPtr<Gdk::Pixbuf> const& pixbuf)
    {
        if (!pixbuf)
        {
            return;
        }

        gchar* buffer     = nullptr;
        gsize  bufferSize = 0;
        try
        {
            pixbuf->save_to_buffer(buffer, bufferSize, "png");
        }
        catch (Glib::Error const& error)
        {
            std::cerr << "WebView: Failed to encode image for paste: " << error.what() << std::endl;
            return;
        }

        auto const base64 = Glib::Base64::encode(std::string(buffer, bufferSize));
        g_free(buffer);

        // Reconstruct the PNG as a File inside a DataTransfer and dispatch a synthetic paste event
        // on the focused composer, which is what WhatsApp listens for to open its media preview.
        // Some WebKit builds leave a constructed ClipboardEvent's clipboardData null, so force it.
        auto script = std::string{};
        script.append("(function(){var b64=\"");
        script.append(base64);
        script.append("\";var bin=atob(b64);var n=bin.length;var bytes=new Uint8Array(n);"
                      "for(var i=0;i<n;i++)bytes[i]=bin.charCodeAt(i);"
                      "var file=new File([new Blob([bytes],{type:'image/png'})],'image.png',{type:'image/png'});"
                      "var dt=new DataTransfer();dt.items.add(file);"
                      "var t=document.activeElement||document.body;"
                      "var ev=new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true});"
                      "try{Object.defineProperty(ev,'clipboardData',{value:dt});}catch(e){}"
                      "t.dispatchEvent(ev);})();");

        webkit_web_view_evaluate_javascript(*this, script.c_str(), -1, nullptr, nullptr, nullptr, nullptr, nullptr);
    }

    void WebView::zoomIn()
    {
        if (auto zoomLevel = webkit_web_view_get_zoom_level(*this); zoomLevel < 2.0)
        {
            zoomLevel += 0.05;
            webkit_web_view_set_zoom_level(*this, zoomLevel);
            util::Settings::getInstance().setValue("general", "zoom-level", zoomLevel);
        }
    }

    void WebView::zoomOut()
    {
        if (auto zoomLevel = webkit_web_view_get_zoom_level(*this); zoomLevel > 0.5)
        {
            zoomLevel -= 0.05;
            webkit_web_view_set_zoom_level(*this, zoomLevel);
            util::Settings::getInstance().setValue("general", "zoom-level", zoomLevel);
        }
    }

    void WebView::resetZoom()
    {
        auto const defaultLevel = 1.0;
        webkit_web_view_set_zoom_level(*this, defaultLevel);
        util::Settings::getInstance().setValue("general", "zoom-level", defaultLevel);
    }


    double WebView::getZoomLevel()
    {
        return webkit_web_view_get_zoom_level(*this);
    }

    std::string WebView::getZoomLevelString()
    {
        return std::to_string(static_cast<int>(std::round(getZoomLevel() * 100))).append("%");
    }

    void WebView::setMinFontSize(unsigned int fontSize)
    {
        auto const settings = webkit_web_view_get_settings(*this);
        webkit_settings_set_minimum_font_size(settings, fontSize);
    }

    sigc::signal<void, WebKitLoadEvent>& WebView::signalLoadStatus() noexcept
    {
        return m_signalLoadStatus;
    }

    sigc::signal<void, bool>& WebView::signalNotification() noexcept
    {
        return m_signalNotification;
    }

    sigc::signal<void>& WebView::signalNotificationClicked() noexcept
    {
        return m_signalNotificationClicked;
    }

    void WebView::onLoadStatusChanged(WebKitLoadEvent loadEvent)
    {
        m_loadStatus = loadEvent;

        if (loadEvent == WEBKIT_LOAD_FINISHED)
        {
            // Re-seed the composer behavior flag on every (re)load from the saved preference.
            setCtrlEnterSend(util::Settings::getInstance().getValue<bool>("general", "ctrl-enter-send", false));
        }

        m_signalLoadStatus.emit(m_loadStatus);
    }

    void WebView::onWebProcessTerminated(WebKitWebProcessTerminationReason reason)
    {
        if (reason == WEBKIT_WEB_PROCESS_TERMINATED_BY_API)
        {
            // We terminated it on purpose (e.g. the unresponsive-reload path or shutdown).
            return;
        }

        char const* const reasonText = (reason == WEBKIT_WEB_PROCESS_EXCEEDED_MEMORY_LIMIT) ? "exceeded memory limit" : "crashed";
        std::cerr << "WebView: Web process " << reasonText << "; recovering" << std::endl;

        // Crash-loop guard: if the web process keeps dying in quick succession, back off so we
        // don't busy-reload a permanently broken page.
        auto const now = g_get_monotonic_time();
        if (now - m_lastCrashTime < 10 * G_USEC_PER_SEC)
        {
            ++m_crashCount;
        }
        else
        {
            m_crashCount = 1;
        }
        m_lastCrashTime = now;

        auto const delayMs = (m_crashCount > 3) ? 30000U : 1500U;
        Glib::signal_timeout().connect_once([this] { webkit_web_view_reload(*this); }, delayMs);
    }

    bool WebView::onTimeout()
    {
        auto const responsive = webkit_web_view_get_is_web_process_responsive(*this);
        // Give a second chance to WebView for recovering itself by checking if it stopped responding before
        if (!responsive && m_stoppedResponding)
        {
            auto dialog = Gtk::MessageDialog{_("Unresponsive"), false, Gtk::MESSAGE_QUESTION, Gtk::BUTTONS_YES_NO, true};
            dialog.set_secondary_text(_("The application is not responding. Would you like to reload?"));

            auto const result = dialog.run();
            switch (result)
            {
                case Gtk::RESPONSE_YES:
                    webkit_web_view_terminate_web_process(*this);
                    webkit_web_view_reload(*this);
                    break;
                case Gtk::RESPONSE_NO:
                default:
                    break;
            }
        }
        m_stoppedResponding = !responsive;

        return true;
    }

    void WebView::applyCustomCss(const std::string& cssFilePath)
    {
        addStyleSheet(loadCssContent(cssFilePath));
    }

    void WebView::injectCrashRecoveryScript()
    {
        // WhatsApp Web's JS can crash inside an otherwise healthy web process and show its own
        // error screen ("We encountered a problem running WhatsApp. Please reload..."). The native
        // web-process-terminated handler never fires for that, so recover from the page side: poll
        // for the phrase and reload. A sessionStorage budget (3 reloads / 60s) mirrors the native
        // crash-loop backoff so a permanently broken page doesn't busy-reload. Keys on the English
        // phrase, which is the pragmatic signal for the reported case.
        static char const* const source = R"JS(
        (function() {
            var PHRASE = "We encountered a problem running WhatsApp";
            var KEY = "wil_crash_reloads";
            function recent() {
                try {
                    var now = Date.now();
                    return JSON.parse(sessionStorage.getItem(KEY) || "[]")
                        .filter(function(t) { return now - t < 60000; });
                } catch (e) { return []; }
            }
            setInterval(function() {
                // textContent, not innerText: innerText forces a full synchronous reflow every
                // tick (it returns *rendered* text), which stutters WhatsApp's large DOM. textContent
                // just walks nodes and still contains the crash phrase.
                if (!document.body || document.body.textContent.indexOf(PHRASE) === -1) return;
                var times = recent();
                if (times.length >= 3) return;
                times.push(Date.now());
                try { sessionStorage.setItem(KEY, JSON.stringify(times)); } catch (e) {}
                location.reload();
            }, 3000);
        })();
        )JS";

        auto* const script  = webkit_user_script_new(source, WEBKIT_USER_CONTENT_INJECT_TOP_FRAME, WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_END, nullptr, nullptr);
        auto* const manager = webkit_web_view_get_user_content_manager(*this);
        webkit_user_content_manager_add_script(manager, script);
        webkit_user_script_unref(script);
    }

    void WebView::injectCtrlEnterSendScript()
    {
        // Optional Telegram-style composer behavior: Enter inserts a newline, Ctrl+Enter sends.
        // Off unless window.__wilCtrlEnterSend is set (seeded from the preference on every load,
        // see onLoadStatusChanged, and updated live by setCtrlEnterSend). We remap by replaying a
        // trusted-looking Enter: Shift+Enter for a newline, plain Enter to send. The handler ignores
        // synthetic (untrusted) events so it never recurses. Depends on WhatsApp's composer
        // internals, so it is the most fragile feature and stays opt-in.
        static char const* const source = R"JS(
        (function() {
            document.addEventListener('keydown', function(e) {
                if (!window.__wilCtrlEnterSend || !e.isTrusted || e.key !== 'Enter') return;
                var t = e.target;
                if (!t || !t.isContentEditable) return;
                e.preventDefault();
                e.stopPropagation();
                var send = e.ctrlKey || e.metaKey;
                t.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
                    bubbles: true, cancelable: true, shiftKey: !send
                }));
            }, true);
        })();
        )JS";

        auto* const script  = webkit_user_script_new(source, WEBKIT_USER_CONTENT_INJECT_TOP_FRAME, WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_END, nullptr, nullptr);
        auto* const manager = webkit_web_view_get_user_content_manager(*this);
        webkit_user_content_manager_add_script(manager, script);
        webkit_user_script_unref(script);
    }

    void WebView::setCtrlEnterSend(bool enabled)
    {
        auto const script = std::string{"window.__wilCtrlEnterSend = "} + (enabled ? "true" : "false") + ";";
        webkit_web_view_evaluate_javascript(*this, script.c_str(), -1, nullptr, nullptr, nullptr, nullptr, nullptr);
    }

    void WebView::addStyleSheet(std::string const& css)
    {
        if (css.empty())
        {
            return;
        }

        auto* styleSheet = webkit_user_style_sheet_new(css.c_str(), WEBKIT_USER_CONTENT_INJECT_ALL_FRAMES, WEBKIT_USER_STYLE_LEVEL_USER, nullptr, nullptr);

        auto* manager = webkit_web_view_get_user_content_manager(*this);
        webkit_user_content_manager_add_style_sheet(manager, styleSheet);
    }

    void WebView::setTheme(int index)
    {
        auto* manager = webkit_web_view_get_user_content_manager(*this);
        webkit_user_content_manager_remove_all_style_sheets(manager);

        auto const cssFilePath = Glib::get_user_config_dir() + "/" + WIL_NAME + "/web.css";
        if (cssFileExists(cssFilePath))
        {
            applyCustomCss(cssFilePath);
        }

        addStyleSheet(themeCss(index));
    }
}
