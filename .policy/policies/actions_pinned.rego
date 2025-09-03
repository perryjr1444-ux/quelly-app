package policies.actions_pinned

import future.keywords.in

# Allow explicit exception for bootstrapping or specific workflows.
skip {
	input.x_policy_exception_actions_pinning == true
}

# Deny any workflow step using an action that is not pinned to a 40-char commit SHA.

deny[msg] {
	not skip
	input.jobs
	some job_name
	job := input.jobs[job_name]
	job.steps
	some i
	step := job.steps[i]
	step.uses
	not startswith(step.uses, "./")
	not startswith(step.uses, "docker://")
	not is_pinned(step.uses)
	msg := sprintf("GitHub Action not pinned to a commit SHA: %s", [step.uses])
}

is_pinned(uses) {
	parts := split(uses, "@"); count(parts) == 2
	ref := parts[1]
	re_match("^[a-f0-9]{40}$", ref)
}