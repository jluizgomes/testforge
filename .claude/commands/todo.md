Find and list all TODO, FIXME, HACK, XXX, and NOTE comments in the TestForge codebase.

Arguments: $ARGUMENTS — optional: `frontend`, `backend`, a keyword like `fixme`, or a file path to scope the search.

**Search frontend** (TypeScript/TSX):
```bash
grep -rn --include="*.ts" --include="*.tsx" \
  -E "(TODO|FIXME|HACK|XXX|NOTE|BUG|TEMP|REFACTOR)(\(.*\))?:" \
  /Users/jluizgomes/Documents/Projetos/testforge/src/ \
  /Users/jluizgomes/Documents/Projetos/testforge/electron/ \
  2>/dev/null
```

**Search backend** (Python):
```bash
grep -rn --include="*.py" \
  -E "(TODO|FIXME|HACK|XXX|NOTE|BUG|TEMP|REFACTOR)(\(.*\))?:" \
  /Users/jluizgomes/Documents/Projetos/testforge/backend/app/ \
  2>/dev/null
```

**Format output grouped by priority**:

```
🔴 FIXME (must fix before release):
  backend/app/core/engine.py:142        — "FIXME: handle timeout edge case"
  src/features/test-runner/...tsx:67    — "FIXME: race condition on cancel"

🟡 TODO (planned improvements):
  src/services/api-client.ts:23         — "TODO: add request retry logic"
  backend/app/api/v1/reports.py:88      — "TODO: cache report generation"
  ...

⚪ NOTE / HACK:
  backend/app/core/engine.py:55         — "HACK: workaround for playwright stdio"
  ...

Total: 3 FIXME · 8 TODO · 2 HACK · 1 NOTE
```

**Also check for**:
- `console.log` / `print()` statements that should be removed from production code
- Hardcoded values that look like they should be config (e.g., `http://localhost`, magic numbers)

```bash
grep -rn --include="*.ts" --include="*.tsx" "console\.log" src/ 2>/dev/null | grep -v "test\|spec\|\.test\." | head -20
```

If `$ARGUMENTS` is a specific keyword, filter to just that type.
