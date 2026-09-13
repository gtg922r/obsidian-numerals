# Private evaluation scopes

`src/evaluation/session.ts` owns binding lifetime for one complete source,
metadata and mathjs runtime generation. It does not parse or evaluate
expressions. The existing mathjs compiler and reference adapter remain the
evaluation path.

An `EvaluationSession` starts with already-detached dollar metadata bindings.
Each `createEnvironment` call receives already-detached ordinary seeds and a
defining-calculation reference table. The session copies these binding tables;
it does not clone their values. Dollar seeds must be provided once at session
construction, or evaluated as declarations in an owning environment. They are
not reapplied when another calculation is created. Metadata function
declarations must be evaluated afresh in the new generation, never copied as
JavaScript functions from a cache.

Each environment has a stable Map-compatible `scope`. Ordinary names route to
that environment's local frame. Dollar names route to the session's global
frame. Compose the scope with D's `createReferenceScope` and the environment's
`bindings`; never replace a shared reference table between calculations. A
mathjs function then keeps its defining ordinary scope and references while
reading the latest preceding successful dollar assignments.

For example, a definition `$rate=2; local=10; $f(x)=local+x*$rate` gives 14 for
a later `$f(2)`. A different block's `local=999; $rate=3` changes that call to
16. A subsequent successful `local=20` in the original block changes it to 26.
Aliases, nested function factories, recursion and callbacks keep native
mathjs function and object identity within the generation.

Start each source row or inline expression with `beginRow(environment)` and
synchronously commit on successful mathematical evaluation, or discard on
failure. Do not await or start another row while a transaction is active. All
scope bindings written by called functions participate in the active row,
including ordinary locals in other defining environments. A discard removes
new bindings and restores replaced/deleted bindings. Native heap values are
not cloned. The row evaluator owns block termination, previous/total chains,
result detachment and diagnostic source mapping; session primitives alone do
not implement those policies. A later presentation error must not discard
an already successful row.

The Map adapter implements `get`, `has`, `set`, `delete`, `clear`, `size`,
iteration and `forEach` from these same frames. Enumeration visits current
global bindings and then current local bindings. Iterators capture the key
list when iteration begins and read values through the guarded scope.
Deletion/reinsertion order is preserved within each frame. `clear` stages
deletions of this environment's locals and the shared globals; other
environments' ordinary locals remain untouched.

## Private row provenance

Each binding also has a `ValueProvenance`, separate from its value:
`{unverified: readonly string[], ambiguous: boolean}`. An empty identifier list
with `ambiguous: false` is eligible provenance. It does not by itself authorize
insertion: source generation, editor identity, expected text and all other
proposal checks still apply.

Pass dollar-seed provenance in the constructor's third argument, as
`{seeds: new Map(...)}`; pass ordinary seed provenance as the fourth argument
to `createEnvironment`. Seed identifiers name the relevant unverified
metadata/dependency inputs. Merely having a pending Dataview projection does
not contaminate an independent constant. The caller must label each actual
unverified seed and reference rather than leaving it at the verified default.

An active transaction collects provenance on `scope.get` across every
defining environment reached by called functions. Existence/key checks and
`copyBindings`/`copyGlobals` do not count as value reads. D's reference adapter
must invoke `session.recordInput(provenance, clonedValue)` when its `get`
actually lends a reference value, retaining the defining reference context.

Successful ordinary assignments inherit the union of all reads in their
source row. This is intentionally a row-level union, including multi-statement
rows, rather than instruction-by-instruction symbolic taint analysis. A later
independent scalar overwrite replaces the binding's old provenance. Discard
rolls back staged binding provenance together with staged bindings.

Call `transaction.commit(rawResult)` so functions or collections returned
without an exported assignment also retain their row provenance. The
transaction's `provenance` remains readable after commit/discard for recording.
The session maintains private identity provenance for native closures and
collections. A factory that captures an unverified argument retains that
provenance when called later, even if it does not perform a free-variable read.
A normal free-dollar lookup still reads its defining scope's current binding.

Use `session.borrow(environment, '__prev', detachedValue, provenance)` and
the analogous `__total` call inside a row for previous/total helpers. Borrowing
does not count as a mathematical read. Its explicit provenance persists at
commit and is added to the row only when the expression actually reads the
helper. The binding may therefore be unverified while a row that ignores it
remains eligible.

The collector is conservative where native mutation can bypass `scope.set`.
If uncertain input reads coincide with a callable/collection read, all known
opaque identities become ambiguous, including on row failure. This catches
sibling closures that share captured mutable storage. It may also make an
otherwise pure existing function ambiguous after an uncertain call; rebuilding
the function in a fresh generation restores a clean identity. The scope layer
does not globally disable independent primitive bindings. The evaluator also
tracks engine effects, described below; an uncertain opaque call may affect
even later literal arithmetic through numeric configuration. No values are
cloned, replayed or changed by provenance tracking.

`SessionProvenanceOptions.isOpaqueValue` defaults to treating every object or
function as opaque. A runtime may narrow it only with evidence of immutable
storage and APIs; a numeric type name does not establish immutability. The
optional `children` hook supplies child values through public native APIs,
such as `Matrix.forEach`, without cloning them. Arrays and plain objects are
walked through data-property descriptors automatically. This catches an old
invalidated closure nested in a newly copied previous-result wrapper. If a
borrowed opaque wrapper cannot be traversed after an uncertain opaque effect,
its provenance is conservatively ambiguous. Cycles are bounded, and inspection
does not invoke object accessors.

