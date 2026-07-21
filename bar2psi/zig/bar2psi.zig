const std = @import("std");

const psi_per_bar: f64 = 14.503773773022;

pub fn main(init: std.process.Init) !void {
    const io = init.io;
    const arena = init.arena.allocator();

    const args = try init.minimal.args.toSlice(arena);
    if (args.len < 2) {
        std.debug.print("usage: bar2psi <bar>\n", .{});
        std.process.exit(1);
    }

    const bar = std.fmt.parseFloat(f64, args[1]) catch {
        std.debug.print("error: '{s}' is not a number\n", .{args[1]});
        std.process.exit(1);
    };
    const psi = bar * psi_per_bar;
    // Fraction form keeps 90%/75% exact in binary float (0.9 is not).
    const psi_90 = psi * 9.0 / 10.0;
    const psi_75 = psi * 3.0 / 4.0;

    var stdout_buffer: [128]u8 = undefined;
    var stdout_writer = std.Io.File.stdout().writer(io, &stdout_buffer);
    const stdout = &stdout_writer.interface;
    // {d} matches Goblin/Go FormatFloat('f', -1) shortest decimal.
    try stdout.print("{d} bar = {d} {d} {d} psi\n", .{ bar, psi, psi_90, psi_75 });
    try stdout.flush();
}
