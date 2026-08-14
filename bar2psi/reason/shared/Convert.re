/* bar -> psi conversion shared by native and Melange/JS builds.
   psi = bar * 100000 / 6894.757293168 */

let psi_per_bar = 14.503773773022;

/* Shortest decimal that round-trips via float_of_string.
   Intended to match Zig {d} / Goblin Go FormatFloat('f', -1).
   Same approach as the Teal/Lua port: scan fixed 'f' precisions. */
let fmt = (x: float): string => {
  let rec loop = (p: int): string =>
    if (p > 17) {
      Printf.sprintf("%.17g", x);
    } else {
      let s = Printf.sprintf("%.*f", p, x);
      switch (float_of_string(s)) {
      | y when y == x => s
      | _ => loop(p + 1)
      | exception _ => loop(p + 1)
      };
    };
  loop(0);
};

/* psi, psi×9/10, psi×3/4 — same three numbers the CLIs print. */
type triple = {
  psi: string,
  psi_90: string,
  psi_75: string,
};

let triple = (bar: float): triple => {
  let psi = bar *. psi_per_bar;
  /* Fraction form keeps 90%/75% exact in binary float (0.9 is not). */
  let psi_90 = psi *. 9. /. 10.;
  let psi_75 = psi *. 3. /. 4.;
  {
    psi: fmt(psi),
    psi_90: fmt(psi_90),
    psi_75: fmt(psi_75),
  };
};

let line = (bar: float): string => {
  let t = triple(bar);
  Printf.sprintf(
    "%s bar = %s %s %s psi",
    fmt(bar),
    t.psi,
    t.psi_90,
    t.psi_75,
  );
};

/* Reject NaN, infinity, and values whose psi conversion overflows. */
let parse_bar = (raw: string): option(float) =>
  switch (float_of_string(raw)) {
  | bar
      when Float.is_finite(bar) && Float.is_finite(bar *. psi_per_bar) =>
    Some(bar)
  | _ => None
  | exception Failure(_) => None
  };
