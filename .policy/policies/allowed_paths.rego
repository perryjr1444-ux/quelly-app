package policies.allowed_paths

# Deny changes outside approved directories.

allowed_prefixes := [
	"apps/",
	"docs/",
	"tests/",
	"reports/",
	"ai/context/",
	".github/",
	".policy/",
]

deny[msg] {
	input.changed_files
	some i
	file := input.changed_files[i]
	not is_allowed(file)
	msg := sprintf("File not in allowed paths: %s", [file])
}

is_allowed(file) {
	some i
	startswith(file, allowed_prefixes[i])
}