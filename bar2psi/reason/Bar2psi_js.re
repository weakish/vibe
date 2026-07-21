/* Melange entry: read Deno.args, then deno compile the emitted JS. */

[@mel.scope "Deno"] external args: array(string) = "args";
[@mel.scope "Deno"] external exit: int => unit = "exit";

let () = {
  switch (args) {
  | [|raw|] =>
    switch (Convert.parse_bar(raw)) {
    | Some(bar) => print_endline(Convert.line(bar))
    | None =>
      print_endline("error: '" ++ raw ++ "' is not a number");
      exit(1);
    }
  | _ =>
    print_endline("usage: bar2psi <bar>");
    exit(1);
  };
};
