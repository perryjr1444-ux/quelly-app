package policies.npm_pinning

# Disallow common range specifiers and unpinned tags

deny[msg] {
	input.dependencies
	some name
	v := input.dependencies[name]
	re_match("^(\\^|~)|\\*|latest|^workspace:|^file:|^link:", v)
	msg := sprintf("Disallowed dependency range in dependencies: %s => %s", [name, v])
}

deny[msg] {
	input.devDependencies
	some name
	v := input.devDependencies[name]
	re_match("^(\\^|~)|\\*|latest|^workspace:|^file:|^link:", v)
	msg := sprintf("Disallowed dependency range in devDependencies: %s => %s", [name, v])
}

deny[msg] {
	input.optionalDependencies
	some name
	v := input.optionalDependencies[name]
	re_match("^(\\^|~)|\\*|latest|^workspace:|^file:|^link:", v)
	msg := sprintf("Disallowed dependency range in optionalDependencies: %s => %s", [name, v])
}

deny[msg] {
	input.peerDependencies
	some name
	v := input.peerDependencies[name]
	re_match("^(\\^|~)|\\*|latest|^workspace:|^file:|^link:", v)
	msg := sprintf("Disallowed dependency range in peerDependencies: %s => %s", [name, v])
}

# Require exact versions or commit-pinned git deps

deny[msg] {
	input.dependencies
	some name
	v := input.dependencies[name]
	not is_pinned_version(v)
	msg := sprintf("Unpinned dependency in dependencies: %s => %s", [name, v])
}

deny[msg] {
	input.devDependencies
	some name
	v := input.devDependencies[name]
	not is_pinned_version(v)
	msg := sprintf("Unpinned dependency in devDependencies: %s => %s", [name, v])
}

deny[msg] {
	input.optionalDependencies
	some name
	v := input.optionalDependencies[name]
	not is_pinned_version(v)
	msg := sprintf("Unpinned dependency in optionalDependencies: %s => %s", [name, v])
}

deny[msg] {
	input.peerDependencies
	some name
	v := input.peerDependencies[name]
	not is_pinned_version(v)
	msg := sprintf("Unpinned dependency in peerDependencies: %s => %s", [name, v])
}

is_pinned_version(v) {
	is_exact_semver(v)
}

is_pinned_version(v) {
	is_git_commit_pinned(v)
}

is_exact_semver(v) {
	re_match("^[0-9]+\\.[0-9]+\\.[0-9]+(?:-[0-9A-Za-z.-]+)?$", v)
}

is_git_commit_pinned(v) {
	contains(v, "#")
	ref := split(v, "#")[1]
	re_match("^[a-f0-9]{7,40}$", ref)
}