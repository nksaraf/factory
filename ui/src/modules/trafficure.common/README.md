# trafficure.common

Shared utilities and components used across other trafficure modules.

## Status

This module is in early stages. It contains placeholder files establishing the directory structure for future shared code.

## Structure

```
trafficure.common/
├── components/    # Shared UI components
│   └── test.tsx   # Placeholder
├── data/          # Shared data hooks
│   └── test.ts    # Placeholder
└── utils/         # Shared utility functions
    └── test.ts    # Placeholder
```

## When to Use This Module

Put code here when it is:
- Used by 2+ other trafficure modules (core, analytics, reports)
- Not specific to any single module's domain
- Pure utilities or generic UI components

If code is only used by one module, keep it in that module's own `utils/` or `components/` directory.
