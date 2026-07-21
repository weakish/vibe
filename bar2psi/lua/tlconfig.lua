return {
   -- clx targets Lua 5.5; 5.4 is the closest Teal gen_target and needs no
   -- compat53 shims (clx has no compat53 module).
   gen_target = "5.4",
   gen_compat = "off",
}
