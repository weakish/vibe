/* Native CLI (ocamlopt via dune). Argv like Zig/Lua. */

let () = {
  switch (Sys.argv) {
  | [|_, raw|] =>
    switch (Convert.parse_bar(raw)) {
    | Some(bar) => print_endline(Convert.line(bar))
    | None =>
      Printf.eprintf("error: '%s' is not a number\n", raw);
      exit(1);
    }
  | _ =>
    prerr_endline("usage: bar2psi <bar>");
    exit(1);
  };
};
