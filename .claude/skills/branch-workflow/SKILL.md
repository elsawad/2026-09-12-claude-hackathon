---
name: branch-workflow
description: Git branching and PR workflow for this repo — every developer works on their own branch, cut from main, one branch per feature, merged back via a pull request to main. Use before starting new work, when switching to a different feature or task, or when about to commit/push changes.
---

# Branching workflow

This repo does not take direct commits to `main`. All work happens on a
feature branch, then comes back via a pull request.

## Rule

**Never commit directly to `main`.** If you're about to make non-trivial
edits and you're currently on `main`, stop and cut a branch first.

## Starting a new feature

```bash
git checkout main
git pull
git checkout -b <branch-name>
```

Pick a short, descriptive kebab-case branch name for the feature or fix,
e.g. `resident-map-pins`, `officer-console-filters`, `fix-exif-fallback`.

## While working

Commit normally on the branch. Keep commits scoped to the one feature the
branch is for.

## Pushing and opening a PR

```bash
git push -u origin <branch-name>
gh pr create --base main --title "<short title>" --body "<summary + test plan>"
```

## Switching to a different feature

Don't keep piling unrelated work onto an existing branch. When you move on
to a new feature or task, go back to `main`, pull, and cut a fresh branch
from there — same steps as "Starting a new feature" above.

## Don't over-branch

One branch per feature/task, not one per commit or per tiny tweak. Reuse
the current branch for follow-up commits on the *same* feature. Delete
branches once their PR has merged so they don't pile up:

```bash
git branch -d <branch-name>
git push origin --delete <branch-name>
```
