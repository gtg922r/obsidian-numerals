# Recovery work ledger

Owner task: Assess Numerals project health (01a09705-0041-70e2-a53c-82af27d22571).

Publication ceiling: BRAT prereleases only. Integration: chore/recovery-1.11. Stable: 1.10.2.

| Package | Status | Task / PR | Base and evidence |
| --- | --- | --- | --- |
| A | Complete; live checkout deliberately retained | Owner + independent local_work audit | Seven original worktrees inventoried; two dirty payloads restored and hash verified; 133 refs archived. Five inactive historical worktrees and 25 obsolete local branch refs retired after fresh ownership/hash checks; one historical checkout already absent. FR-custom-units, tags, snapshots, remote refs and new work remain. |
| B | Merged | Task `01a09b76-5467-7012-b297-f427c08129ff`; [PR #176](https://github.com/gtg922r/obsidian-numerals/pull/176) | Reviewed `bf13ef4` with two independent approvals; merged `c2e4348` with identical tree. CI green: 536 Jest + 48 toolchain tests. Findings resolved: exact integration-tip validation and private draft uploads by release ID before publication. |
| C | Queued | Pending | Host lifecycle |
| D | Merged | Task `01a09b76-5426-7901-b25b-b1228dd9aa8b`; [PR #177](https://github.com/gtg922r/obsidian-numerals/pull/177) | Reviewed `02ea5b4` with two independent approvals; merged `ae165d9` with identical tree. Hosted CI and full checks pass: 621 Jest, 8 snapshots, 48 toolchain tests. Final findings resolved: reference labels, implicit multiplication grouping, and directives inside insertion wrappers. |
| E | Implementing final integration | Task `01a09b99-4631-7e00-9d31-034d1a39c28f`; PR pending | Rebased onto `ae165d9`; owns existing settings/runtime/formatting/main/processing/rendering/configuration/test integration. Cold-load repair, native alias serialization, reserved-code validation and runtime lifetime findings addressed before final review. |
| F | Implementing independent first phase | Task `01a09bc4-aef0-75c1-8a35-a29b6e28bddf`; PR pending | Exact base `ae165d9`; owns only new `src/evaluation/`, new evaluation tests and docs. Existing source/config/package/lock/test integration waits for E's reviewed merge and explicit handoff. |
| G | Blocked on C-F | Pending | Surface integration and source safety |
| H | Backlog reconciled; UX queued | Owner + independent triage agent | Superseded PRs #157/#158/#167/#168 closed with links to merged #165/#166. Delivered issues #13/#31/#50 closed with stable evidence; #88 consolidated into #44. Remaining 34 issues retained with specific recovery/later-work dispositions. #174 stays open for stable users; #175/#47/#82 are not falsely claimed delivered. |
| I | Blocked on implementation | Pending | BRAT validation/publication |

Stable guard at start: master 3f1ea98b8cca557cc8aa522e30f3c6976a044346; manifest blob a8f7f565d79833c333f77f4acfc3e540a8c69b14; versions blob 51aa485d3ba838dcef42ab89206b36d4e2e07136. Release 1.10.2 is stable/latest. No existing tag or release may change.
