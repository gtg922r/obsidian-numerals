# Recovery work ledger

Owner task: Assess Numerals project health (01a09705-0041-70e2-a53c-82af27d22571).

Publication ceiling: BRAT prereleases only. Integration: chore/recovery-1.11. Stable: 1.10.2.

| Package | Status | Task / PR | Base and evidence |
| --- | --- | --- | --- |
| A | Complete; live checkout deliberately retained | Owner + independent local_work audit | Seven original worktrees inventoried; two dirty payloads restored and hash verified; 133 refs archived. Five inactive historical worktrees and 25 obsolete local branch refs retired after fresh ownership/hash checks; one historical checkout already absent. FR-custom-units, tags, snapshots, remote refs and new work remain. |
| B | Implementing | Task `01a09b76-5467-7012-b297-f427c08129ff`; PR pending | Base `90a70e4`; CI and prerelease tooling |
| C | Queued | Pending | Host lifecycle |
| D | Implementing | Task `01a09b76-5426-7901-b25b-b1228dd9aa8b`; PR pending | Base `90a70e4`; input and typed references |
| E | Queued | Pending | 1.13 settings and currency lifecycle |
| F | Blocked on D/E | Pending | Ordered note evaluation |
| G | Blocked on C-F | Pending | Surface integration and source safety |
| H | Backlog reconciliation started; UX queued | Owner + triage agent | Superseded PRs #157/#158/#167/#168 closed with links to merged #165/#166 and explicit stable/BRAT distinction. Issue closures pending evidence. |
| I | Blocked on implementation | Pending | BRAT validation/publication |

Stable guard at start: master 3f1ea98b8cca557cc8aa522e30f3c6976a044346; manifest blob a8f7f565d79833c333f77f4acfc3e540a8c69b14; versions blob 51aa485d3ba838dcef42ab89206b36d4e2e07136. Release 1.10.2 is stable/latest. No existing tag or release may change.
