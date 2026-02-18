Open an interactive database shell (psql or redis-cli) for the TestForge development database.

Arguments: $ARGUMENTS — optional: `pg` or `postgres` for PostgreSQL (default), `redis` for Redis, `pgcli` for pgcli if installed.

**Read connection info from environment**:
```bash
cat /Users/jluizgomes/Documents/Projetos/testforge/backend/.env 2>/dev/null | grep -E "DATABASE_URL|REDIS_URL" || echo "No .env found, using defaults"
```

Default values (from `backend/app/core/config.py`):
- PostgreSQL: `postgresql://testforge:testforge@localhost:5432/testforge`
- Redis: `redis://localhost:6379`

**PostgreSQL**:
```bash
# Using psql:
PGPASSWORD=testforge psql -h localhost -p 5432 -U testforge -d testforge

# Using pgcli (nicer, if installed):
pgcli postgresql://testforge:testforge@localhost:5432/testforge

# Via Docker:
docker compose exec core-postgres psql -U testforge -d testforge
```

**Redis**:
```bash
# Local:
redis-cli -h localhost -p 6379

# Via Docker:
docker compose exec core-redis redis-cli
```

**Useful quick queries to show before opening the shell**:
```sql
-- Show table sizes
SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC;
```

```bash
# Redis: show key count and memory
redis-cli info keyspace
redis-cli info memory | grep used_memory_human
```

Print the connection string (masked password) and the shell command before executing, so the user knows what's happening.
