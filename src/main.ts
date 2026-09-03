// Phase 0 proof of life only. No app logic yet.

// The <HTMLDivElement> is a "type argument" — it tells TypeScript what kind of
// element to expect back, so you get div-specific autocomplete.
// The trailing ! is a "non-null assertion": querySelector can return null, and !
// tells the compiler "trust me, this exists." Use it sparingly — it's a promise,
// not a check.
const app = document.querySelector<HTMLDivElement>('#app')!

app.textContent = 'Corvinus Annotator — scaffold live'
