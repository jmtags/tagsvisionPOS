# Working in this repository

## Standing instruction: commit and push completed code changes

The user wants every completed code-change task committed and pushed automatically. Do not wait for another push request or ask for redundant confirmation. A later user instruction to keep changes local overrides this preference.

Use the `git-auto-push` skill when available. Review the task's diff, run appropriate checks, stage only intended source/tests/migrations/documentation, commit, and push the current work branch to its intended upstream. Reuse validation already completed for the same final source changes.

The intended remote is `https://github.com/jmtags/tagsvisionPOS.git` (`origin`); the default branch is `main`. Preserve the current task's branch and existing remote history. Never force-push or discard unrelated work.

Keep `.env` files, credentials, dependency directories, builds, logs, and test artifacts out of commits. If validation or pushing is blocked, preserve the work and report the specific blocker. Confirm the remote accepted the push and report the branch/commit and any remaining local changes in the final response.
