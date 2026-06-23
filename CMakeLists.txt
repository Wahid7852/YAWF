cmake_minimum_required(VERSION 3.12)
project(
        yawf
        VERSION 2.0.0
        DESCRIPTION "An unofficial WhatsApp desktop application for Linux"
        HOMEPAGE_URL "https://github.com/Wahid7852/YAWF"
        LANGUAGES C CXX
    )

include(GNUInstallDirs)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(WIL_NAME ${CMAKE_PROJECT_NAME})
set(WIL_FRIENDLY_NAME "YAWF")
set(WIL_DESCRIPTION ${CMAKE_PROJECT_DESCRIPTION})
set(WIL_HOMEPAGE ${CMAKE_PROJECT_HOMEPAGE_URL})
set(WIL_VERSION ${CMAKE_PROJECT_VERSION})
string(TIMESTAMP WIL_BUILD_DATE "%Y-%m-%d")
set(WIL_APP_ID "io.github.wahid7852.YAWF")
set(WIL_ICON ${WIL_APP_ID})
set(GETTEXT_PACKAGE ${WIL_NAME})
set(WIL_LOCALEDIR "${CMAKE_INSTALL_FULL_LOCALEDIR}")

message(STATUS "${CMAKE_PROJECT_NAME} version: ${WIL_VERSION}")

add_subdirectory(src)
add_subdirectory(resource)
add_subdirectory(po)
