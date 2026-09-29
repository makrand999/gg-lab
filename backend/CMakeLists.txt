cmake_minimum_required(VERSION 3.16)
project(educad_backend C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

find_package(Threads REQUIRED)

# Embed schema.sql into a generated header (single source of truth).
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/schema.sql" SCHEMA_SQL)
configure_file("${CMAKE_CURRENT_SOURCE_DIR}/schema.h.in"
               "${CMAKE_CURRENT_BINARY_DIR}/schema.h" @ONLY)

add_library(sqlite3 STATIC third_party/sqlite3.c)
target_include_directories(sqlite3 PUBLIC third_party)
target_compile_definitions(sqlite3 PRIVATE SQLITE_THREADSAFE=1)

add_executable(educad-server src/main.cpp)
target_include_directories(educad-server PRIVATE third_party "${CMAKE_CURRENT_BINARY_DIR}")
target_link_libraries(educad-server PRIVATE sqlite3 sodium Threads::Threads ${CMAKE_DL_LIBS})
target_compile_options(educad-server PRIVATE -Wall -Wextra)

add_executable(educad-seed src/seed.cpp)
target_include_directories(educad-seed PRIVATE third_party "${CMAKE_CURRENT_BINARY_DIR}")
target_link_libraries(educad-seed PRIVATE sqlite3 sodium Threads::Threads ${CMAKE_DL_LIBS})
target_compile_options(educad-seed PRIVATE -Wall -Wextra)
