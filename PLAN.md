# Package Finder Roadmap

## Problem
Capture and prioritize future improvements so UX, navigation, and search behavior evolve in a coherent order.

## Proposed approach
Implement foundational state/UX improvements first (URL state + filter UX), then layer discoverability and interaction enhancements, and finally evaluate broader UI system changes.

## Todos
1. **Use nuqs for URL-based state of filters and search**
   - Make search/filter state shareable via URL.
   - Preserve state on refresh and navigation.
2. **Create a more compact filter menu + matching package manager icons**
   - Reduce visual space and improve scanability.
   - Standardize icon mapping per manager.
3. **Make package results clickable to open matching package-manager pages**
   - Link each result to the canonical package detail page.
4. **Add filtering for other kinds of packages served by Nix**
   - Depends on filter menu redesign.
   - Allow include/exclude by package kind.
5. **Add Cmd+K to focus the search bar**
   - Global shortcut for quick access.
6. **(Maybe) evaluate shadcn/ui for a more streamlined, polished UI**
   - Run as an explicit evaluation task before broad migration.
7. **Adjust `/` page behavior**
   - Initial state: centered search input only.
   - With query present: move search to top and show result UI.

## Notes
- Recommended order: 1 -> 2 -> 4, with 3/5/7 in parallel where practical.
- Keep shadcn/ui optional until design direction is validated.
