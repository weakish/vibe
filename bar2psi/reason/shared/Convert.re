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

let line = (bar: float): string => {
  let psi = bar *. psi_per_bar;
  /* Fraction form keeps 90%/75% exact in binary float (0.9 is not). */
  let psi_90 = psi *. 9. /. 10.;
  let psi_75 = psi *. 3. /. 4.;
  Printf.sprintf(
    "%s bar = %s %s %s psi",
    fmt(bar),
    fmt(psi),
    fmt(psi_90),
    fmt(psi_75),
  );
};

let parse_bar = (raw: string): option(float) =>
  try(Some(float_of_string(raw))) {
  | Failure(_) => None
  };
