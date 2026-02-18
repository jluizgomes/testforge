Scaffold a new React component following TestForge frontend conventions.

Arguments: $ARGUMENTS — component name and optional location, e.g. `RunStatusBadge` or `projects/RunStatusBadge`

**Conventions to follow (from existing codebase)**:
- Components live in `src/features/{feature}/components/` or `src/components/ui/` for shared UI
- Use shadcn/ui primitives (`Card`, `Badge`, `Button`, `Dialog`, etc.)
- Props interface named `{Component}Props`
- Named export (not default)
- Lucide icons for all icons
- Tailwind for all styling — no inline styles, no CSS modules
- `cn()` from `@/lib/utils` for conditional class merging
- Use `React.FC` is discouraged — use direct function declaration

**Template to generate**:

```tsx
// src/features/{feature}/components/{ComponentName}.tsx
import { ... } from 'lucide-react'
import { cn } from '@/lib/utils'
// import shadcn/ui components as needed

interface {ComponentName}Props {
  // props here
  className?: string
}

export function {ComponentName}({ ..., className }: {ComponentName}Props) {
  return (
    <div className={cn('', className)}>
      {/* content */}
    </div>
  )
}
```

**If it's a Dialog component**, follow `ScheduleReportDialog.tsx` pattern:
- `open: boolean` + `onClose: () => void` props
- Use shadcn `Dialog`, `DialogContent`, `DialogHeader`, `DialogTitle`, `DialogFooter`

**If it's a data display component**, follow `ProjectsList.tsx` pattern:
- Use `useQuery` for data fetching
- Loading state with `animate-pulse` skeleton
- Empty state with centered icon + message

After generating the file content, also suggest:
1. Where to import it from
2. Any shadcn/ui components needed (`npx shadcn-ui@latest add {component}`)
3. Export it from a barrel file if one exists
