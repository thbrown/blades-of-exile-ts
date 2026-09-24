// Decompiles every function in the program into one C file, after creating a
// function at each Win16 far prologue that auto-analysis never reached.
// Usage: -postScript DecompAll.java <out.c>
import ghidra.app.script.GhidraScript;
import ghidra.app.decompiler.*;
import ghidra.program.model.address.*;
import ghidra.program.model.listing.*;
import ghidra.program.model.mem.*;
import java.io.*;

public class DecompAll extends GhidraScript {
  public void run() throws Exception {
    String out = getScriptArgs()[0];
    // `inc bp; push bp; mov bp,sp`, usually preceded by `mov ax,ss; nop`.
    byte[] pro = {(byte)0x45,(byte)0x55,(byte)0x8b,(byte)0xec};
    int made = 0;
    for (MemoryBlock b : currentProgram.getMemory().getBlocks()) {
      if (!b.isInitialized()) continue;
      Address a = b.getStart();
      while (a != null && a.compareTo(b.getEnd()) < 0) {
        a = currentProgram.getMemory().findBytes(a, b.getEnd(), pro, null, true, monitor);
        if (a == null) break;
        Address st = a;
        try {
          if (getByte(a.subtract(3)) == (byte)0x8c && getByte(a.subtract(2)) == (byte)0xd0) st = a.subtract(3);
        } catch (Exception e) { /* start of block */ }
        if (getFunctionAt(st) == null) {
          disassemble(st);
          if (createFunction(st, null) != null) made++;
        }
        a = a.add(1);
      }
    }
    println("created " + made + " functions; total " + currentProgram.getFunctionManager().getFunctionCount());
    DecompInterface di = new DecompInterface();
    di.openProgram(currentProgram);
    try (PrintWriter w = new PrintWriter(new FileWriter(out))) {
      for (Function f : currentProgram.getFunctionManager().getFunctions(true)) {
        DecompileResults r = di.decompileFunction(f, 180, monitor);
        w.println("// ==== " + f.getName() + " @ " + f.getEntryPoint());
        if (r.decompileCompleted()) w.println(r.getDecompiledFunction().getC());
        else w.println("// decompile failed: " + r.getErrorMessage());
      }
    }
  }
}
