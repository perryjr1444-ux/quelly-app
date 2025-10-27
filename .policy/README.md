# Policy as Code

Policies enforced by Conftest/OPA during CI.

- Allowed paths only: restrict file changes to safe directories
- GitHub Actions pinning: require commit-SHA pins for all actions
- NPM dependency pinning: disallow version ranges like ^, ~, *, latest

Run locally:

```
conftest test policy_input.json -p .policy/policies
conftest test .github/workflows -p .policy/policies
conftest test package.json -p .policy/policies
```

Generate policy_input.json (changed files) against a base ref:

```
BASE=origin/main
git fetch --depth=0 origin
git diff --name-only "$BASE" HEAD | jq -R -s -c 'split("\n")[:-1]' | jq '{changed_files: .}' > policy_input.json
```