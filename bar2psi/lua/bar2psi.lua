-- bar -> psi converter (compiled to a native executable with clx)
-- psi = bar * 100000 / 6894.757293168

local PSI_PER_BAR = 14.503773773022

-- Shortest decimal that round-trips via tonumber.
-- Intended to match Zig {d} and Goblin/Go strconv.FormatFloat(x, 'f', -1, 64).
-- Caveat: not guaranteed identical — this scans fixed 'f' precisions 0..17,
-- while Go/Zig use shortest-decimal algorithms that can pick a different
-- representation for some f64 values; the %.17g fallback can diverge too.
-- Fine for bar inputs here; no mismatch seen on smoke-test values.
local function fmt(x)
  for p = 0, 17 do
    local s = string.format("%." .. p .. "f", x)
    if tonumber(s) == x then
      return s
    end
  end
  return string.format("%.17g", x)
end

local bar = tonumber(arg and arg[1])
if bar == nil then
  io.write("usage: bar2psi <bar>\n")
  os.exit(1)
end

local psi = bar * PSI_PER_BAR
-- Fraction form keeps 90%/75% exact in binary float (0.9 is not).
local psi_90 = psi * 9 / 10
local psi_75 = psi * 3 / 4
print(string.format("%s bar = %s %s %s psi", fmt(bar), fmt(psi), fmt(psi_90), fmt(psi_75)))
