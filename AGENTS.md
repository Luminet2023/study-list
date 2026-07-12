# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

## Locked product direction

- Recreate the selected third concept: warm rice paper, pale watercolor branches, oversized date, centered blessing, and a fine vertical study path.
- The app is mobile-first at 390 x 844 and must remain usable at 360 and 430 CSS pixels without horizontal scrolling.
- Use Vue 3 + Vuetify 3 with the `md3` blueprint. Prefer Vuetify components, including Labs `VStepperVertical`, stable `VSnackbarQueue`, and `VFadeTransition`.
- Do not use `VSnackbar`; user feedback belongs in the queue component.
- The campaign is fixed to 2026-07-13 through 2026-08-29. All user content and interaction state are persisted locally.
- Sites is the selected deployment target. The first release is client-first; no server is required for the local-only data contract.
