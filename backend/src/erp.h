#pragma once
#include <string>
#include "json.hpp"

namespace erp {
bool demoMode();
nlohmann::json publicConfig();
struct Result {
  int status = 503;
  std::string error = "College ERP is unavailable. Please try again later.";
  nlohmann::json profile;
};
Result authenticate(const std::string &email, const std::string &password);
}
