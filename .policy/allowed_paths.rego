package repo.guardrails

default allow = true

# Allowed path prefixes for agent modifications
allowed_prefixes = [
  "app/",
  "apps/",
  "docs/",
  "tests/",
  "reports/",
  "ai/context/",
  ".github/",
  ".policy/"
]

invalid_files[f] {
  f := input.changed_files[_]
  not startswith(f, allowed_prefixes[_])
}

deny[msg] {
  count(invalid_files) > 0
  msg := sprintf("changes outside allowed paths detected: %v", [invalid_files])
}

