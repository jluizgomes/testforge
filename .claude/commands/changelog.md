Generate a formatted changelog from recent git commits.

Arguments: $ARGUMENTS — optional: a version tag, number of commits, or date range, e.g. `v1.0.0`, `20`, `2026-02-01..HEAD`.

**Fetch commits**:
```bash
# Default: last 30 commits
git -C /Users/jluizgomes/Documents/Projetos/testforge log --oneline --no-merges -30 2>&1

# From a tag:
git -C /Users/jluizgomes/Documents/Projetos/testforge log v{tag}..HEAD --oneline --no-merges 2>&1

# Full format for grouping:
git -C /Users/jluizgomes/Documents/Projetos/testforge log --pretty=format:"%h|%s|%ad" --date=short --no-merges -30 2>&1
```

**Parse and group commits by conventional commit prefix**:

| Prefix | Category |
|--------|----------|
| `feat:` | ✨ New Features |
| `fix:` | 🐛 Bug Fixes |
| `security:` | 🔒 Security |
| `perf:` | ⚡ Performance |
| `refactor:` | ♻️ Refactoring |
| `test:` | 🧪 Tests |
| `docs:` | 📝 Documentation |
| `ci:` | 🔧 CI/CD |
| `remove:` / `chore:` | 🗑️ Removed / Maintenance |

**Output format** (Markdown):

```markdown
## Changelog — {date range}

### ✨ New Features
- Add browser field to project config for Playwright test runner (#abc1234)
- Dashboard now aggregates stats across all projects (#abc1235)

### 🐛 Bug Fixes
- Fix snake_case field mapping in ProjectDetail config (#abc1236)

### 🔒 Security
- Remove authentication system (app is local-only) (#abc1237)

### 🧪 Tests
- Add 24 security tests + fix bcrypt compatibility (#abc1238)
```

If `$ARGUMENTS` is a version number, suggest this format for the tag:
```bash
git tag -a v{version} -m "Release v{version}"
```

Ask the user if they want to save the changelog to `CHANGELOG.md`.
