# Recovery work ledger

Owner: Numerals recovery coordination.

Publication ceiling: BRAT prereleases only. Integration: chore/recovery-1.11. Stable: 1.10.2.

| Package | Status | Task / PR | Base and evidence |
| --- | --- | --- | --- |
| A | Complete; live checkout deliberately retained | Owner + independent local_work audit | Seven original worktrees inventoried; two dirty payloads restored and hash verified; 133 refs archived. Five inactive historical worktrees and 25 obsolete local branch refs retired after fresh ownership/hash checks; one historical checkout already absent. FR-custom-units, tags, snapshots, remote refs and new work remain. |
| B | Merged | [PR #176](https://github.com/gtg922r/obsidian-numerals/pull/176) | Reviewed `bf13ef4` with two independent approvals; merged `c2e4348` with identical tree. CI green: 536 Jest + 48 toolchain tests. Findings resolved: exact integration-tip validation and private draft uploads by release ID before publication. |
| C | Implementing | Host lifecycle; PR pending | Exact base `e7c7548`; branch `codex/recovery-host-lifecycle`. Owns main, host controllers/events, Reading/Live Preview lifecycle and editor navigation; does not own evaluation/configuration. |
| D | Merged | [PR #177](https://github.com/gtg922r/obsidian-numerals/pull/177) | Reviewed `02ea5b4` with two independent approvals; merged `ae165d9` with identical tree. Hosted CI and full checks pass: 621 Jest, 8 snapshots, 48 toolchain tests. Final findings resolved: reference labels, implicit multiplication grouping, and directives inside insertion wrappers. |
| E | Merged | [PR #178](https://github.com/gtg922r/obsidian-numerals/pull/178) | Reviewed `9d78502` with two independent approvals; merged `e7c7548` with identical tree. Full/hosted checks pass: 782 Jest, 8 snapshots, 49 toolchain including GC. Final findings resolved: ResultSet currency codes, object-key currency symbols and exact BigNumber conversion/flags. Renderer refresh remains C/G; host settings acceptance remains I. |
| F | Integrating ordered evaluator | Note evaluation; PR pending | Independent first phase began at `ae165d9`; explicit integration/configuration ownership released after reviewed E merge `e7c7548`. Owns evaluation/processing/inline evaluator/shared types/package/config and tests. C owns host adapters separately. Source extraction parity still awaits host fixtures. |
| G | Blocked on C-F | Pending | Surface integration and source safety |
| H | Backlog reconciled; UX queued | Owner + independent triage agent | Superseded PRs #157/#158/#167/#168 closed with links to merged #165/#166. Delivered issues #13/#31/#50 closed with stable evidence; #88 consolidated into #44. Remaining 34 issues retained with specific recovery/later-work dispositions. #174 stays open for stable users; #175/#47/#82 are not falsely claimed delivered. |
| I | Fixture preparation complete; acceptance awaits implementation | Host validation and owner-led publication | 95 synthetic fixtures and an extraction recorder prepared. Host extraction and installed-artifact validation remain pending. No candidate published. |

Stable guard at start: master 3f1ea98b8cca557cc8aa522e30f3c6976a044346; manifest blob a8f7f565d79833c333f77f4acfc3e540a8c69b14; versions blob 51aa485d3ba838dcef42ab89206b36d4e2e07136. Release 1.10.2 is stable/latest. No existing tag or release may change.
