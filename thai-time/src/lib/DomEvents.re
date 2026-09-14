[@mel.scope "document"]
external visibilityState: string = "visibilityState";
[@mel.scope "document"]
external addDocumentListener: (string, unit => unit) => unit =
  "addEventListener";
[@mel.scope "document"]
external removeDocumentListener: (string, unit => unit) => unit =
  "removeEventListener";

type keyboardEvent;
type node;

[@mel.get] external keyboardKey: keyboardEvent => string = "key";
[@mel.get] external keyboardRepeat: keyboardEvent => bool = "repeat";
[@mel.get] external keyboardTarget: keyboardEvent => node = "target";
[@mel.send]
external preventDefault: keyboardEvent => unit = "preventDefault";
[@mel.get] [@mel.return nullable]
external nodeTagName: node => option(string) = "tagName";
[@mel.get] external nodeContentEditable: node => bool = "isContentEditable";
[@mel.send]
external nodeClosest: (node, string) => Js.Nullable.t(node) = "closest";

[@mel.scope "window"]
external addWindowKeyListener: (string, keyboardEvent => unit) => unit =
  "addEventListener";
[@mel.scope "window"]
external removeWindowKeyListener: (string, keyboardEvent => unit) => unit =
  "removeEventListener";

let keyTargetIsEditable = (el: node): bool =>
  switch (nodeTagName(el)) {
  | None => false
  | Some("INPUT")
  | Some("TEXTAREA")
  | Some("SELECT") => true
  | Some(_) => nodeContentEditable(el)
  };

let keyTargetIsBellButton = (e: keyboardEvent): bool => {
  let el = keyboardTarget(e);
  switch (nodeTagName(el)) {
  | None => false
  | Some(_) =>
    switch (Js.Nullable.toOption(nodeClosest(el, "button.bell"))) {
    | Some(_) => true
    | None => false
    }
  };
};
