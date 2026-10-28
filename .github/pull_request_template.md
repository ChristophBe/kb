Closes #

## What changed

## Checklist
- [ ] `task gen` run and generated code committed (protos, `module.yaml`, SQL)
- [ ] `task lint` and `task test` pass
- [ ] Proto changes are backwards compatible, or the breaking change is explained above
- [ ] ADR needed? (new module, new infrastructure, cross-module contract, deviation from the module architecture; see CONTRIBUTING.md) — added in `docs/adr/`, or not needed

### UI changes ([UX standards](https://github.com/ChristophBe/kb/blob/main/docs/ux-standards.md); delete if the PR has no UI)
- [ ] Keyboard-only walkthrough: every flow works, focus is visible and lands in a sensible place
- [ ] Screen-reader smoke test (VoiceOver or NVDA): names, roles and status announcements
- [ ] 200 % zoom and 320 px width: no overlap, no horizontal scrolling
- [ ] Dark mode checked; only design tokens, no raw palette classes
