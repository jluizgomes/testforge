Check for outdated dependencies and security vulnerabilities in frontend and backend.

Arguments: $ARGUMENTS — optional: `frontend`, `backend`, `audit` (security only), or empty for full check.

**Frontend**:

Check outdated:
```bash
cd /Users/jluizgomes/Documents/Projetos/testforge
npm outdated 2>&1
```

Security audit:
```bash
npm audit --audit-level=moderate 2>&1
```

**Backend**:

Check outdated (requires pip-review or just pip list):
```bash
cd /Users/jluizgomes/Documents/Projetos/testforge/backend
source .venv/bin/activate 2>/dev/null || true
pip list --outdated 2>&1 | head -30
```

Security audit with pip-audit:
```bash
pip-audit 2>&1 | head -30
# If not installed: pip install pip-audit
```

**Summarise results**:

```
Frontend dependencies:
  Outdated (minor):  3 packages
    @tanstack/react-query  5.17.0  →  5.28.0
    recharts               2.10.4  →  2.12.0
    lucide-react           0.312   →  0.400.0

  Outdated (major):  1 package
    eslint  8.56.0  →  9.0.0  ⚠️ BREAKING CHANGES

  Security:  0 vulnerabilities ✓

Backend dependencies:
  Outdated:  5 packages
    fastapi  0.109.0  →  0.115.0
    ...

  Security:  0 vulnerabilities ✓
```

**Recommendations**:
- Group by major/minor/patch
- Flag major updates as potentially breaking
- For security vulnerabilities: show CVE ID, severity, affected version range, fix version
- Suggest `npm update` for safe minor/patch bumps

Do NOT auto-update anything — only report.
