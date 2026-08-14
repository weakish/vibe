/* Browser calculator: Melange + vanilla DOM (no ReasonReact). */

type domElement;

[@mel.scope "document"] [@mel.return nullable]
external getElementById: string => option(domElement) = "getElementById";

[@mel.get] external getValue: domElement => string = "value";
[@mel.set] external setTextContent: (domElement, string) => unit = "textContent";
[@mel.set] external setHidden: (domElement, bool) => unit = "hidden";
[@mel.send]
external addEventListener: (domElement, string, unit => unit) => unit =
  "addEventListener";
[@mel.send]
external setAttribute: (domElement, string, string) => unit = "setAttribute";
[@mel.send]
external removeAttribute: (domElement, string) => unit = "removeAttribute";

type els = {
  input: domElement,
  out: domElement,
  err: domElement,
  vFull: domElement,
  v90: domElement,
  v75: domElement,
};

let requireEl = (id: string): domElement =>
  switch (getElementById(id)) {
  | Some(el) => el
  | None => failwith("missing #" ++ id)
  };

let clearErr = (els: els): unit => {
  setHidden(els.err, true);
  setTextContent(els.err, "");
};

let setInvalid = (input: domElement, invalid: bool): unit => {
  setAttribute(input, "aria-invalid", if (invalid) {"true"} else {"false"});
  if (invalid) {
    setAttribute(input, "aria-describedby", "psi-err");
  } else {
    removeAttribute(input, "aria-describedby");
  };
};

let render = (els: els, raw: string): unit => {
  let trimmed = String.trim(raw);
  if (trimmed == "") {
    setHidden(els.out, true);
    clearErr(els);
    setInvalid(els.input, false);
  } else {
    switch (Convert.parse_bar(trimmed)) {
    | None =>
      setHidden(els.out, true);
      setTextContent(els.err, "Not a number");
      setHidden(els.err, false);
      setInvalid(els.input, true);
    | Some(bar) =>
      let t = Convert.triple(bar);
      setTextContent(els.vFull, t.psi);
      setTextContent(els.v90, t.psi_90);
      setTextContent(els.v75, t.psi_75);
      clearErr(els);
      setHidden(els.out, false);
      setInvalid(els.input, false);
    };
  };
};

let () = {
  let els = {
    input: requireEl("bar-input"),
    out: requireEl("psi-out"),
    err: requireEl("psi-err"),
    vFull: requireEl("psi-full"),
    v90: requireEl("psi-90"),
    v75: requireEl("psi-75"),
  };
  let onInput = () => render(els, getValue(els.input));
  addEventListener(els.input, "input", onInput);
  render(els, getValue(els.input));
};