The scope layer cannot discover engine-only effects or nested evaluation
inside native functions. The evaluator must call `recordOpaqueEffect()` for
recognized operations such as `createUnit`, `import` or `evaluate`, and account
for later registry-dependent reads when those effects could matter. This hook
marks the current row and known opaque identities ambiguous; it is not an
engine sandbox, symbolic interpreter or proof that unobserved runtime effects
were tracked. These hooks and identity tables remain evaluator-private.

`copyBindings` and `copyGlobals` are evaluator-only table copies, including
staged bindings during an active row. Their values retain private live
identity. They are not snapshot APIs, and neither environments nor these Maps
may be given to presentation or host adapters. The boundary owner retains
typed result copies privately for the trusted formatter and exposes plain
data descriptions or formatted strings. Executable functions, including
nested ones, never cross the public result or symbol boundary.

Calling `retire` discards an active transaction, clears the owned frames and
guards all later scope accesses. Old transaction handles and foreign
environments are rejected. A new source generation starts with fresh frames
and newly evaluated declarations, so deleted globals and functions disappear.

## Runtime safety across source generations

`runtimeProvenance.ts` keeps a WeakMap keyed by the actual mathjs engine. Its
entries contain only provenance flags/labels and a monotonic safety epoch;
no values, scopes, closures or source text survive there. Re-evaluating or
changing the source, metadata or note identity does not clear these flags.
Only a new engine starts with clean safety state. Diagnostics explain that
reloading Numerals or replacing its runtime is required to clear it.

The driver observes every metadata and source row before evaluation, including
preprocessed metadata declarations, and records possible effects after either
commit or discard. Numeric `config`, `import`, dynamic evaluation/compilation,
parser calls, public `typed` registry mutations, and ambiguous opaque calls or accessor mutations may change
the engine broadly. Later arithmetic, including `1/3`, inherits that state.
The tracker does not change execution, suppress collisions or reset the engine.

A deliberately narrow check of the public mathjs AST recognizes one unshadowed
`createUnit` call with literal or currently primitive arguments and no nested
or other calls. That case changes only registry provenance: subsequent literal
arithmetic can remain eligible, while unresolved engine/unit reads inherit
the registry uncertainty. Object/options arguments, aliases and unknown
callbacks are conservatively broad. Classification parses the normalized input
with the owning mathjs engine and walks its public nodes; it never evaluates or
replays the tree. Mathjs therefore determines callable syntax, including names
outside the extension scanner's alphabet. Authoritative parse rejection executes
no AST and preserves prior safety without creating a new runtime effect.

Passive symbol reads and alias captures do not establish an engine effect.
Neither does an ordinary whole function declaration: its body is deferred.
Engine capabilities captured in aliases or declarations receive private
binding/identity ambiguity so actual later invocation can mark the runtime.
Unused unverified metadata, direct reads of unverified Units, and unused
engine-capable declarations do not by themselves disable unrelated constants.
Assignment targets are not reads. Existing scalar bindings, function names and
parameters shadow builtin spellings such as `config`; actual bound engine
function identities remain capabilities under aliases. Conditional branches do
not establish bindings in their siblings.

The `typed` registry mutators `clear`, `clearConversions`, `addType`, `addTypes`,
`addConversion`, `addConversions` and `removeConversion` are native engine
capabilities, including aliases and deferred captures. Mutating them advances
the broad runtime epoch even when the current source inputs are verified;
later results and proposals from earlier notes must respect that changed epoch.
A known native `typed.convert` call with exactly two statically primitive
arguments does not itself advance the epoch, including through parentheses or
a captured namespace/function alias. Alias bindings retain their conservative
provenance, but this proved read-only call does not poison later independent
arithmetic. Object inputs, dynamic arguments and nested calls remain conservative;
this classification never clears uncertainty from earlier runtime effects.

Reference/legacy metadata can execute before F owns an active row. Both
`getScopeFromFrontmatter` and `evaluateMetadataValue` use
`evaluateRuntimeMetadata` at that boundary: it observes before evaluation and
records possible effects in `finally`, even when a field fails or its resulting
reference value is rejected. External metadata is never certified as current
source by this helper. F explicitly uses `runtimeSafety: 'caller'` while its
active session records the exact native/Dataview provenance; this avoids double
counting and preserves the source trust distinction. No function or populated
reference scope is retained by the runtime safety store.

Each recorded row includes `insertion.runtimeSafetyEpoch`. G must compare it
with `isRuntimeSafetyCurrent(engine, epoch)` using the originating engine when
applying a proposal, in addition to checking that row's eligibility and all
source/editor/generation guards. An effect later in the same note or in another
session invalidates earlier row epochs. A snapshot-wide final epoch would miss
that ordering. Possible effects advance the epoch; ordinary rows merely
reading already-uncertain state do not.

## Explicit transaction limits

Rollback covers scope bindings. Native object/accessor mutations, opaque
captured arguments and runtime side effects such as `createUnit` may remain
after a failed row. The tests retain positive evidence of these limitations:

- `$object.v=2; $binding=2; missing` restores the prior `$binding`, while the
  native object's `v` remains 2.
- After `maker(a)=inner(x)=(a.v=a.v+x); $inc=maker({v:1})`, failed
  `$inc(2)+missing` leaves `$inc(0)` returning 3.
- `createUnit("failedrowunit", "2 m"); missing` leaves the new unit
  registered, and a subsequent declaration still reports its collision.

Detaching external inputs and recorded results protects those boundaries; it
does not roll back the private native heap. A scope retirement guard also
cannot revoke a leaked function that only accesses captured arguments.
Generation safety therefore relies on private ownership and never exposing
executable functions through snapshots. Exact rollback of these advanced
effects requires a separate semantics decision.
