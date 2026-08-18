---
name: External router mount order
description: Express registration-order principle for the external API router vs internal generic matchers
---

**Rule:** Mount the external API router before any internal generic parameterized matcher whose pattern could also match external paths.

**Why:** Express matches routes in registration order; a generic `/api/:param/...` matcher registered earlier silently captures requests intended for a later-mounted, more specific router, producing wrong shapes/statuses with no error.

**How to apply:** When adding externally-facing routes, confirm the external mount precedes internal generic matchers; when adding internal generic matchers, validate the path parameter against the known-entity map and 404 unknown values instead of accepting anything.
